use axum::{
    extract::{
        ws::{Message as WsMessage, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    response::Response,
    routing::get,
    Router,
};
use futures::{SinkExt, StreamExt};

use crate::{middleware::AppState, models::Claims};

pub fn router() -> Router<AppState> {
    Router::new().route("/terminal", get(terminal_handler))
}

async fn terminal_handler(
    ws: WebSocketUpgrade,
    Query(params): Query<std::collections::HashMap<String, String>>,
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
) -> Response {
    let tab_id = params
        .get("tab")
        .cloned()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    ws.on_upgrade(move |socket| handle_socket(socket, state, claims.sub.clone(), tab_id))
}

async fn handle_socket(socket: WebSocket, state: AppState, user_id: String, tab_id: String) {
    let (mut sender, mut receiver) = socket.split();
    let db = state.db.clone();
    let sandbox = state.sandbox.clone();

    let (out_tx, mut out_rx) = tokio::sync::mpsc::unbounded_channel::<crate::sandbox_engine::ShellOutput>();
    let session = match crate::sandbox_engine::get_or_create_shell_session(
        sandbox.clone(),
        user_id.clone(),
        tab_id.clone(),
        out_tx.clone(),
    )
    .await
    {
        Ok(s) => s,
        Err(e) => {
            let _ = sender
                .send(WsMessage::text(
                    serde_json::json!({"type": "stderr", "data": e}).to_string(),
                ))
                .await;
            let _ = sender
                .send(WsMessage::text(
                    serde_json::json!({"type": "status", "running": false, "cwd": "/workspace", "code": -1})
                        .to_string(),
                ))
                .await;
            return;
        }
    };

    let shell_pid = session.shell_pid;

    // Send initial connection messages only after the session is ready.
    let init_msgs = [
        r#"{"type":"stdout","data":""}"#,
        r#"{"type":"stdout","data":"  Project Vulcan Sandbox Terminal"}"#,
        r#"{"type":"stdout","data":"  ───────────────────────────"}"#,
        r#"{"type":"stdout","data":"  Connected to sandboxed environment."}"#,
        r#"{"type":"stdout","data":"  Type commands and press Enter to execute."}"#,
        r#"{"type":"stdout","data":"  Commands run in an isolated container with limited resources.\r\n"}"#,
        r#"{"type":"stdout","data":""}"#,
    ];
    for msg in &init_msgs {
        let _ = sender.send(WsMessage::text(*msg)).await;
    }

    // Forward output messages to the WebSocket client.
    let forward_task = tokio::spawn(async move {
        while let Some(msg) = out_rx.recv().await {
            match msg {
                crate::sandbox_engine::ShellOutput::Data(data) => {
                    // Send raw terminal bytes as a binary frame.
                    if sender.send(WsMessage::binary(data)).await.is_err() {
                        break;
                    }
                }
                crate::sandbox_engine::ShellOutput::Cwd(cwd) => {
                    let payload = serde_json::json!({"type": "cwd", "cwd": cwd}).to_string();
                    if sender.send(WsMessage::text(payload)).await.is_err() {
                        break;
                    }
                }
                crate::sandbox_engine::ShellOutput::Status { running, code } => {
                    let payload =
                        serde_json::json!({"type": "status", "running": running, "code": code})
                            .to_string();
                    if sender.send(WsMessage::text(payload)).await.is_err() {
                        break;
                    }
                }
            }
        }
    });

    while let Some(msg_result) = receiver.next().await {
        match msg_result {
            Ok(WsMessage::Text(text)) => {
                let envelope: serde_json::Value = match serde_json::from_str(&text) {
                    Ok(v) => v,
                    Err(_) => continue,
                };

                match envelope.get("type").and_then(|v| v.as_str()) {
                    Some("input") => {
                        let data = envelope["data"].as_str().unwrap_or("");
                        if data.is_empty() {
                            continue;
                        }

                        // Audit log the command (the line before the trailing newline).
                        let command = data.trim_end_matches('\n').to_string();
                        if !command.is_empty() {
                            let _ = sqlx::query(
                                "INSERT INTO terminal_sessions (user_id, tab_id, command, status) VALUES (?1, ?2, ?3, 'running')"
                            )
                            .bind(&user_id)
                            .bind(&tab_id)
                            .bind(&command)
                            .execute(&db)
                            .await;
                        }

                        // Forward raw keystrokes to the PTY.
                        session.send_input(data.as_bytes().to_vec());
                    }
                    Some("resize") => {
                        let cols = envelope["cols"].as_u64().unwrap_or(80) as u16;
                        let rows = envelope["rows"].as_u64().unwrap_or(24) as u16;
                        session.resize(nix::pty::Winsize {
                            ws_col: cols,
                            ws_row: rows,
                            ws_xpixel: 0,
                            ws_ypixel: 0,
                        });
                    }
                    Some("pid") => {
                        let payload = serde_json::json!({"type": "pid", "pid": shell_pid}).to_string();
                        let _ = out_tx.send(crate::sandbox_engine::ShellOutput::Data(
                            payload.into_bytes(),
                        ));
                    }
                    Some("close") => {
                        break;
                    }
                    _ => {}
                }
            }
            Ok(WsMessage::Close(_)) => break,
            Ok(_) => continue,
            Err(e) => {
                tracing::warn!("Terminal WebSocket error: {}", e);
                continue;
            }
        }
    }

    forward_task.abort();

    // Always shut down the PTY session when the WebSocket ends, unless the
    // client explicitly closed the tab (in which case we also shut it down).
    // This prevents leaked proot/bash processes and semaphore permits after a
    // page refresh or unexpected disconnect.
    session.shutdown_session();

    let _ = sqlx::query(
        "UPDATE terminal_sessions SET status = 'killed', ended_at = datetime('now') WHERE user_id = ?1 AND tab_id = ?2 AND status = 'running'"
    )
    .bind(&user_id)
    .bind(&tab_id)
    .execute(&db)
    .await;

    // Give run_pty_session a moment to reap the child and remove the map entry.
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;

    // If shutdown didn't finish cleaning up the map entry (e.g. the shell
    // refused to die), remove it explicitly.
    {
        let mut sessions = sandbox.sessions.lock().await;
        sessions.remove(&(user_id.clone(), tab_id.clone()));
    }
}
