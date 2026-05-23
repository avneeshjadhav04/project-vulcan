use std::sync::Arc;
use tokio::process::Command;
use tokio::sync::{mpsc, Semaphore};

const ROOTFS_PATH: &str = "/app/ubuntu-rootfs";
const WORKSPACE_HOST_PATH: &str = "/app/workspace";
const WORKSPACE_GUEST_PATH: &str = "/workspace";

#[derive(Clone)]
pub struct SandboxState {
    pub semaphore: Arc<Semaphore>,
}

impl SandboxState {
    pub fn new() -> Self {
        Self {
            semaphore: Arc::new(Semaphore::new(4)),
        }
    }
}

#[derive(serde::Serialize)]
pub struct RunResponse {
    pub stdout: String,
    pub stderr: String,
    pub status: String,
    pub code: Option<i32>,
}

/// Verify that proot and the Ubuntu rootfs are available.
fn has_proot_env() -> bool {
    let proot_exists = std::process::Command::new("which")
        .arg("proot")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    
    proot_exists && std::path::Path::new(ROOTFS_PATH).exists()
}

/// Build a Command that runs inside the proot Ubuntu environment.
fn build_proot_command(cmd: &[&str]) -> Result<Command, String> {
    if !has_proot_env() {
        let mut command = Command::new(cmd[0]);
        if cmd.len() > 1 {
            command.args(&cmd[1..]);
        }
        
        let workspace_path = std::env::var("WORKSPACE_PATH")
            .unwrap_or_else(|_| "/workspace".to_string());
        
        if std::path::Path::new(&workspace_path).exists() {
            command.current_dir(workspace_path);
        }
        
        return Ok(command);
    }

    let mut command = Command::new("proot");
    command.args([
        "-R",
        ROOTFS_PATH,
        "-b",
        &format!("{}:{}", WORKSPACE_HOST_PATH, WORKSPACE_GUEST_PATH),
        "-b",
        "/dev:/dev",
        "-b",
        "/proc:/proc",
        "-b",
        "/tmp:/tmp",
        "-w",
        WORKSPACE_GUEST_PATH,
        "--",
    ]);
    command.args(cmd);
    Ok(command)
}

/// Execute a command and return the complete output (for AI tool calling).
pub async fn run_command_http(cmd: &[&str], state: &SandboxState) -> Result<RunResponse, String> {
    let _permit = state.semaphore.acquire().await.map_err(|e| e.to_string())?;

    let mut child = build_proot_command(cmd)?
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn command: {}", e))?;

    let result = tokio::time::timeout(std::time::Duration::from_secs(120), async {
        let mut stdout_buf = Vec::new();
        let mut stderr_buf = Vec::new();

        let mut stdout_reader =
            tokio::io::BufReader::new(child.stdout.take().expect("stdout piped"));
        let mut stderr_reader =
            tokio::io::BufReader::new(child.stderr.take().expect("stderr piped"));

        let stdout_fut = tokio::io::AsyncReadExt::read_to_end(&mut stdout_reader, &mut stdout_buf);
        let stderr_fut = tokio::io::AsyncReadExt::read_to_end(&mut stderr_reader, &mut stderr_buf);

        let (stdout_res, stderr_res) = tokio::join!(stdout_fut, stderr_fut);
        if stdout_res.is_err() || stderr_res.is_err() {
            return Err("Failed to read output".to_string());
        }

        let status = child.wait().await.map_err(|e| e.to_string())?;

        let mut stdout_str = String::from_utf8_lossy(&stdout_buf).into_owned();
        let mut stderr_str = String::from_utf8_lossy(&stderr_buf).into_owned();

        if stdout_str.len() > 100_000 {
            stdout_str.truncate(100_000);
            stdout_str.push_str("\n...[output truncated]...");
        }
        if stderr_str.len() > 100_000 {
            stderr_str.truncate(100_000);
            stderr_str.push_str("\n...[output truncated]...");
        }

        Ok(RunResponse {
            stdout: stdout_str,
            stderr: stderr_str,
            status: if status.success() {
                "success".to_string()
            } else {
                "error".to_string()
            },
            code: status.code(),
        })
    })
    .await;

    match result {
        Ok(Ok(resp)) => Ok(resp),
        Ok(Err(e)) => Err(e),
        Err(_) => Ok(RunResponse {
            stdout: String::new(),
            stderr: "Command timed out after 120 seconds".to_string(),
            status: "timeout".to_string(),
            code: Some(-1),
        }),
    }
}

/// Spawn a command and stream JSON output messages via a channel (for terminal WebSocket).
/// Messages follow the format expected by the frontend terminal:
/// - `{"type":"stdout","data":"..."}`
/// - `{"type":"stderr","data":"..."}`
/// - `{"status":"success|error","code":N}`
pub async fn run_command_stream(
    cmd: Vec<String>,
    state: SandboxState,
) -> Result<mpsc::UnboundedReceiver<String>, String> {
    let (tx, rx) = mpsc::unbounded_channel();

    let semaphore = state.semaphore.clone();

    tokio::spawn(async move {
        let permit = match semaphore.acquire().await {
            Ok(p) => p,
            Err(_) => {
                let _ = tx.send(
                    serde_json::json!({"status": "error", "message": "Server overloaded"})
                        .to_string(),
                );
                return;
            }
        };
        let _permit = permit; // hold permit for duration of command
        run_command_inner(cmd, tx).await;
    });

    Ok(rx)
}

async fn run_command_inner(cmd: Vec<String>, sender: mpsc::UnboundedSender<String>) {
    let cmd_refs: Vec<&str> = cmd.iter().map(|s| s.as_str()).collect();
    let mut child = match build_proot_command(&cmd_refs) {
        Ok(mut c) => match c
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                let _ = sender.send(
                    serde_json::json!({"status": "error", "message": e.to_string()}).to_string(),
                );
                return;
            }
        },
        Err(e) => {
            let _ = sender.send(serde_json::json!({"status": "error", "message": e}).to_string());
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
            let _ = sender_stdout.send(payload);
        }
    };

    let stderr_task = async move {
        use tokio::io::AsyncBufReadExt;
        let mut lines = stderr_reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let payload = serde_json::json!({"type": "stderr", "data": line}).to_string();
            let _ = sender_stderr.send(payload);
        }
    };

    tokio::join!(stdout_task, stderr_task);

    match child.wait().await {
        Ok(status) => {
            let code = status.code().unwrap_or(-1);
            let status_str = if status.success() { "success" } else { "error" };
            let payload = serde_json::json!({"status": status_str, "code": code}).to_string();
            let _ = sender.send(payload);
        }
        Err(e) => {
            let payload =
                serde_json::json!({"status": "error", "message": e.to_string()}).to_string();
            let _ = sender.send(payload);
        }
    }
}
