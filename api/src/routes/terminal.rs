use axum::{
    extract::{ws::{Message as WsMessage, WebSocket, WebSocketUpgrade}, State},
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

async fn handle_socket(mut socket: WebSocket, state: AppState, user_id: String) {
    let sandbox_url = std::env::var("SANDBOX_URL").unwrap_or_else(|_| "ws://sandbox:8081/execute".to_string());

    let (sandbox_ws, _) = match tokio::time::timeout(
        std::time::Duration::from_secs(5),
        tokio_tungstenite::connect_async(&sandbox_url)
    ).await {
        Ok(Ok(pair)) => pair,
        Ok(Err(e)) => {
            tracing::error!("Failed to connect to sandbox: {}", e);
            let msg = serde_json::json!({
                "type": "stderr",
                "data": format!("Sandbox unavailable: {}. Terminal requires Docker Compose with the sandbox service running.", e)
            });
            let _ = socket.send(WsMessage::Text(msg.to_string())).await;
            return;
        }
        Err(_) => {
            tracing::error!("Sandbox connection timed out");
            let msg = serde_json::json!({
                "type": "stderr",
                "data": "Sandbox connection timed out. Terminal requires Docker Compose with the sandbox service running."
            });
            let _ = socket.send(WsMessage::Text(msg.to_string())).await;
            return;
        }
    };

    let (mut sender, mut receiver) = socket.split();
    let (mut sandbox_sender, mut sandbox_receiver) = sandbox_ws.split();

    let db = state.db.clone();
    let db2 = state.db.clone();
    let user_id2 = user_id.clone();
    let user_id3 = user_id.clone();

    let forward_to_sandbox = async move {
        while let Some(msg_result) = receiver.next().await {
            match msg_result {
                Ok(WsMessage::Text(text)) => {
                    // Log command to DB for audit
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) {
                        if let Some(cmd) = parsed["command"].as_str() {
                            if let Err(e) = sqlx::query(
                                "INSERT INTO terminal_sessions (user_id, command, status) VALUES (?1, ?2, 'running')"
                            )
                            .bind(&user_id)
                            .bind(cmd)
                            .execute(&db)
                            .await {
                                tracing::warn!("Failed to log terminal command: {}", e);
                            }
                        }
                    }
                    // Forward raw text (already JSON from client: {"command":"..."})
                    if sandbox_sender.send(tokio_tungstenite::tungstenite::Message::Text(text)).await.is_err() {
                        break;
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
    };

    let forward_to_client = async {
        while let Some(msg_result) = sandbox_receiver.next().await {
            match msg_result {
                Ok(msg) => {
                    let text = match msg {
                        tokio_tungstenite::tungstenite::Message::Text(t) => t,
                        tokio_tungstenite::tungstenite::Message::Close(_) => break,
                        _ => continue,
                    };
                    // Try to parse status messages and update DB
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) {
                        if let Some(status) = parsed["status"].as_str() {
                            let db_status = if status == "success" { "success" } else { "error" };
                            let _ = sqlx::query(
                                "UPDATE terminal_sessions SET status = ?1, ended_at = datetime('now') WHERE user_id = ?2 AND status = 'running' ORDER BY started_at DESC LIMIT 1"
                            )
                            .bind(db_status)
                            .bind(&user_id2)
                            .execute(&db2)
                            .await;
                        }
                    }
                    if sender.send(WsMessage::Text(text)).await.is_err() {
                        break;
                    }
                }
                Err(e) => {
                    tracing::warn!("Sandbox WebSocket error: {}", e);
                    continue;
                }
            }
        }
    };

    tokio::select! {
        _ = forward_to_sandbox => {},
        _ = forward_to_client => {},
    }

    // Connection closed: mark any remaining running sessions as killed
    let _ = sqlx::query(
        "UPDATE terminal_sessions SET status = 'killed', ended_at = datetime('now') WHERE user_id = ?1 AND status = 'running'"
    )
    .bind(&user_id3)
    .execute(&state.db)
    .await;
}
