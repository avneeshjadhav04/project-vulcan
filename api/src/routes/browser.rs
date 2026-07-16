use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
    routing::{get, post},
    Router,
};
use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::time::Duration;

use crate::{
    middleware::AppState,
    models::Claims,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/browser", get(browser_ws_handler))
        .route("/browser/sessions", get(list_browser_sessions))
        .route("/browser/session", post(create_browser_session))
        .route(
            "/browser/session/{id}/release",
            post(release_browser_session),
        )
        .route("/browser/vnc/{id}", get(vnc_proxy_handler))
        .route("/browser/screenshot/{id}", get(get_screenshot))
}

#[derive(Serialize)]
struct BrowserSessionInfo {
    session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    chat_id: Option<String>,
    vnc_port: u16,
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
        result.push(session_info_from_handle(handle));
    }
    Json(result)
}

fn session_info_from_handle(
    handle: &crate::browser_engine::BrowserSessionHandle,
) -> BrowserSessionInfo {
    let current_url = handle
        .current_url
        .lock()
        .map(|u| u.clone())
        .unwrap_or_default();
    let title = handle.title.lock().map(|t| t.clone()).unwrap_or_default();
    let chat_id = handle.get_chat_id();
    let chat_id_opt = if chat_id.is_empty() { None } else { Some(chat_id) };
    BrowserSessionInfo {
        session_id: handle.session_id.clone(),
        chat_id: chat_id_opt,
        vnc_port: handle.vnc_port,
        current_url,
        title,
        ai_active: handle.ai_active.load(std::sync::atomic::Ordering::Relaxed),
    }
}

#[derive(Deserialize)]
struct CreateSessionBody {
    #[serde(default)]
    chat_id: Option<String>,
}

/// Manually create a standalone browser session from the Browser Control
/// panel. `chat_id` is accepted for forward compatibility but, per the
/// product model, manual sessions are always standalone (chat_id = NULL).
async fn create_browser_session(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    body: axum::Json<CreateSessionBody>,
) -> Response {
    let session_id = uuid::Uuid::new_v4().to_string();
    // Manual sessions are always standalone; ignore any chat_id from the
    // client so the browser panel never implicitly binds to a chat.
    let _ = body.chat_id; // explicitly unused

    let handle = match crate::browser_engine::get_or_create_session(
        state.browser.clone(),
        claims.sub.clone(),
        session_id.clone(),
        None,
    )
    .await
    {
        Ok(h) => h,
        Err(e) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, e).into_response();
        }
    };

    // Audit row with chat_id = NULL (standalone).
    let _ = sqlx::query(
        "INSERT INTO browser_sessions (user_id, chat_id, session_id, status) VALUES (?1, NULL, ?2, 'active')",
    )
    .bind(&claims.sub)
    .bind(&session_id)
    .execute(&state.db)
    .await;

    Json(session_info_from_handle(&handle)).into_response()
}

/// Release a browser session back to standalone (clears the chat association
/// and ai_active flag). Non-destructive: the session stays alive.
async fn release_browser_session(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path(id): Path<String>,
) -> Response {
    let session = {
        let sessions = state.browser.sessions.lock().await;
        sessions
            .get(&(claims.sub.clone(), id.clone()))
            .cloned()
    };

    let Some(session) = session else {
        return (StatusCode::NOT_FOUND, "Browser session not found").into_response();
    };

    // Clear chat association and AI activity.
    session.set_chat_id("");
    session
        .ai_active
        .store(false, std::sync::atomic::Ordering::SeqCst);

    // Reflect the release in the audit row.
    let _ = sqlx::query(
        "UPDATE browser_sessions SET chat_id = NULL, last_activity = datetime('now') WHERE user_id = ?1 AND session_id = ?2",
    )
    .bind(&claims.sub)
    .bind(&id)
    .execute(&state.db)
    .await;

    (StatusCode::OK, "released").into_response()
}

/// VNC WebSocket proxy.
///
/// Proxies the noVNC WebSocket connection (from the frontend, on port 8080)
/// directly to the internal Xvnc process (localhost:vnc_port) inside the
/// container. The API acts as the WebSocket-to-TCP bridge, so no extra
/// ports need to be exposed.
async fn vnc_proxy_handler(
    ws: axum::extract::ws::WebSocketUpgrade,
    Path(id): Path<String>,
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
) -> Response {
    // Look up the session to get the VNC port.
    let session = {
        let sessions = state.browser.sessions.lock().await;
        sessions
            .get(&(claims.sub.clone(), id.clone()))
            .cloned()
    };

    let session = match session {
        Some(s) => s,
        None => {
            return (StatusCode::NOT_FOUND, "Browser session not found").into_response();
        }
    };

    let vnc_port = session.vnc_port;

    ws.on_upgrade(move |socket| vnc_proxy_bridge(socket, vnc_port))
}

