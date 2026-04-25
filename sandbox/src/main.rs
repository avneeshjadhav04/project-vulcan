use axum::{
    extract::{ws::{Message as WsMessage, WebSocket, WebSocketUpgrade}, State},
    response::Response,
    routing::get,
    Router,
};
use futures::{SinkExt, StreamExt};
use std::sync::Arc;
use tokio::process::Command;
use tokio::sync::Semaphore;

#[derive(Clone)]
struct SandboxState {
    semaphore: Arc<Semaphore>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .json()
        .init();

    let state = SandboxState {
        semaphore: Arc::new(Semaphore::new(4)),
    };
    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/execute", get(ws_handler))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:8081").await?;
    tracing::info!("Sandbox listening on 0.0.0.0:8081");
    axum::serve(listener, app).await?;
    Ok(())
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<SandboxState>,
) -> Response {
    ws.max_message_size(64 * 1024)
        .max_frame_size(64 * 1024)
        .on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: SandboxState) {
    let (sender, mut receiver) = socket.split();
    let sender = Arc::new(tokio::sync::Mutex::new(sender));

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

                let sender_clone = sender.clone();
                let semaphore = state.semaphore.clone();
                tokio::spawn(async move {
                    let _permit = match semaphore.acquire().await {
                        Ok(p) => p,
                        Err(_) => {
                            let payload = serde_json::json!({"status": "error", "message": "Server overloaded"}).to_string();
                            let _ = sender_clone.lock().await.send(WsMessage::Text(payload)).await;
                            return;
                        }
                    };
                    run_command(&command, sender_clone).await;
                });
            }
            Ok(WsMessage::Close(_)) => break,
            Ok(_) => continue,
            Err(e) => {
                tracing::warn!("WebSocket error: {}", e);
                break;
            }
        }
    }
}

async fn run_command(command: &str, sender: Arc<tokio::sync::Mutex<futures::stream::SplitSink<WebSocket, WsMessage>>>) {
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(60),
        run_command_inner(command, sender.clone())
    ).await;

    if result.is_err() {
        let payload = serde_json::json!({"status": "error", "message": "Command timed out after 60 seconds"}).to_string();
        let _ = sender.lock().await.send(WsMessage::Text(payload)).await;
    }
}

async fn run_command_inner(command: &str, sender: Arc<tokio::sync::Mutex<futures::stream::SplitSink<WebSocket, WsMessage>>>) {
    let mut child = match Command::new("nsjail")
        .args(&[
            "--config", "/etc/nsjail.cfg",
            "--",
            "/bin/sh", "-c", command,
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            let payload = serde_json::json!({"status": "error", "message": e.to_string()}).to_string();
            let _ = sender.lock().await.send(WsMessage::Text(payload)).await;
            return;
        }
    };

    let stdout = child.stdout.take().expect("stdout was piped");
    let stderr = child.stderr.take().expect("stderr was piped");

    let stdout_reader = tokio::io::BufReader::new(stdout);
    let stderr_reader = tokio::io::BufReader::new(stderr);

    let sender_stdout = sender.clone();
    let sender_stderr = sender.clone();

    let stdout_task = async move {
        use tokio::io::AsyncBufReadExt;
        let mut lines = stdout_reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let payload = serde_json::json!({"type": "stdout", "data": line}).to_string();
            let _ = sender_stdout.lock().await.send(WsMessage::Text(payload)).await;
        }
    };

    let stderr_task = async move {
        use tokio::io::AsyncBufReadExt;
        let mut lines = stderr_reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let payload = serde_json::json!({"type": "stderr", "data": line}).to_string();
            let _ = sender_stderr.lock().await.send(WsMessage::Text(payload)).await;
        }
    };

    tokio::join!(stdout_task, stderr_task);

    match child.wait().await {
        Ok(status) => {
            let code = status.code().unwrap_or(-1);
            let status_str = if status.success() { "success" } else { "error" };
            let payload = serde_json::json!({"status": status_str, "code": code}).to_string();
            let _ = sender.lock().await.send(WsMessage::Text(payload)).await;
        }
        Err(e) => {
            let payload = serde_json::json!({"status": "error", "message": e.to_string()}).to_string();
            let _ = sender.lock().await.send(WsMessage::Text(payload)).await;
        }
    }
}
