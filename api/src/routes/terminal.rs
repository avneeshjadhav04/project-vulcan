use axum::{
    extract::{
        ws::{Message as WsMessage, WebSocket, WebSocketUpgrade},
        State,
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
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
) -> Response {
    ws.on_upgrade(move |socket| handle_socket(socket, state, claims.sub.clone()))
}

async fn handle_socket(socket: WebSocket, state: AppState, user_id: String) {
    let (mut sender, mut receiver) = socket.split();
    let db = state.db.clone();
    let db2 = state.db.clone();
    let db3 = state.db.clone();
    let user_id2 = user_id.clone();
    let user_id3 = user_id.clone();
    let sandbox = state.sandbox.clone();

    // Send initial connection messages
    let init_msgs = [
        r#"{"type":"stdout","data":""}"#,
        r#"{"type":"stdout","data":"  Project Vulcan Sandbox Terminal"}"#,
        r#"{"type":"stdout","data":"  ───────────────────────────"}"#,
        r#"{"type":"stdout","data":"  Connected to sandboxed environment."}"#,
        r#"{"type":"stdout","data":"  Type commands and press Enter to execute."}"#,
        r#"{"type":"stdout","data":"  Commands run in an isolated container with limited resources."}"#,
        r#"{"type":"stdout","data":""}"#,
    ];
    for msg in &init_msgs {
        let _ = sender.send(WsMessage::Text((*msg).to_string())).await;
    }

    while let Some(msg_result) = receiver.next().await {
        match msg_result {
            Ok(WsMessage::Text(text)) => {
                let cmd: serde_json::Value = match serde_json::from_str(&text) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                let command = cmd["command"].as_str().unwrap_or("").to_string();
                if command.is_empty() {
                    continue;
                }

                // Log command to DB for audit
                let _ = sqlx::query(
                    "INSERT INTO terminal_sessions (user_id, command, status) VALUES (?1, ?2, 'running')"
                )
                .bind(&user_id)
                .bind(&command)
                .execute(&db)
                .await;

                // Spawn command and get streaming receiver
                let stream_rx = match crate::sandbox_engine::run_command_stream(
                    vec!["/bin/bash".to_string(), "-c".to_string(), command.clone()],
                    user_id.clone(),
                    sandbox.clone(),
                )
                .await
                {
                    Ok(rx) => rx,
                    Err(e) => {
                        let err = serde_json::json!({"type": "stderr", "data": e}).to_string();
                        let _ = sender.send(WsMessage::Text(err)).await;
                        continue;
                    }
                };

                // Forward stream messages to client
                let mut stream_rx = stream_rx;
                let mut final_status: Option<String> = None;
                while let Some(msg) = stream_rx.recv().await {
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&msg) {
                        if let Some(status) = parsed["status"].as_str() {
                            final_status = Some(status.to_string());
                        }
                    }
                    if sender.send(WsMessage::Text(msg)).await.is_err() {
                        break;
                    }
                }

                // Update DB with final status — identify by the latest running session for this user
                let db_status = match final_status.as_deref() {
                    Some("success") => "success",
                    Some("error") => "error",
                    Some("timeout") => "timeout",
                    _ => "killed",
                };
                if let Ok(Some((session_id,))) = sqlx::query_as::<_, (String,)>(
                    "SELECT id FROM terminal_sessions WHERE user_id = ?1 AND status = 'running' ORDER BY started_at DESC LIMIT 1"
                )
                .bind(&user_id2)
                .fetch_optional(&db2)
                .await {
                    let _ = sqlx::query(
                        "UPDATE terminal_sessions SET status = ?1, ended_at = datetime('now') WHERE id = ?2"
                    )
                    .bind(db_status)
                    .bind(&session_id)
                    .execute(&db2)
                    .await;
                }
            }
            Ok(WsMessage::Close(_)) => break,
            Ok(_) => continue,
            Err(e) => {
                tracing::warn!("Client WebSocket error: {}", e);
                continue;
            }
        }
    }

    // Connection closed: mark any remaining running sessions as killed
    let _ = sqlx::query(
        "UPDATE terminal_sessions SET status = 'killed', ended_at = datetime('now') WHERE user_id = ?1 AND status = 'running'"
    )
    .bind(&user_id3)
    .execute(&db3)
    .await;
}
