use axum::{
    extract::{ws::{Message as WsMessage, WebSocket, WebSocketUpgrade}, State, Json},
    response::Response,
    routing::{get, post},
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

#[derive(serde::Deserialize)]
struct RunRequest {
    command: Vec<String>,
}

#[derive(serde::Serialize)]
struct RunResponse {
    stdout: String,
    stderr: String,
    status: String,
    code: Option<i32>,
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
        .route("/run", post(http_execute))
        .with_state(state);

    let port = std::env::var("PORT").unwrap_or_else(|_| "8081".to_string());
    let addr = format!("0.0.0.0:{}", port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("Sandbox listening on {}", addr);
    axum::serve(listener, app).await?;
    Ok(())
}

async fn http_execute(
    State(state): State<SandboxState>,
    Json(req): Json<RunRequest>,
) -> Result<Json<RunResponse>, axum::http::StatusCode> {
    let _permit = state.semaphore.acquire().await.map_err(|_| axum::http::StatusCode::SERVICE_UNAVAILABLE)?;

    let use_nsjail = Command::new("which").arg("nsjail").output().await
        .map(|o| o.status.success())
        .unwrap_or(false);

    let mut child = if use_nsjail {
        let mut cmd = Command::new("nsjail");
        cmd.args(&["--config", "/etc/nsjail.cfg", "--"]);
        cmd.args(&req.command);
        cmd.stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
    } else {
        if req.command.is_empty() {
            return Err(axum::http::StatusCode::BAD_REQUEST);
        }
        let mut cmd = Command::new(&req.command[0]);
        if req.command.len() > 1 {
            cmd.args(&req.command[1..]);
        }
        cmd.stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
    }.map_err(|e| {
        tracing::error!("Failed to spawn command: {}", e);
        axum::http::StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let result = tokio::time::timeout(
        std::time::Duration::from_secs(60),
        async {
            let mut stdout_buf = Vec::new();
            let mut stderr_buf = Vec::new();

            let mut stdout_reader = tokio::io::BufReader::new(child.stdout.take().expect("stdout piped"));
            let mut stderr_reader = tokio::io::BufReader::new(child.stderr.take().expect("stderr piped"));

            let stdout_fut = tokio::io::AsyncReadExt::read_to_end(&mut stdout_reader, &mut stdout_buf);
            let stderr_fut = tokio::io::AsyncReadExt::read_to_end(&mut stderr_reader, &mut stderr_buf);

            let (stdout_res, stderr_res) = tokio::join!(stdout_fut, stderr_fut);
            if stdout_res.is_err() || stderr_res.is_err() {
                return Err("Failed to read output");
            }

            let status = child.wait().await.map_err(|_| "Wait failed")?;

            Ok(RunResponse {
                stdout: String::from_utf8_lossy(&stdout_buf).to_string(),
                stderr: String::from_utf8_lossy(&stderr_buf).to_string(),
                status: if status.success() { "success".to_string() } else { "error".to_string() },
                code: status.code(),
            })
        }
    ).await;

    match result {
        Ok(Ok(resp)) => Ok(Json(resp)),
        Ok(Err(e)) => {
            tracing::error!("Command execution error: {}", e);
            Err(axum::http::StatusCode::INTERNAL_SERVER_ERROR)
        }
        Err(_) => Ok(Json(RunResponse {
            stdout: String::new(),
            stderr: "Command timed out after 60 seconds".to_string(),
            status: "timeout".to_string(),
            code: Some(-1),
        })),
    }
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
                let command: Vec<String> = match cmd["command"].as_array() {
                    Some(arr) => arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect(),
                    None => {
                        let s = cmd["command"].as_str().unwrap_or("").to_string();
                        if s.is_empty() { vec![] } else { vec!["/bin/sh".to_string(), "-c".to_string(), s] }
                    }
                };
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
                    run_command(command, sender_clone).await;
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

async fn run_command(command: Vec<String>, sender: Arc<tokio::sync::Mutex<futures::stream::SplitSink<WebSocket, WsMessage>>>) {
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(60),
        run_command_inner(command, sender.clone())
    ).await;

    if result.is_err() {
        let payload = serde_json::json!({"status": "error", "message": "Command timed out after 60 seconds"}).to_string();
        let _ = sender.lock().await.send(WsMessage::Text(payload)).await;
    }
}

async fn run_command_inner(command: Vec<String>, sender: Arc<tokio::sync::Mutex<futures::stream::SplitSink<WebSocket, WsMessage>>>) {
    // Check if nsjail is available; fall back to direct execution for local dev
    let use_nsjail = Command::new("which").arg("nsjail").output().await
        .map(|o| o.status.success())
        .unwrap_or(false);

    let mut child = if use_nsjail {
        let mut cmd = Command::new("nsjail");
        cmd.args(&["--config", "/etc/nsjail.cfg", "--"]);
        cmd.args(&command);
        match cmd
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
        }
    } else {
        if command.is_empty() {
            return;
        }
        let mut cmd = Command::new(&command[0]);
        if command.len() > 1 {
            cmd.args(&command[1..]);
        }
        match cmd
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