/// Bidirectionally pipe data between the client WebSocket (noVNC) and the
/// internal Xvnc TCP connection (raw RFB protocol).
async fn vnc_proxy_bridge(socket: axum::extract::ws::WebSocket, vnc_port: u16) {
    use axum::extract::ws::Message;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let (mut ws_sink, mut ws_stream) = socket.split();

    tracing::info!("VNC proxy: connecting to Xvnc on port {}", vnc_port);

    // Connect directly to Xvnc (raw VNC/RFB over TCP).
    let tcp = match tokio::net::TcpStream::connect(format!("localhost:{}", vnc_port)).await {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!("VNC proxy: failed to connect to Xvnc on port {}: {}", vnc_port, e);
            return;
        }
    };

    tracing::info!("VNC proxy: connected to Xvnc on port {}", vnc_port);

    // Split the TCP stream for concurrent read/write (owned halves).
    let (mut tcp_read, mut tcp_write) = tcp.into_split();

    // Task 1: WebSocket → Xvnc (noVNC client to VNC server).
    let ws_to_tcp = tokio::spawn(async move {
        while let Some(msg_result) = ws_stream.next().await {
            match msg_result {
                Ok(Message::Binary(data)) => {
                    if tcp_write.write_all(&data).await.is_err() {
                        break;
                    }
                }
                Ok(Message::Text(text)) => {
                    if tcp_write.write_all(text.as_bytes()).await.is_err() {
                        break;
                    }
                }
                Ok(Message::Close(_)) | Err(_) => break,
                Ok(_) => {}
            }
        }
        let _ = tcp_write.shutdown().await;
    });

    // Task 2: Xvnc → WebSocket (VNC server to noVNC client).
    // noVNC expects binary WebSocket frames.
    // Send a WS Ping every 15s when the framebuffer is idle to keep
    // the hosting platform's reverse proxy from closing the connection.
    let tcp_to_ws = tokio::spawn(async move {
        let mut buf = [0u8; 16384];
        let mut ping_interval = tokio::time::interval(Duration::from_secs(15));
        ping_interval.tick().await; // skip immediate first tick
        loop {
            tokio::select! {
                result = tcp_read.read(&mut buf) => {
                    match result {
                        Ok(0) => break,
                        Ok(n) => {
                            if ws_sink
                                .send(Message::Binary(buf[..n].to_vec().into()))
                                .await
                                .is_err()
                            {
                                break;
                            }
                        }
                        Err(_) => break,
                    }
                }
                _ = ping_interval.tick() => {
                    if ws_sink
                        .send(Message::Ping(Vec::new().into()))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
            }
        }
        let _ = ws_sink.close().await;
    });

    let _ = tokio::join!(ws_to_tcp, tcp_to_ws);
}

/// WebSocket handler for the browser live view.
///
/// This endpoint broadcasts viewer events (ai_active, url_changed, etc.) to
/// the frontend. The actual VNC stream is proxied through the
/// `/browser/vnc/{id}` route, which bridges the noVNC WebSocket to the
/// internal websockify process.
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

    // Late-join fix: if the session was already ready before this client
    // subscribed, the original `SessionReady` broadcast was missed. Send a
    // synthetic one so the frontend knows the session is ready for noVNC.
    let _ = sender
        .send(axum::extract::ws::Message::Text(
            serde_json::to_string(
                &crate::browser_engine::BrowserViewerEvent::SessionReady,
            )
            .unwrap_or_default()
            .into(),
        ))
        .await;

    // Forward viewer events to the WebSocket client.
    // Send a WS Ping every 15s when no events are flowing to keep
    // the hosting platform's reverse proxy from closing the connection.
    let forward_task = tokio::spawn(async move {
        let mut ping_interval = tokio::time::interval(Duration::from_secs(15));
        ping_interval.tick().await; // skip immediate first tick
        loop {
            tokio::select! {
                event = viewer_rx.recv() => {
                    match event {
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
                _ = ping_interval.tick() => {
                    if sender
                        .send(axum::extract::ws::Message::Ping(Vec::new().into()))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
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
                    Some("resize") => {
                        if let (Some(w), Some(h)) = (envelope["width"].as_u64(), envelope["height"].as_u64()) {
                            let _ = session.command_tx.try_send(
                                crate::browser_engine::BrowserCommand::Resize {
                                    width: w as u32,
                                    height: h as u32,
                                },
                            );
                            session.touch();
                        }
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