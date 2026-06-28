use std::collections::HashMap;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};
use std::process::Stdio;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
#[cfg(unix)]
use tokio::io::unix::AsyncFd;
use tokio::process::Command;
use tokio::sync::{mpsc, Mutex, Semaphore};

use nix::errno::Errno;
use nix::fcntl::{fcntl, FdFlag, FcntlArg, OFlag};
use nix::ioctl_write_ptr_bad;
use nix::libc::{self, TIOCSWINSZ};
use nix::pty::{openpty, OpenptyResult, Winsize};
use nix::sys::signal::{kill, Signal};
use nix::unistd::{close, dup, setpgid, setsid, Pid};

const ROOTFS_PATH: &str = "/app/ubuntu-rootfs";
const WORKSPACE_GUEST_PATH: &str = "/workspace";

/// Invisible OSC sequence used to report cwd from shell to backend.
/// Format: ESC ] 51 ; CWD ; <path> BEL
const CWD_OSC_PREFIX: &str = "\x1b]51;CWD;";
const CWD_OSC_SUFFIX: char = '\x07';

#[derive(Clone)]
pub struct SandboxState {
    pub semaphore: Arc<Semaphore>,
    pub sessions: Arc<Mutex<HashMap<(String, String), ShellSessionHandle>>>,
}

