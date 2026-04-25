use axum::{
    extract::{ws::{Message as WsMessage, WebSocket, WebSocketUpgrade}, State},
    response::Response,
    routing::get,
    Router,
};
use futures::{SinkExt, StreamExt};
use std::sync::Arc;
use tokio::process::Command;
use tokio::sync::Mutex;

#[derive(Clone)]
struct SandboxState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .json()
        .init();

    let state = SandboxState;
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
    State(_state): State<SandboxState>,
) -> Response {
    ws.on_upgrade(handle_socket)
}

async fn handle_socket(socket: WebSocket) {
    let (sender, mut receiver) = socket.split();
    let sender = Arc::new(Mutex::new(sender));

    while let Some(Ok(msg)) = receiver.next().await {
        if let WsMessage::Text(text) = msg {
            let cmd: serde_json::Value = match serde_json::from_str(&text) {
                Ok(v) => v,
                Err(_) => continue,
            };
            let command = cmd["command"].as_str().unwrap_or("").to_string();
            if command.is_empty() {
                continue;
            }

            let sender_clone = sender.clone();
            tokio::spawn(async move {
                run_command(&command, sender_clone).await;
            });
        }
    }
}

async fn run_command(command: &str, sender: Arc<Mutex<futures::stream::SplitSink<WebSocket, WsMessage>>>) {
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

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    let mut stdout_reader = tokio::io::BufReader::new(stdout);
    let mut stderr_reader = tokio::io::BufReader::new(stderr);

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
