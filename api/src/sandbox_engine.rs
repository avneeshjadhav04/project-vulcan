use std::collections::HashMap;
use std::os::fd::{AsRawFd, OwnedFd, RawFd};
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use tokio::process::Command;
use tokio::sync::{mpsc, Mutex, Semaphore};

use nix::errno::Errno;
use nix::fcntl::{fcntl, FdFlag, OFlag};
use nix::ioctl_write_ptr_bad;
use nix::libc::{self, TIOCSWINSZ};
use nix::pty::{openpty, OpenptyResult, Winsize};
use nix::sys::signal::{kill, Signal};
use nix::sys::wait::{waitpid, WaitPidFlag, WaitStatus};
use nix::unistd::{close, execv, fork, ForkResult, Pid, setpgid, setsid};

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

    let workspace_dir = std::env::var("WORKSPACE_DIR").unwrap_or_else(|_| "./workspace".to_string());
    let host_workspace = std::path::Path::new(&workspace_dir).join(&user_id);
    let _ = std::fs::create_dir_all(&host_workspace);
    let host_path_str = host_workspace.to_string_lossy().to_string();

    let (input_tx, input_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let (resize_tx, resize_rx) = mpsc::unbounded_channel::<Winsize>();
    let cwd = Arc::new(Mutex::new(WORKSPACE_GUEST_PATH.to_string()));
    let command_running = Arc::new(AtomicBool::new(false));

    // Spawn the shell from a fully detached std::thread, never from Tokio.
    // Forking from any Tokio-managed thread (including spawn_blocking) corrupts
    // the runtime because the child inherits Tokio-internal FDs and state.
    let (spawn_tx, spawn_rx) = tokio::sync::oneshot::channel::<Result<(Pid, OwnedFd), String>>();
    std::thread::spawn(move || {
        let res = spawn_pty_shell(slave_fd, master_fd, &host_path_str);
        let _ = spawn_tx.send(res);
    });

    let (child_pid, master_fd) = match spawn_rx.await {
        Ok(Ok(res)) => res,
        Ok(Err(e)) => return Err(e),
        Err(_) => return Err("PTY spawn thread was dropped".to_string()),
    };

    tracing::info!(
        user_id = %user_id,
        tab_id = %tab_id,
        shell_pid = child_pid.as_raw(),
        "Spawned PTY shell session"
    );

    let handle = ShellSessionHandle {
        user_id: user_id.clone(),
        tab_id: tab_id.clone(),
        shell_pid: child_pid.as_raw(),
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

/// Spawn the shell in a dedicated thread-safe helper. This function must never be
/// called from a Tokio worker thread; it performs fork().
fn spawn_pty_shell(
    slave_fd: OwnedFd,
    master_fd: OwnedFd,
    host_workspace: &str,
) -> Result<(Pid, OwnedFd), String> {
    let child_pid = unsafe {
        match fork().map_err(|e| format!("Failed to fork: {}", e))? {
            ForkResult::Child => {
                // In child: create new session, attach PTY slave, and exec proot bash.
                // Do not use tracing here; the child must not touch the parent's
                // tracing subscriber or runtime state.
                //
                // Close the master fd first: the child only needs the slave.
                let _ = close(master_fd.as_raw_fd());
                close_all_fds_except(slave_fd.as_raw_fd());
                if let Err(e) = setup_shell_child(slave_fd, host_workspace) {
                    eprintln!("Failed to setup shell child: {}", e);
                    libc::_exit(1);
                }
                libc::_exit(1);
            }
            ForkResult::Parent { child } => child,
        }
    };

    // Parent process: close slave fd (not needed here).
    let _ = close(slave_fd);

    // Put child in its own process group so signals go to the group.
    let _ = setpgid(child_pid, child_pid);

    Ok((child_pid, master_fd))
}

/// Close every file descriptor except the one we are about to use as stdio.
/// Collects the FD numbers first so we never close the /proc/self/fd
/// directory fd while we are still iterating it.
fn close_all_fds_except(keep_fd: RawFd) {
    let mut fds_to_close = Vec::new();
    if let Ok(dir) = std::fs::read_dir("/proc/self/fd") {
        for entry in dir.flatten() {
            if let Ok(name) = entry.file_name().into_string() {
                if let Ok(fd) = name.parse::<RawFd>() {
                    if fd != keep_fd && fd > 2 {
                        fds_to_close.push(fd);
                    }
                }
            }
        }
    }
    for fd in fds_to_close {
        let _ = close(fd);
    }
}

unsafe fn setup_shell_child(slave_fd: OwnedFd, host_workspace: &str) -> Result<(), String> {
    // Create new session and detach from controlling terminal.
    setsid().map_err(|e| format!("setsid failed: {}", e))?;

    // Make the PTY slave the controlling terminal for this session.
    if libc::ioctl(slave_fd.as_raw_fd(), libc::TIOCSCTTY, 0) != 0 {
        return Err(format!("TIOCSCTTY failed: {}", Errno::last()));
    }

    // Redirect stdin, stdout, stderr to the PTY slave.
    if libc::dup2(slave_fd.as_raw_fd(), libc::STDIN_FILENO) < 0 {
        return Err(format!("dup2 stdin failed: {}", Errno::last()));
    }
    if libc::dup2(slave_fd.as_raw_fd(), libc::STDOUT_FILENO) < 0 {
        return Err(format!("dup2 stdout failed: {}", Errno::last()));
    }
    if libc::dup2(slave_fd.as_raw_fd(), libc::STDERR_FILENO) < 0 {
        return Err(format!("dup2 stderr failed: {}", Errno::last()));
    }

    // Now that stdio is redirected, close any remaining fds including the
    // original slave fd and the /proc/self/fd directory itself.
    close_all_fds_except(-1);

    // Build argv for execv: proot -0 -R ROOTFS -b host:guest -w guest /bin/bash --login -i
    let proot_c = std::ffi::CString::new("proot").unwrap();
    let arg0 = std::ffi::CString::new("proot").unwrap();
    let zero_arg = std::ffi::CString::new("-0").unwrap();
    let r_arg = std::ffi::CString::new("-R").unwrap();
    let rootfs_val = std::ffi::CString::new(ROOTFS_PATH).unwrap();
    let b_arg = std::ffi::CString::new("-b").unwrap();
    let bind_val = std::ffi::CString::new(format!("{}:{}", host_workspace, WORKSPACE_GUEST_PATH)).unwrap();
    let w_arg = std::ffi::CString::new("-w").unwrap();
    let w_val = std::ffi::CString::new(WORKSPACE_GUEST_PATH).unwrap();
    let bash_c = std::ffi::CString::new("/bin/bash").unwrap();
    let bash_arg0 = std::ffi::CString::new("bash").unwrap();
    let login_arg = std::ffi::CString::new("--login").unwrap();
    let i_arg = std::ffi::CString::new("-i").unwrap();

    execv(
        &proot_c,
        &[
            &arg0,
            &zero_arg,
            &r_arg,
            &rootfs_val,
            &b_arg,
            &bind_val,
            &w_arg,
            &w_val,
            &bash_c,
            &bash_arg0,
            &login_arg,
            &i_arg,
        ],
    )
    .map_err(|e| format!("execv failed: {}", e))?;

    Ok(())
}

async fn run_pty_session(
    child_pid: Pid,
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
    if let Err(e) = prepare_master_fd(&master_fd) {
        let _ = output_tx.send(ShellOutput::Data(format!("\r\nPTY setup error: {}\r\n", e).into_bytes()));
        cleanup_session(&sessions, &user_id, &tab_id).await;
        return;
    }

    // Duplicate master fd for reader/writer/resize threads so each owns a descriptor.
    let reader_fd = dup_master(&master_fd);
    let writer_fd = dup_master(&master_fd);
    let resize_fd = dup_master(&master_fd);

    // Send shell setup: terminal type and prompt command that reports cwd via OSC.
    let setup = b"export TERM=xterm-256color\n\
        PROMPT_COMMAND='printf \"\\033]51;CWD;%s\\007\" \"$(pwd)\"'\n\
        PS1='$(pwd) \xe2\x86\x92 '\n";
    let _ = libc_write(master_raw, setup);

    // Channel from blocking reader thread to async code.
    let (reader_tx, mut reader_rx) = mpsc::unbounded_channel::<Vec<u8>>();

    // Spawn blocking reader thread for PTY master output.
    let reader_thread = std::thread::spawn(move || {
        let fd = match reader_fd {
            Some(fd) => fd,
            None => return,
        };
        let mut buf = [0u8; 4096];
        loop {
            let n = unsafe { libc::read(fd, buf.as_mut_ptr() as *mut libc::c_void, buf.len()) };
            if n <= 0 {
                if n < 0 {
                    let err = Errno::last();
                    if err == Errno::EAGAIN || err == Errno::EINTR {
                        std::thread::sleep(std::time::Duration::from_millis(1));
                        continue;
                    }
                }
                break;
            }
            if reader_tx.send(buf[..n as usize].to_vec()).is_err() {
                break;
            }
        }
        let _ = close(fd);
    });

    // Spawn blocking writer thread for PTY master input.
    let (writer_tx, mut writer_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let writer_thread = std::thread::spawn(move || {
        let fd = match writer_fd {
            Some(fd) => fd,
            None => return,
        };
        while let Some(data) = writer_rx.blocking_recv() {
            let mut written = 0usize;
            while written < data.len() {
                let n = unsafe { libc::write(fd, data[written..].as_ptr() as *const libc::c_void, data.len() - written) };
                if n < 0 {
                    let err = Errno::last();
                    if err == Errno::EAGAIN || err == Errno::EINTR {
                        std::thread::sleep(std::time::Duration::from_millis(1));
                        continue;
                    }
                    break;
                }
                if n == 0 {
                    break;
                }
                written += n as usize;
            }
        }
        let _ = close(fd);
    });

    // Bridge async input channel to blocking writer thread.
    let input_bridge = tokio::spawn(async move {
        while let Some(data) = input_rx.recv().await {
            if writer_tx.send(data).is_err() {
                break;
            }
        }
    });

    // Bridge async resize channel to blocking ioctl.
    let resize_bridge = tokio::spawn(async move {
        let fd = match resize_fd {
            Some(fd) => fd,
            None => return,
        };
        while let Some(ws) = resize_rx.recv().await {
            unsafe {
                let _ = set_winsize(fd, &ws);
            }
        }
        let _ = close(fd);
    });

    // Reaper task: wait for child exit.
    let output_tx_for_reaper = output_tx.clone();
    let mut reaper = tokio::spawn(async move {
        loop {
            match waitpid(child_pid, Some(WaitPidFlag::WNOHANG)) {
                Ok(WaitStatus::Exited(_, code)) => {
                    let _ = output_tx_for_reaper.send(ShellOutput::Status {
                        running: false,
                        code: Some(code),
                    });
                    break;
                }
                Ok(WaitStatus::Signaled(_, sig, _)) => {
                    let _ = output_tx_for_reaper.send(ShellOutput::Status {
                        running: false,
                        code: Some(128 + sig as i32),
                    });
                    break;
                }
                Ok(_) => {}
                Err(_) => break,
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
    });

    // Main async loop: consume reader output, strip OSC cwd sequences, forward rest.
    let mut leftover: Vec<u8> = Vec::new();
    loop {
        tokio::select! {
            biased;
            _ = &mut reaper => {
                break;
            }
            chunk = reader_rx.recv() => {
                match chunk {
                    Some(data) => {
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
                        if !output.is_empty() {
                            let _ = output_tx.send(ShellOutput::Data(output));
                        }
                    }
                    None => break,
                }
            }
        }
    }

    // Cleanup
    input_bridge.abort();
    resize_bridge.abort();
    let _ = reader_thread.join();
    let _ = writer_thread.join();
    let _ = kill(child_pid, Signal::SIGTERM);
    cleanup_session(&sessions, &user_id, &tab_id).await;
}

fn prepare_master_fd(fd: &OwnedFd) -> Result<(), String> {
    use nix::fcntl::FcntlArg;

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

fn dup_master(fd: &OwnedFd) -> Option<RawFd> {
    nix::unistd::dup(fd).ok().map(|owned| {
        let raw = owned.as_raw_fd();
        std::mem::forget(owned); // thread will close it manually
        raw
    })
}

fn libc_write(fd: RawFd, data: &[u8]) -> Result<(), String> {
    let mut written = 0usize;
    while written < data.len() {
        let n = unsafe { libc::write(fd, data[written..].as_ptr() as *const libc::c_void, data.len() - written) };
        if n < 0 {
            let err = Errno::last();
            if err == Errno::EAGAIN || err == Errno::EINTR {
                std::thread::sleep(std::time::Duration::from_millis(1));
                continue;
            }
            return Err(format!("PTY write failed: {}", err));
        }
        if n == 0 {
            return Err("PTY write returned 0".to_string());
        }
        written += n as usize;
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
