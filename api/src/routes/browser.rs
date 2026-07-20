use axum::{
    extract::{Path, State},
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
        .route("/browser/start", post(start_browser_handler))
        .route("/browser/stop", post(stop_browser_handler))
        .route("/browser/status", get(browser_status_handler))
        .route("/browser/events", get(browser_events_handler))
        .route("/browser/vnc", get(vnc_proxy_handler))
        .route("/browser/sessions", get(list_browser_sessions))
        .route("/browser/session", post(create_browser_session))
        .route(
            "/browser/session/{id}/release",
            post(release_browser_session),
        )
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

/// Start the shared Chrome + Xvnc. No session is created — this just starts
/// the browser so the user can see it via VNC.
async fn start_browser_handler(
    State(state): State<AppState>,
) -> Response {
    match crate::browser_engine::start_browser(&state.browser).await {
        Ok(already_running) => {
            Json(serde_json::json!({ "running": true, "already_running": already_running }))
                .into_response()
        }
        Err(e) => {
            (StatusCode::INTERNAL_SERVER_ERROR, e).into_response()
        }
    }
}

/// Stop the shared Chrome + Xvnc. Only stops if no AI sessions are active.
async fn stop_browser_handler(
    State(state): State<AppState>,
) -> Response {
    let stopped = crate::browser_engine::stop_browser(&state.browser).await;
    Json(serde_json::json!({ "stopped": stopped })).into_response()
}

/// Get the current browser status.
async fn browser_status_handler(
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let (running, current_url, title, ai_active) =
        crate::browser_engine::get_browser_status(&state.browser);
    Json(serde_json::json!({
        "running": running,
        "current_url": current_url,
        "title": title,
        "ai_active": ai_active,
    }))
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
    let chat_id = handle.get_chat_id();
    let chat_id_opt = if chat_id.is_empty() { None } else { Some(chat_id) };
    BrowserSessionInfo {
        session_id: handle.session_id.clone(),
        chat_id: chat_id_opt,
        vnc_port: handle.vnc_port,
        current_url: String::new(),
        title: String::new(),
        ai_active: false,
    }
}

#[derive(Deserialize)]
struct CreateSessionBody {
    #[serde(default)]
    chat_id: Option<String>,
}

/// Create a browser session for AI automation. The shared Chrome + Xvnc must
/// already be running (call /browser/start first).
async fn create_browser_session(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    body: axum::Json<CreateSessionBody>,
) -> Response {
    let session_id = uuid::Uuid::new_v4().to_string();
    let _ = body.chat_id;

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

    session.set_chat_id("");
    session
        .shared_ai_active
        .store(false, std::sync::atomic::Ordering::SeqCst);

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
/// Proxies the noVNC WebSocket connection directly to the internal Xvnc
/// process (localhost:5901). No session ID needed — the VNC port is shared.
async fn vnc_proxy_handler(
    ws: axum::extract::ws::WebSocketUpgrade,
) -> Response {
    ws.on_upgrade(move |socket| vnc_proxy_bridge(socket, crate::browser_engine::SHARED_VNC_PORT))
}

/// Bidirectionally pipe data between the client WebSocket (noVNC) and the
/// internal Xvnc TCP connection (raw RFB protocol).
async fn vnc_proxy_bridge(socket: axum::extract::ws::WebSocket, vnc_port: u16) {
    use axum::extract::ws::Message;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let (mut ws_sink, mut ws_stream) = socket.split();

    tracing::info!("VNC proxy: connecting to Xvnc on port {}", vnc_port);

    let tcp = match tokio::net::TcpStream::connect(format!("localhost:{}", vnc_port)).await {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!("VNC proxy: failed to connect to Xvnc on port {}: {}", vnc_port, e);
            return;
        }
    };

    tracing::info!("VNC proxy: connected to Xvnc on port {}", vnc_port);

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
    let tcp_to_ws = tokio::spawn(async move {
        let mut buf = [0u8; 16384];
        let mut ping_interval = tokio::time::interval(Duration::from_secs(15));
        ping_interval.tick().await;
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

/// WebSocket handler for the browser events stream.
///
/// Subscribes to the shared viewer_tx broadcast channel and forwards events
/// (ai_active, url_changed, etc.) to the frontend. Also accepts commands
/// from the frontend (navigate, resize, close).
async fn browser_events_handler(
    ws: axum::extract::ws::WebSocketUpgrade,
    State(state): State<AppState>,
) -> Response {
    ws.on_upgrade(move |socket| handle_browser_events(socket, state))
}

async fn handle_browser_events(
    socket: axum::extract::ws::WebSocket,
    state: AppState,
) {
    let (mut sender, mut receiver) = socket.split();

    // Subscribe to the shared viewer_tx.
    let viewer_rx = {
        let shared = state.browser.shared.lock().await;
        shared.as_ref().map(|sb| sb.viewer_tx.subscribe())
    };

    let Some(mut viewer_rx) = viewer_rx else {
        let _ = sender
            .send(axum::extract::ws::Message::Text(
                serde_json::json!({"type": "error", "message": "Browser not running"}).to_string().into(),
            ))
            .await;
        return;
    };

    // Forward viewer events to the WebSocket client.
    let forward_task = tokio::spawn(async move {
        let mut ping_interval = tokio::time::interval(Duration::from_secs(15));
        ping_interval.tick().await;
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

    // Receive messages from the client (navigate, resize, etc.)
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
                            // Find the first available session and navigate.
                            let sessions = state.browser.sessions.lock().await;
                            if let Some(handle) = sessions.values().next() {
                                let (reply, _reply_rx) = tokio::sync::oneshot::channel();
                                let _ = handle.command_tx.try_send(
                                    crate::browser_engine::BrowserCommand::Navigate {
                                        url: url.to_string(),
                                        reply,
                                    },
                                );
                            }
                        }
                    }
                    Some("resize") => {
                        if let (Some(w), Some(h)) = (envelope["width"].as_u64(), envelope["height"].as_u64()) {
                            let sessions = state.browser.sessions.lock().await;
                            for handle in sessions.values() {
                                let _ = handle.command_tx.try_send(
                                    crate::browser_engine::BrowserCommand::Resize {
                                        width: w as u32,
                                        height: h as u32,
                                    },
                                );
                            }
                        }
                    }
                    _ => {}
                }
            }
            Ok(axum::extract::ws::Message::Close(_)) => break,
            Ok(_) => continue,
            Err(e) => {
                tracing::warn!("Browser events WebSocket error: {}", e);
                continue;
            }
        }
    }

    forward_task.abort();
}

/// Serve a persisted screenshot by ID.
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
