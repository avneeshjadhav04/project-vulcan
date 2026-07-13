use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
    routing::get,
    Router,
};
use futures::{SinkExt, StreamExt};
use serde::Serialize;

use crate::{
    middleware::AppState,
    models::Claims,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/browser", get(browser_ws_handler))
        .route("/browser/sessions", get(list_browser_sessions))
        .route("/browser/screenshot/{id}", get(get_screenshot))
}

#[derive(Serialize)]
struct BrowserSessionInfo {
    session_id: String,
    chat_id: String,
    ws_port: u16,
    current_url: String,
    title: String,
    ai_active: bool,
}

/// List all active browser sessions for the current user (across all chats).
async fn list_browser_sessions(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
) -> Json<Vec<BrowserSessionInfo>> {
    let sessions = state.browser.sessions.lock().await;
    let mut result = Vec::new();
    for ((user_id, _session_id), handle) in sessions.iter() {
        if user_id != &claims.sub {
            continue;
        }
        let current_url = handle
            .current_url
            .lock()
            .map(|u| u.clone())
            .unwrap_or_default();
        let title = handle
            .title
            .lock()
            .map(|t| t.clone())
            .unwrap_or_default();
        result.push(BrowserSessionInfo {
            session_id: handle.session_id.clone(),
            chat_id: handle.chat_id.clone(),
            ws_port: handle.ws_port,
            current_url,
            title,
            ai_active: handle.ai_active.load(std::sync::atomic::Ordering::Relaxed),
        });
    }
    Json(result)
}

/// WebSocket handler for the browser live view.
///
/// This endpoint broadcasts viewer events (ai_active, url_changed, etc.) to
/// the frontend. The actual VNC stream goes through a separate websockify
/// connection that the frontend establishes directly using the ws_port
/// provided in the SessionReady event.
async fn browser_ws_handler(
    ws: axum::extract::ws::WebSocketUpgrade,
    Query(params): Query<std::collections::HashMap<String, String>>,
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
) -> Response {
    let session_id = match params.get("session") {
        Some(id) if !id.is_empty() => id.clone(),
        _ => {
            return (StatusCode::BAD_REQUEST, "Missing session parameter").into_response();
        }
    };

    // Look up the session.
    let session = {
        let sessions = state.browser.sessions.lock().await;
        sessions
            .get(&(claims.sub.clone(), session_id.clone()))
            .cloned()
    };

    let session = match session {
        Some(s) => s,
        None => {
            return (StatusCode::NOT_FOUND, "Browser session not found").into_response();
        }
    };

    ws.on_upgrade(move |socket| handle_browser_ws(socket, session))
}

async fn handle_browser_ws(
    socket: axum::extract::ws::WebSocket,
    session: crate::browser_engine::BrowserSessionHandle,
) {
    let (mut sender, mut receiver) = socket.split();
    let mut viewer_rx = session.viewer_tx.subscribe();

    session.touch();

    // Forward viewer events to the WebSocket client.
    let forward_task = tokio::spawn(async move {
        loop {
            match viewer_rx.recv().await {
                Ok(event) => {
                    let payload = serde_json::to_string(&event).unwrap_or_default();
                    if sender
                        .send(axum::extract::ws::Message::Text(payload.into()))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
            }
        }
    });

    // Receive messages from the client (navigate, close, etc.)
    while let Some(msg_result) = receiver.next().await {
        match msg_result {
            Ok(axum::extract::ws::Message::Text(text)) => {
                let envelope: serde_json::Value = match serde_json::from_str(&text) {
                    Ok(v) => v,
                    Err(_) => continue,
                };

                match envelope.get("type").and_then(|v| v.as_str()) {
                    Some("navigate") => {
                        if let Some(url) = envelope["url"].as_str() {
                            let (reply, reply_rx) =
                                tokio::sync::oneshot::channel();
                            let _ = session.command_tx.try_send(
                                crate::browser_engine::BrowserCommand::Navigate {
                                    url: url.to_string(),
                                    reply,
                                },
                            );
                            // Wait for navigation to complete (with timeout).
                            let _ = tokio::time::timeout(
                                std::time::Duration::from_secs(15),
                                reply_rx,
                            )
                            .await;
                            session.touch();
                        }
                    }
                    Some("close") => {
                        session.shutdown_session();
                        break;
                    }
                    _ => {}
                }
            }
            Ok(axum::extract::ws::Message::Close(_)) => break,
            Ok(_) => continue,
            Err(e) => {
                tracing::warn!("Browser WebSocket error: {}", e);
                continue;
            }
        }
    }

    forward_task.abort();
}

/// Serve a persisted screenshot by ID.
///
/// Returns the JPEG image bytes. Auth-protected: the user must own the chat
/// the screenshot belongs to.
async fn get_screenshot(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path(id): Path<String>,
) -> Response {
    let row: Option<(Vec<u8>, String)> = sqlx::query_as(
        r#"
        SELECT bs.image, bs.mime_type
        FROM browser_screenshots bs
        JOIN chats c ON c.id = bs.chat_id
        WHERE bs.id = ?1 AND c.user_id = ?2
        "#,
    )
    .bind(&id)
    .bind(&claims.sub)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    match row {
        Some((image, mime_type)) => (
            StatusCode::OK,
            [
                (axum::http::header::CONTENT_TYPE, mime_type.as_str()),
                (axum::http::header::CACHE_CONTROL, "private, max-age=3600"),
            ],
            image,
        )
            .into_response(),
        None => (StatusCode::NOT_FOUND, "Screenshot not found").into_response(),
    }
}