impl SandboxState {
    pub fn new() -> Self {
        Self {
            semaphore: Arc::new(Semaphore::new(4)),
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl Default for SandboxState {
    fn default() -> Self {
        Self::new()
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
fn build_proot_command(cmd: &[&str], workspace_id: &str) -> Result<Command, String> {
    if !has_proot_env() {
        return Err("Sandbox environment (proot + Ubuntu rootfs) is not available. \
                    Cannot execute commands safely without isolation.".to_string());
    }

    let workspace_dir = std::env::var("WORKSPACE_DIR").unwrap_or_else(|_| "./workspace".to_string());
    let host_workspace = std::path::Path::new(&workspace_dir).join(workspace_id);
    let _ = std::fs::create_dir_all(&host_workspace);
    let host_path_str = host_workspace.to_string_lossy();

    let mut command = Command::new("proot");
    command.args([
        "-0", // Fake root privileges so apt-get works
        "-R",
        ROOTFS_PATH,
        "-b",
        &format!("{}:{}", host_path_str, WORKSPACE_GUEST_PATH),
        "-b",
        "/dev:/dev",
        "-b",
        "/proc:/proc",
        "-b",
        "/tmp:/tmp",
        "-b",
        "/etc/resolv.conf:/etc/resolv.conf", // Enable DNS resolution
        "-w",
        WORKSPACE_GUEST_PATH,
    ]);
    command.args(cmd);
    Ok(command)
}

/// Execute a command and return the complete output (for AI tool calling).
/// This remains stateless and does not interfere with user terminal sessions.
pub async fn run_command_http(cmd: &[&str], workspace_id: &str, state: &SandboxState) -> Result<RunResponse, String> {
    let _permit = state.semaphore.acquire().await.map_err(|e| e.to_string())?;

    let mut child = build_proot_command(cmd, workspace_id)?
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

        // Safe UTF-8 truncation: find nearest char boundary
        if stdout_str.len() > 100_000 {
            let mut idx = 100_000;
            while idx > 0 && !stdout_str.is_char_boundary(idx) {
                idx -= 1;
            }
            stdout_str.truncate(idx);
            stdout_str.push_str("\n...[output truncated]...");
        }
        if stderr_str.len() > 100_000 {
            let mut idx = 100_000;
            while idx > 0 && !stderr_str.is_char_boundary(idx) {
                idx -= 1;
            }
            stderr_str.truncate(idx);
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
        Err(_) => {
            let _ = child.kill().await;
            Ok(RunResponse {
                stdout: String::new(),
                stderr: "Command timed out after 120 seconds".to_string(),
                status: "timeout".to_string(),
                code: Some(-1),
            })
        }
    }
}

/// Handle to a persistent interactive shell session (one per user/tab).
#[derive(Clone)]
pub struct ShellSessionHandle {
    pub user_id: String,
    pub tab_id: String,
    pub shell_pid: i32,
    pub input_tx: mpsc::UnboundedSender<Vec<u8>>,
    pub resize_tx: mpsc::UnboundedSender<Winsize>,
    pub cwd: Arc<Mutex<String>>,
    pub command_running: Arc<AtomicBool>,
}

impl ShellSessionHandle {
    pub fn send_input(&self, data: Vec<u8>) {
        let _ = self.input_tx.send(data);
    }

    pub fn kill_foreground(&self) {
        // Send SIGINT to the process group of the shell. This is exactly what
        // a real terminal does when Ctrl+C is pressed.
        let _ = kill(Pid::from_raw(-self.shell_pid), Signal::SIGINT);
    }

    pub fn resize(&self, winsize: Winsize) {
        let _ = self.resize_tx.send(winsize);
    }
}

/// Output messages sent from the PTY session to the WebSocket route.
#[derive(Clone, Debug)]
pub enum ShellOutput {
    /// Raw terminal bytes for the frontend xterm.
    Data(Vec<u8>),
    /// Current working directory changed.
    Cwd(String),
    /// Command execution state changed.
    Status { running: bool, code: Option<i32> },
}

/// Spawn or attach to a persistent PTY-based bash session for a user/tab.
pub async fn get_or_create_shell_session(
    state: SandboxState,
    user_id: String,
    tab_id: String,
    output_tx: mpsc::UnboundedSender<ShellOutput>,
) -> Result<ShellSessionHandle, String> {
    let key = (user_id.clone(), tab_id.clone());
    {
        let sessions = state.sessions.lock().await;
        if let Some(handle) = sessions.get(&key) {
            return Ok(handle.clone());
        }
    }

    let semaphore = state.semaphore.clone();
    let permit = semaphore
        .acquire_owned()
        .await
        .map_err(|e| e.to_string())?;

    if !has_proot_env() {
        return Err("Sandbox environment (proot + Ubuntu rootfs) is not available.".to_string());
    }

    // Open PTY master/slave pair.
    let OpenptyResult { master: master_fd, slave: slave_fd } = openpty(
        &Winsize {
            ws_row: 24,
            ws_col: 80,
            ws_xpixel: 0,
            ws_ypixel: 0,
        },
        None,
    )
    .map_err(|e| {
        tracing::error!(user_id = %user_id, tab_id = %tab_id, error = %e, "Failed to open PTY");
        format!("Failed to open PTY: {}", e)
    })?;

    let slave_raw = slave_fd.as_raw_fd();

    // Make the master fd non-blocking so AsyncFd can use it with epoll.
    // Set FD_CLOEXEC so the child doesn't inherit the master fd.
    if let Err(e) = prepare_master_fd(&master_fd) {
        let _ = close(slave_raw);
        return Err(format!("PTY master setup: {}", e));
    }

    let workspace_dir = std::env::var("WORKSPACE_DIR").unwrap_or_else(|_| "./workspace".to_string());
    let host_workspace = std::path::Path::new(&workspace_dir).join(&user_id);
    let _ = std::fs::create_dir_all(&host_workspace);
    let host_path_str = host_workspace.to_string_lossy().to_string();

    // Dup the slave fd three times for stdin/stdout/stderr. We convert each dup
    // into a Stdio so tokio::process owns and closes them after spawn.
    let stdin_fd = dup(&slave_fd).map_err(|e| format!("dup slave for stdin: {}", e))?;
    let stdout_fd = dup(&slave_fd).map_err(|e| format!("dup slave for stdout: {}", e))?;
    let stderr_fd = dup(&slave_fd).map_err(|e| format!("dup slave for stderr: {}", e))?;

    // The parent no longer needs the slave fd — the child has its own dups.
    let _ = close(slave_fd);

    let stdin_stdio = unsafe { Stdio::from_raw_fd(stdin_fd.as_raw_fd()) };
    let stdout_stdio = unsafe { Stdio::from_raw_fd(stdout_fd.as_raw_fd()) };
    let stderr_stdio = unsafe { Stdio::from_raw_fd(stderr_fd.as_raw_fd()) };

    // Prevent OwnedFd drop from closing these fds — Stdio owns them now.
    std::mem::forget(stdin_fd);
    std::mem::forget(stdout_fd);
    std::mem::forget(stderr_fd);

    // Spawn proot+bash with the PTY slave as stdio. pre_exec runs in the child
    // after fork() but before exec(), which is the fork-safe way to set up
    // process group, session, and controlling terminal.
    let mut cmd = Command::new("proot");
    cmd.args([
        "-0",
        "-R",
        ROOTFS_PATH,
        "-b",
        &format!("{}:{}", host_path_str, WORKSPACE_GUEST_PATH),
        "-b",
        "/dev:/dev",
        "-b",
        "/proc:/proc",
        "-b",
        "/tmp:/tmp",
        "-b",
        "/etc/resolv.conf:/etc/resolv.conf",
        "-w",
        WORKSPACE_GUEST_PATH,
        "/bin/bash",
        "--norc",
        "-i",
    ]);
    cmd.stdin(stdin_stdio)
        .stdout(stdout_stdio)
        .stderr(stderr_stdio)
        // Set shell environment via Command::env so bash starts with the right
        // config immediately — no visible echo of setup commands.
        .env("TERM", "xterm-256color")
        .env(
            "PROMPT_COMMAND",
            r#"printf "\033]51;CWD;%s\007" "$(pwd)""#,
        )
        .env("PS1", "$(pwd) → ");
    unsafe {
        cmd.pre_exec(move || {
            // This closure runs in the child process after fork, before exec.
            // It must be async-signal-safe: no allocation, no tracing, no locks.
            setpgid(Pid::from_raw(0), Pid::from_raw(0))
                .map_err(|e| std::io::Error::from_raw_os_error(e as i32))?;

            // Try to create a new session + controlling terminal. Use fd 0
            // (stdin) which is guaranteed to be the PTY slave in the child.
            // The original slave fd number may be closed in the child, but the
            // dup'd stdin/stdout/stderr (fds 0/1/2) all refer to the same PTY.
            // Non-fatal if the container denies it — bash still runs via PTY.
            if setsid().is_ok() {
                libc::ioctl(0, libc::TIOCSCTTY, 0);
            }
            Ok(())
        });
    }

    let child = cmd.spawn().map_err(|e| {
        let _ = close(master_fd.as_raw_fd());
        format!("Failed to spawn proot bash: {}", e)
    })?;

    let child_pid = child.id().expect("child has pid") as i32;

    // Lower the child process priority so proot's ptrace overhead does not
    // starve the Tokio runtime on single-CPU machines.
    unsafe {
        let _ = libc::setpriority(
            libc::PRIO_PROCESS,
            child_pid as libc::id_t,
            10,
        );
    }

    tracing::info!(
        user_id = %user_id,
        tab_id = %tab_id,
        shell_pid = child_pid,
        "Spawned PTY shell session (Command::spawn + AsyncFd)"
    );

    let (input_tx, input_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let (resize_tx, resize_rx) = mpsc::unbounded_channel::<Winsize>();
    let cwd = Arc::new(Mutex::new(WORKSPACE_GUEST_PATH.to_string()));
    let command_running = Arc::new(AtomicBool::new(false));

    let handle = ShellSessionHandle {
        user_id: user_id.clone(),
        tab_id: tab_id.clone(),
        shell_pid: child_pid,
        input_tx,
        resize_tx,
        cwd: cwd.clone(),
        command_running: command_running.clone(),
    };

    {
        let mut sessions = state.sessions.lock().await;
        sessions.insert(key.clone(), handle.clone());
    }

    tokio::spawn(run_pty_session(
        child,
        child_pid,
        master_fd,
        input_rx,
        resize_rx,
        output_tx,
        cwd,
        command_running,
        state.sessions,
        user_id,
        tab_id,
        permit,
    ));

    Ok(handle)
}

/// Set the master fd to non-blocking (for epoll/AsyncFd) and clear FD_CLOEXEC
/// (so it survives across the tokio internals — though the child doesn't need it,
/// AsyncFd manages the fd lifecycle).
fn prepare_master_fd(fd: &OwnedFd) -> Result<(), String> {
    let flags = fcntl(fd, FcntlArg::F_GETFD).map_err(|e| format!("fcntl F_GETFD: {}", e))?;
    let new_flags = FdFlag::from_bits_truncate(flags) & !FdFlag::FD_CLOEXEC;
    fcntl(fd, FcntlArg::F_SETFD(new_flags)).map_err(|e| format!("fcntl F_SETFD: {}", e))?;

    let fl = fcntl(fd, FcntlArg::F_GETFL)
        .map_err(|e| format!("F_GETFL failed: {}", e))?;
    let new_fl = OFlag::from_bits_truncate(fl) | OFlag::O_NONBLOCK;
    fcntl(fd, FcntlArg::F_SETFL(new_fl))
        .map_err(|e| format!("F_SETFL O_NONBLOCK failed: {}", e))?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn run_pty_session(
    child: tokio::process::Child,
    child_pid: i32,
    master_fd: OwnedFd,
    mut input_rx: mpsc::UnboundedReceiver<Vec<u8>>,
    mut resize_rx: mpsc::UnboundedReceiver<Winsize>,
    output_tx: mpsc::UnboundedSender<ShellOutput>,
    cwd: Arc<Mutex<String>>,
    _command_running: Arc<AtomicBool>,
    sessions: Arc<Mutex<HashMap<(String, String), ShellSessionHandle>>>,
    user_id: String,
    tab_id: String,
    _permit: tokio::sync::OwnedSemaphorePermit,
) {
    let master_raw = master_fd.as_raw_fd();

    // Register the PTY master fd with Tokio's epoll via AsyncFd. This lets us
    // do async read/write on the fd without spawning any OS threads.
    let async_master = match AsyncFd::new(master_fd) {
        Ok(fd) => fd,
        Err(e) => {
            let _ = output_tx.send(ShellOutput::Data(
                format!("\r\nPTY AsyncFd error: {}\r\n", e).into_bytes(),
            ));
            cleanup_session(&sessions, &user_id, &tab_id).await;
            return;
        }
    };

    // Spawn the reaper: async wait for child exit. This replaces the old
    // waitpid polling loop (100ms sleep) with a single async .wait().await.
    // The reaper owns the Child and sends the exit code through a channel.
    let (reaper_tx, mut reaper_rx) = mpsc::channel::<Option<i32>>(1);
    let mut child = child;
    let output_tx_for_reaper = output_tx.clone();
    tokio::spawn(async move {
        let status = child.wait().await;
        let code = match status {
            Ok(s) => {
                if let Some(c) = s.code() {
                    Some(c)
                } else {
                    #[cfg(unix)]
                    {
                        use std::os::unix::process::ExitStatusExt;
                        s.signal().map(|sig| 128 + sig)
                    }
                    #[cfg(not(unix))]
                    {
                        None
                    }
                }
            }
            Err(_) => Some(-1),
        };
        let _ = output_tx_for_reaper.send(ShellOutput::Status {
            running: false,
            code,
        });
        let _ = reaper_tx.send(code).await;
    });

    // Main async loop: read PTY output, write PTY input, handle resize, detect exit.
    // Everything is async via AsyncFd + tokio::select! — zero OS threads.
    let mut leftover: Vec<u8> = Vec::new();
    let mut read_buf = [0u8; 4096];

    loop {
        tokio::select! {
            biased;

            // Child exited
            Some(_code) = reaper_rx.recv() => {
                break;
            }

            // PTY master is readable — read terminal output
            guard = async_master.readable() => {
                match guard {
                    Ok(mut guard) => {
                        match guard.try_io(|inner| {
                            let fd = inner.get_ref().as_raw_fd();
                            let n = unsafe {
                                libc::read(fd, read_buf.as_mut_ptr() as *mut libc::c_void, read_buf.len())
                            };
                            if n > 0 {
                                Ok(Some(read_buf[..n as usize].to_vec()))
                            } else if n == 0 {
                                Ok(None) // EOF
                            } else {
                                let err = Errno::last();
                                if err == Errno::EAGAIN || err == Errno::EINTR {
                                    Err(std::io::Error::from(std::io::ErrorKind::WouldBlock))
                                } else {
                                    Err(std::io::Error::from_raw_os_error(err as i32))
                                }
                            }
                        }) {
                            Ok(Ok(Some(data))) => {
                                leftover.extend_from_slice(&data);
                                let (output, new_leftover, parsed_cwd) = strip_osc_sequences(&leftover);
                                leftover = new_leftover;
                                if let Some(new_cwd) = parsed_cwd {
                                    {
                                        let mut c = cwd.lock().await;
                                        *c = new_cwd.clone();
                                    }
                                    let _ = output_tx.send(ShellOutput::Cwd(new_cwd));
                                }
                                let filtered = filter_bash_warnings(&output);
                                if !filtered.is_empty() {
                                    let _ = output_tx.send(ShellOutput::Data(filtered));
                                }
                            }
                            Ok(Ok(None)) => {
                                // EOF — shell closed the PTY
                                break;
                            }
                            Ok(Err(_)) => {
                                // Read error
                                break;
                            }
                            Err(_) => {
                                // try_io would block — guard.clear_ready() already called
                                continue;
                            }
                        }
                    }
                    Err(_) => break,
                }
            }

            // Input from WebSocket — write to PTY master
            Some(data) = input_rx.recv() => {
                if let Err(e) = async_write_all(&async_master, master_raw, &data).await {
                    let _ = output_tx.send(ShellOutput::Data(
                        format!("\r\nPTY write error: {}\r\n", e).into_bytes(),
                    ));
                    break;
                }
            }

            // Terminal resize
            Some(ws) = resize_rx.recv() => {
                unsafe {
                    let _ = set_winsize(master_raw, &ws);
                }
            }
        }
    }

    // Cleanup: kill child if still alive, remove session from map.
    let _ = kill(Pid::from_raw(child_pid), Signal::SIGTERM);
    cleanup_session(&sessions, &user_id, &tab_id).await;
}

/// Write all data to the PTY master fd asynchronously via AsyncFd.
/// Returns Ok when all bytes are written, or Err on a real write error.
async fn async_write_all(
    async_fd: &AsyncFd<OwnedFd>,
    fd: RawFd,
    data: &[u8],
) -> Result<(), String> {
    let mut written = 0usize;
    while written < data.len() {
        let mut guard = async_fd.writable().await.map_err(|e| format!("AsyncFd writable: {}", e))?;

        match guard.try_io(|_inner| {
            let n = unsafe {
                libc::write(fd, data[written..].as_ptr() as *const libc::c_void, data.len() - written)
            };
            if n >= 0 {
                Ok(n as usize)
            } else {
                let err = Errno::last();
                if err == Errno::EAGAIN || err == Errno::EINTR {
                    Err(std::io::Error::from(std::io::ErrorKind::WouldBlock))
                } else {
                    Err(std::io::Error::from_raw_os_error(err as i32))
                }
            }
        }) {
            Ok(Ok(0)) => {
                continue;
            }
            Ok(Ok(n)) => {
                written += n;
            }
            Ok(Err(e)) => {
                return Err(format!("PTY write error: {}", e));
            }
            Err(_) => {
                continue;
            }
        }
    }
    Ok(())
}

ioctl_write_ptr_bad!(set_winsize, TIOCSWINSZ, Winsize);

fn strip_osc_sequences(data: &[u8]) -> (Vec<u8>, Vec<u8>, Option<String>) {
    let mut output = Vec::with_capacity(data.len());
    let mut i = 0;
    let mut parsed_cwd: Option<String> = None;
    while i < data.len() {
        if data[i] == 0x1b && i + 1 < data.len() && data[i + 1] == b']' {
            // Start of OSC sequence. Try to find BEL (0x07) or ST (ESC \).
            if let Some(end) = find_osc_end(data, i) {
                let seq = std::str::from_utf8(&data[i..=end]).unwrap_or("");
                if let Some(cwd) = parse_cwd_osc(seq) {
                    parsed_cwd = Some(cwd);
                }
                i = end + 1;
                continue;
            } else {
                // Incomplete OSC: keep from i onward as leftover.
                return (output, data[i..].to_vec(), parsed_cwd);
            }
        }
        output.push(data[i]);
        i += 1;
    }
    (output, Vec::new(), parsed_cwd)
}

/// Bash prints these warnings when it cannot acquire the PTY as its controlling
/// terminal (which happens under proot in some container setups). They are
/// harmless — bash still runs interactively via the PTY — but they look
/// unprofessional. Strip them from the terminal output.
///
/// Handles the case where the warning lines are split across reads by keeping
/// an incomplete line in the returned leftover.
const BASH_WARNINGS: &[&str] = &[
    "bash: cannot set terminal process group",
    "bash: no job control in this shell",
];

fn filter_bash_warnings(data: &[u8]) -> Vec<u8> {
    let text = match std::str::from_utf8(data) {
        Ok(s) => s,
        Err(_) => return data.to_vec(), // non-UTF8 — pass through (binary data)
    };

    let mut result = String::with_capacity(text.len());
    for line in text.split_inclusive('\n') {
        let trimmed = line.trim_start();
        if BASH_WARNINGS.iter().any(|w| trimmed.starts_with(w)) {
            continue;
        }
        result.push_str(line);
    }
    result.into_bytes()
}

fn find_osc_end(data: &[u8], start: usize) -> Option<usize> {
    for j in (start + 2)..data.len() {
        if data[j] == 0x07 {
            return Some(j);
        }
        if data[j] == 0x1b && j + 1 < data.len() && data[j + 1] == b'\\' {
            return Some(j + 1);
        }
    }
    None
}

fn parse_cwd_osc(seq: &str) -> Option<String> {
    let seq = seq.strip_prefix(CWD_OSC_PREFIX)?;
    let seq = seq
        .strip_suffix(CWD_OSC_SUFFIX.to_string().as_str())
        .or_else(|| seq.strip_suffix("\x1b\\"))?;
    Some(seq.to_string())
}

async fn cleanup_session(
    sessions: &Arc<Mutex<HashMap<(String, String), ShellSessionHandle>>>,
    user_id: &str,
    tab_id: &str,
) {
    let mut sessions = sessions.lock().await;
    sessions.remove(&(user_id.to_string(), tab_id.to_string()));
}