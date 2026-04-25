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

    let (sandbox_ws, _) = match tokio_tungstenite::connect_async(&sandbox_url).await {
        Ok(pair) => pair,
        Err(e) => {
            tracing::error!("Failed to connect to sandbox: {}", e);
            let msg = serde_json::json!({
                "type": "stderr",
                "data": format!("Sandbox unavailable: {}. Terminal requires Docker Compose with the sandbox service running.", e)
            });
            let _ = socket.send(WsMessage::Text(msg.to_string())).await;
            return;
        }
    };

    let (mut sender, mut receiver) = socket.split();
    let (mut sandbox_sender, mut sandbox_receiver) = sandbox_ws.split();

    let db = state.db.clone();
    let forward_to_sandbox = async move {
        while let Some(Ok(msg)) = receiver.next().await {
            if let WsMessage::Text(text) = msg {
                // Log command to DB for audit
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) {
                    if let Some(cmd) = parsed["command"].as_str() {
                        let _ = sqlx::query(
                            "INSERT INTO terminal_sessions (user_id, command, status) VALUES (?1, ?2, 'running')"
                        )
                        .bind(&user_id)
                        .bind(cmd)
                        .execute(&db)
                        .await;
                    }
                }
                // Forward raw text (already JSON from client: {"command":"..."})
                if sandbox_sender.send(tokio_tungstenite::tungstenite::Message::Text(text)).await.is_err() {
                    break;
                }
            }
        }
    };

    let forward_to_client = async {
        while let Some(Ok(msg)) = sandbox_receiver.next().await {
            let text = match msg {
                tokio_tungstenite::tungstenite::Message::Text(t) => t,
                tokio_tungstenite::tungstenite::Message::Close(_) => break,
                _ => continue,
            };
            if sender.send(WsMessage::Text(text)).await.is_err() {
                break;
            }
        }
    };

    tokio::select! {
        _ = forward_to_sandbox => {},
        _ = forward_to_client => {},
    }
}
