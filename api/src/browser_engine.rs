use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use headless_chrome::{Browser, LaunchOptions, protocol::cdp::Page};
use std::sync::Arc as StdArc;
use tokio::sync::{broadcast, mpsc, Mutex, oneshot, OwnedSemaphorePermit, Semaphore};

/// Starting offsets for resource allocation. Each session gets an index 0..99
/// which derives a unique display number, CDP port, VNC port, and WebSocket port.
const DISPLAY_BASE: u16 = 100;
const CDP_PORT_BASE: u16 = 9223;
const VNC_PORT_BASE: u16 = 5901;
const WS_PORT_BASE: u16 = 6101;
const MAX_SESSIONS: u16 = 100;

/// Maximum concurrent browser sessions per user.
const MAX_CONCURRENT_BROWSERS: usize = 3;

/// Idle timeout before the reaper kills a session.
const IDLE_TIMEOUT: Duration = Duration::from_secs(30 * 60);

#[derive(Clone)]
pub struct BrowserState {
    pub semaphore: Arc<Semaphore>,
    pub sessions: Arc<Mutex<HashMap<(String, String), BrowserSessionHandle>>>,
    port_counter: Arc<AtomicU16>,
}

impl BrowserState {
    pub fn new() -> Self {
        Self {
            semaphore: Arc::new(Semaphore::new(MAX_CONCURRENT_BROWSERS)),
            sessions: Arc::new(Mutex::new(HashMap::new())),
            port_counter: Arc::new(AtomicU16::new(0)),
        }
    }

    fn allocate_resources(&self) -> (u16, u16, u16, u16) {
        let idx = self.port_counter.fetch_add(1, Ordering::SeqCst) % MAX_SESSIONS;
        (
            DISPLAY_BASE + idx,
            CDP_PORT_BASE + idx,
            VNC_PORT_BASE + idx,
            WS_PORT_BASE + idx,
        )
    }
}

impl Default for BrowserState {
    fn default() -> Self {
        Self::new()
    }
}

/// Handle to a live browser session. Cloneable so both the sessions map
/// and WebSocket handlers can hold references.
#[derive(Clone)]
pub struct BrowserSessionHandle {
    pub user_id: String,
    pub session_id: String,
    /// Chat currently borrowing this session. Empty string = standalone.
    /// Mutable so the AI can borrow/release without recreating the handle.
    pub chat_id: Arc<std::sync::Mutex<String>>,
    pub display: u16,
    pub cdp_port: u16,
    pub vnc_port: u16,
    pub ws_port: u16,
    pub command_tx: mpsc::Sender<BrowserCommand>,
    pub viewer_tx: broadcast::Sender<BrowserViewerEvent>,
    pub ai_active: Arc<AtomicBool>,
    pub current_url: Arc<std::sync::Mutex<String>>,
    pub title: Arc<std::sync::Mutex<String>>,
    pub last_activity: Arc<Mutex<Instant>>,
    pub shutdown: Arc<AtomicBool>,
    /// PIDs of external processes (Xvfb, x11vnc, websockify) for cleanup.
    pub child_pids: Arc<Mutex<Vec<i32>>>,
    pub permit: Arc<Mutex<Option<OwnedSemaphorePermit>>>,
}

impl BrowserSessionHandle {
    /// Touch the session to prevent idle reaper from killing it.
    pub fn touch(&self) {
        if let Ok(mut t) = self.last_activity.try_lock() {
            *t = Instant::now();
        }
    }

    /// Request shutdown of the browser session.
    pub fn shutdown_session(&self) {
        self.shutdown.store(true, Ordering::SeqCst);
        // Send a Close command to cleanly drop the Browser in the blocking task.
        let _ = self.command_tx.try_send(BrowserCommand::Close);
        // Release the semaphore permit.
        if let Ok(mut permit) = self.permit.try_lock() {
            *permit = None;
        }
    }

    /// Broadcast a viewer event to all connected WebSocket clients.
    pub fn broadcast(&self, event: BrowserViewerEvent) {
        let _ = self.viewer_tx.send(event);
    }

    /// Read the current chat_id (empty string for standalone sessions).
    pub fn get_chat_id(&self) -> String {
        self.chat_id
            .lock()
            .map(|s| s.clone())
            .unwrap_or_default()
    }

    /// Borrow/release this session by a chat. Broadcasts `ChatAssociated`
    /// so the frontend panel updates its badge live. Empty `chat_id` releases.
    pub fn set_chat_id(&self, chat_id: &str) {
        if let Ok(mut c) = self.chat_id.lock() {
            *c = chat_id.to_string();
        }
        let _ = self.viewer_tx.send(BrowserViewerEvent::ChatAssociated {
            chat_id: chat_id.to_string(),
        });
    }
}

/// Commands sent from async tool dispatch to the blocking browser task.
#[derive(Debug)]
pub enum BrowserCommand {
    Navigate {
        url: String,
        reply: oneshot::Sender<BrowserCommandResult>,
    },
    Click {
        selector: String,
        reply: oneshot::Sender<BrowserCommandResult>,
    },
    Type {
        selector: String,
        text: String,
        clear: bool,
        reply: oneshot::Sender<BrowserCommandResult>,
    },
    Extract {
        selector: Option<String>,
        mode: String,
        reply: oneshot::Sender<BrowserCommandResult>,
    },
    Screenshot {
        reply: oneshot::Sender<BrowserCommandResult>,
    },
    Scroll {
        x: i32,
        y: i32,
        reply: oneshot::Sender<BrowserCommandResult>,
    },
    Wait {
        ms: u64,
        reply: oneshot::Sender<BrowserCommandResult>,
    },
    RunJs {
        script: String,
        reply: oneshot::Sender<BrowserCommandResult>,
    },
    GetUrl {
        reply: oneshot::Sender<BrowserCommandResult>,
    },
    Close,
}

/// Results returned from the blocking browser task.
#[derive(Debug)]
pub enum BrowserCommandResult {
    Navigate { url: String, title: String },
    Click { selector: String },
    Type { selector: String, text: String },
    Extract { content: String },
    Screenshot { jpeg: Vec<u8>, url: String, title: String },
    Scroll { x: i32, y: i32 },
    Wait,
    RunJs { result: String },
    GetUrl { url: String },
    Error(String),
}

/// Events broadcast to WebSocket viewers (the frontend browser panel).
#[derive(Clone, Debug, serde::Serialize)]
#[serde(tag = "type")]
pub enum BrowserViewerEvent {
    AiActive {
        active: bool,
        action: String,
    },
    UrlChanged {
        url: String,
    },
    TitleChanged {
        title: String,
    },
    SessionReady {
        ws_port: u16,
    },
    /// Emitted when the AI borrows (chat_id set) or releases (chat_id cleared)
    /// a session. `chat_id` is empty for standalone sessions.
    ChatAssociated {
        chat_id: String,
    },
    SessionClosed,
}

/// Spawn a new browser session or return an error.
///
/// This launches Xvfb, Chrome (headful via headless_chrome), x11vnc, and
/// websockify. The Chrome process is managed by the headless_chrome crate
/// inside a blocking task; the other processes are managed via stored PIDs.
///
/// `chat_id` is optional: `None` (or empty string) creates a standalone
/// session. If a session with the same `(user_id, session_id)` already
/// exists, it is returned as-is (its chat_id is NOT changed here).
pub async fn get_or_create_session(
    state: BrowserState,
    user_id: String,
    session_id: String,
    chat_id: Option<String>,
) -> Result<BrowserSessionHandle, String> {
    let key = (user_id.clone(), session_id.clone());

    // Return existing session if one is already open.
    {
        let sessions = state.sessions.lock().await;
        if let Some(existing) = sessions.get(&key) {
            existing.touch();
            return Ok(existing.clone());
        }
    }

    create_session(state, user_id, session_id, chat_id.unwrap_or_default(), false).await
}

/// Like `get_or_create_session` but never blocks on the semaphore: returns
/// `Err("max_sessions_reached")` immediately when no permit is available.
/// Used by the AI tool path so it can fall back to borrowing an existing
/// standalone session instead of hanging.
pub async fn try_create_session(
    state: BrowserState,
    user_id: String,
    session_id: String,
    chat_id: Option<String>,
) -> Result<BrowserSessionHandle, String> {
    let key = (user_id.clone(), session_id.clone());

    {
        let sessions = state.sessions.lock().await;
        if let Some(existing) = sessions.get(&key) {
            existing.touch();
            return Ok(existing.clone());
        }
    }

    create_session(state, user_id, session_id, chat_id.unwrap_or_default(), true).await
}

/// Shared creation path. `nonblocking` selects between blocking and
/// `try_acquire_owned` semaphore acquisition.
async fn create_session(
    state: BrowserState,
    user_id: String,
    session_id: String,
    chat_id: String,
    nonblocking: bool,
) -> Result<BrowserSessionHandle, String> {
    let key = (user_id.clone(), session_id.clone());

    // Acquire semaphore permit (max 3 concurrent browsers).
    let permit = if nonblocking {
        state
            .semaphore
            .clone()
            .try_acquire_owned()
            .map_err(|_| "max_sessions_reached".to_string())?
    } else {
        state
            .semaphore
            .clone()
            .acquire_owned()
            .await
            .map_err(|e| format!("Semaphore error: {}", e))?
    };

    let (display, cdp_port, vnc_port, ws_port) = state.allocate_resources();
    let display_str = format!(":{}", display);

    // 1. Spawn Xvfb
    let xvfb_pid = spawn_xvfb(display)?;
    // Give Xvfb a moment to start.
    tokio::time::sleep(Duration::from_millis(300)).await;
    // Verify Xvfb is still running.
    if !is_process_alive(xvfb_pid) {
        return Err("Xvfb failed to start".to_string());
    }

    // 2. Launch Chrome via headless_chrome (in spawn_blocking since it's sync).
    let display_env = display_str.clone();
    let chrome_result = tokio::task::spawn_blocking(move || {
        let mut env = std::collections::HashMap::new();
        env.insert("DISPLAY".to_string(), display_env);

        let browser = Browser::new(LaunchOptions {
            headless: false,
            sandbox: false,
            window_size: Some((1280, 800)),
            port: Some(cdp_port),
            process_envs: Some(env),
            idle_browser_timeout: Duration::from_secs(300),
            ignore_certificate_errors: true,
            enable_logging: true,
            args: vec![std::ffi::OsStr::new("--enable-logging=stderr")],
            ..Default::default()
        })
        .map_err(|e| format!("Failed to launch Chrome: {}", e))?;

        let tab = browser
            .new_tab()
            .map_err(|e| format!("Failed to open tab: {}", e))?;

        Ok::<(Browser, StdArc<headless_chrome::Tab>), String>((browser, tab))
    })
    .await
    .map_err(|e| format!("Chrome launch task failed: {}", e))?;

    let (browser, tab) = match chrome_result {
        Ok(bt) => bt,
        Err(e) => {
            kill_process(xvfb_pid);
            return Err(e);
        }
    };

    // 3. Spawn x11vnc
    let x11vnc_pid = spawn_x11vnc(display)?;
    tokio::time::sleep(Duration::from_millis(200)).await;
    if !is_process_alive(x11vnc_pid) {
        kill_process(xvfb_pid);
        // Drop browser to kill Chrome.
        drop(browser);
        drop(tab);
        return Err("x11vnc failed to start".to_string());
    }

    // 4. Spawn websockify
    let websockify_pid = spawn_websockify(ws_port, vnc_port)?;
    tokio::time::sleep(Duration::from_millis(200)).await;
    if !is_process_alive(websockify_pid) {
        kill_process(xvfb_pid);
        kill_process(x11vnc_pid);
        drop(browser);
        drop(tab);
        return Err("websockify failed to start".to_string());
    }

    // 5. Create channels.
    let (command_tx, command_rx) = mpsc::channel::<BrowserCommand>(64);
    let (viewer_tx, _) = broadcast::channel::<BrowserViewerEvent>(32);
    let ai_active = Arc::new(AtomicBool::new(false));
    let current_url = Arc::new(std::sync::Mutex::new(String::new()));
    let title = Arc::new(std::sync::Mutex::new(String::new()));
    let last_activity = Arc::new(Mutex::new(Instant::now()));
    let shutdown = Arc::new(AtomicBool::new(false));
    let child_pids = Arc::new(Mutex::new(vec![xvfb_pid, x11vnc_pid, websockify_pid]));
    let permit_arc = Arc::new(Mutex::new(Some(permit)));

    let handle = BrowserSessionHandle {
        user_id: user_id.clone(),
        session_id: session_id.clone(),
        chat_id: Arc::new(std::sync::Mutex::new(chat_id.clone())),
        display,
        cdp_port,
        vnc_port,
        ws_port,
        command_tx: command_tx.clone(),
        viewer_tx: viewer_tx.clone(),
        ai_active: ai_active.clone(),
        current_url: current_url.clone(),
        title: title.clone(),
        last_activity: last_activity.clone(),
        shutdown: shutdown.clone(),
        child_pids: child_pids.clone(),
        permit: permit_arc.clone(),
    };

    // Notify viewers that the session is ready.
    let _ = viewer_tx.send(BrowserViewerEvent::SessionReady { ws_port });

    // 6. Spawn the blocking command loop that owns the Browser + Tab.
    let sessions_for_task = state.sessions.clone();
    let sessions_key = key.clone();
    let viewer_tx_task = viewer_tx.clone();
    let ai_active_task = ai_active.clone();
    let shutdown_task = shutdown.clone();
    let child_pids_task = child_pids.clone();

    tokio::task::spawn_blocking(move || {
        run_browser_command_loop(
            browser,
            tab,
            command_rx,
            viewer_tx_task,
            ai_active_task,
            current_url,
            title,
            shutdown_task,
            child_pids_task,
            sessions_for_task,
            sessions_key,
        );
    });

    // 7. Store the session in the map.
    {
        let mut sessions = state.sessions.lock().await;
        sessions.insert(key, handle.clone());
    }

    // Spawn the idle reaper (once, shared across all sessions).
    // Using try_lock to avoid spawning multiple reapers.
    static REAPER_STARTED: AtomicBool = AtomicBool::new(false);
    if !REAPER_STARTED.swap(true, Ordering::SeqCst) {
        tokio::spawn(idle_session_reaper(state.sessions.clone()));
    }

    Ok(handle)
}

/// The blocking command loop that owns the Browser and Tab.
///
/// Receives commands from the async side, executes them synchronously via
/// headless_chrome, and sends results back via oneshot channels.
fn run_browser_command_loop(
    browser: Browser,
    tab: StdArc<headless_chrome::Tab>,
    mut command_rx: mpsc::Receiver<BrowserCommand>,
    viewer_tx: broadcast::Sender<BrowserViewerEvent>,
    ai_active: Arc<AtomicBool>,
    current_url: Arc<std::sync::Mutex<String>>,
    title: Arc<std::sync::Mutex<String>>,
    shutdown: Arc<AtomicBool>,
    child_pids: Arc<Mutex<Vec<i32>>>,
    sessions: Arc<Mutex<HashMap<(String, String), BrowserSessionHandle>>>,
    session_key: (String, String),
) {
    // The Browser and Tab are kept alive for the lifetime of this function.
    // When we exit, they are dropped, which kills Chrome.
    let _browser = browser;
    let tab = tab;

    loop {
        if shutdown.load(Ordering::Relaxed) {
            break;
        }

        let cmd = match command_rx.blocking_recv() {
            Some(c) => c,
            None => break, // Channel closed — sender dropped.
        };

        match cmd {
            BrowserCommand::Close => break,

            BrowserCommand::Navigate { url, reply } => {
                set_ai_active(&ai_active, &viewer_tx, true, &format!("navigating to {}", url));

                let result = tab
                    .navigate_to(&url)
                    .and_then(|_| tab.wait_until_navigated().map(|_| ()))
                    .map(|_| {
                        let current = tab.get_url();
                        let page_title = tab.get_title().unwrap_or_default();
                        {
                            if let Ok(mut u) = current_url.lock() {
                                *u = current.clone();
                            }
                            if let Ok(mut ti) = title.lock() {
                                *ti = page_title.clone();
                            }
                        }
                        let _ = viewer_tx.send(BrowserViewerEvent::UrlChanged {
                            url: current.clone(),
                        });
                        let _ = viewer_tx.send(BrowserViewerEvent::TitleChanged {
                            title: page_title.clone(),
                        });
                        BrowserCommandResult::Navigate {
                            url: current,
                            title: page_title,
                        }
                    })
                    .unwrap_or_else(|e| BrowserCommandResult::Error(e.to_string()));

                let _ = reply.send(result);
                set_ai_active(&ai_active, &viewer_tx, false, "");
            }

            BrowserCommand::Click { selector, reply } => {
                set_ai_active(&ai_active, &viewer_tx, true, &format!("clicking {}", selector));

                let result = tab
                    .wait_for_element(&selector)
                    .and_then(|element| element.click().map(|_| ()))
                    .map(|_| BrowserCommandResult::Click {
                        selector: selector.clone(),
                    })
                    .unwrap_or_else(|e| BrowserCommandResult::Error(e.to_string()));

                let _ = reply.send(result);
                set_ai_active(&ai_active, &viewer_tx, false, "");
            }

            BrowserCommand::Type {
                selector,
                text,
                clear,
                reply,
            } => {
                set_ai_active(&ai_active, &viewer_tx, true, &format!("typing into {}", selector));

                let result = (|| -> Result<BrowserCommandResult, String> {
                    let element = tab
                        .wait_for_element(&selector)
                        .map_err(|e| e.to_string())?;
                    element.focus().map_err(|e| e.to_string())?;
                    if clear {
                        element
                            .call_js_fn(
                                "() => { this.value = ''; this.dispatchEvent(new Event('input', {bubbles: true})); }",
                                vec![],
                                false,
                            )
                            .map_err(|e| e.to_string())?;
                    }
                    element.type_into(&text).map_err(|e| e.to_string())?;
                    Ok(BrowserCommandResult::Type {
                        selector: selector.clone(),
                        text: text.clone(),
                    })
                })()
                .unwrap_or_else(|e| BrowserCommandResult::Error(e));

                let _ = reply.send(result);
                set_ai_active(&ai_active, &viewer_tx, false, "");
            }

            BrowserCommand::Extract {
                selector,
                mode,
                reply,
            } => {
                let action = match &selector {
                    Some(s) => format!("extracting {} from {}", mode, s),
                    None => format!("extracting {} from page", mode),
                };
                set_ai_active(&ai_active, &viewer_tx, true, &action);

                let result = (|| -> Result<BrowserCommandResult, String> {
                    match mode.as_str() {
                        "html" => {
                            if let Some(sel) = &selector {
                                let element = tab.wait_for_element(sel).map_err(|e| e.to_string())?;
                                let html = element.get_content().map_err(|e| e.to_string())?;
                                Ok(BrowserCommandResult::Extract { content: html })
                            } else {
                                let html = tab.get_content().map_err(|e| e.to_string())?;
                                Ok(BrowserCommandResult::Extract { content: html })
                            }
                        }
                        "attribute" => {
                            // For attribute mode, selector must be "element[attr]"
                            let sel = selector.as_ref().ok_or("selector required for attribute mode")?;
                            // Try to parse "selector[attr_name]" format
                            if let Some(bracket_pos) = sel.rfind('[') {
                                let css_sel = &sel[..bracket_pos];
                                let attr_name = &sel[bracket_pos + 1..sel.len().saturating_sub(1)];
                                let element = tab.wait_for_element(css_sel).map_err(|e| e.to_string())?;
                                let attr = element
                                    .get_attribute_value(attr_name)
                                    .map_err(|e| e.to_string())?;
                                Ok(BrowserCommandResult::Extract {
                                    content: attr.unwrap_or_default(),
                                })
                            } else {
                                Err("Invalid selector format for attribute mode. Use: selector[attribute_name]".to_string())
                            }
                        }
                        _ => {
                            // "text" mode (default)
                            if let Some(sel) = &selector {
                                let element = tab.wait_for_element(sel).map_err(|e| e.to_string())?;
                                let text = element.get_inner_text().map_err(|e| e.to_string())?;
                                Ok(BrowserCommandResult::Extract { content: text })
                            } else {
                                // Extract all text from body
                                let element = tab.wait_for_element("body").map_err(|e| e.to_string())?;
                                let text = element.get_inner_text().map_err(|e| e.to_string())?;
                                Ok(BrowserCommandResult::Extract { content: text })
                            }
                        }
                    }
                })()
                .unwrap_or_else(|e| BrowserCommandResult::Error(e));

                let _ = reply.send(result);
                set_ai_active(&ai_active, &viewer_tx, false, "");
            }

            BrowserCommand::Screenshot { reply } => {
                set_ai_active(&ai_active, &viewer_tx, true, "taking screenshot");

                let result = tab
                    .capture_screenshot(
                        Page::CaptureScreenshotFormatOption::Jpeg,
                        Some(80),
                        None,
                        true,
                    )
                    .map(|jpeg| {
                        let url = tab.get_url();
                        let title = tab.get_title().unwrap_or_default();
                        BrowserCommandResult::Screenshot { jpeg, url, title }
                    })
                    .unwrap_or_else(|e| BrowserCommandResult::Error(e.to_string()));

                let _ = reply.send(result);
                set_ai_active(&ai_active, &viewer_tx, false, "");
            }

            BrowserCommand::Scroll { x, y, reply } => {
                set_ai_active(&ai_active, &viewer_tx, true, "scrolling");

                let js = format!("window.scrollTo({}, {});", x, y);
                let result = tab
                    .evaluate(&js, false)
                    .map(|_| BrowserCommandResult::Scroll { x, y })
                    .unwrap_or_else(|e| BrowserCommandResult::Error(e.to_string()));

                let _ = reply.send(result);
                set_ai_active(&ai_active, &viewer_tx, false, "");
            }

            BrowserCommand::Wait { ms, reply } => {
                set_ai_active(&ai_active, &viewer_tx, true, &format!("waiting {}ms", ms));
                std::thread::sleep(Duration::from_millis(ms));
                let _ = reply.send(BrowserCommandResult::Wait);
                set_ai_active(&ai_active, &viewer_tx, false, "");
            }

            BrowserCommand::RunJs { script, reply } => {
                set_ai_active(&ai_active, &viewer_tx, true, "running JavaScript");

                let result = tab
                    .evaluate(&script, true)
                    .map(|remote_object| {
                        let result_str = remote_object
                            .value
                            .map(|v| v.to_string())
                            .unwrap_or_else(|| {
                                remote_object
                                    .description
                                    .unwrap_or_else(|| "undefined".to_string())
                            });
                        BrowserCommandResult::RunJs { result: result_str }
                    })
                    .unwrap_or_else(|e| BrowserCommandResult::Error(e.to_string()));

                let _ = reply.send(result);
                set_ai_active(&ai_active, &viewer_tx, false, "");
            }

            BrowserCommand::GetUrl { reply } => {
                let url = tab.get_url();
                let _ = reply.send(BrowserCommandResult::GetUrl { url });
            }
        }
    }

    // Cleanup: kill external processes.
    let _ = viewer_tx.send(BrowserViewerEvent::SessionClosed);
    {
        let pids = child_pids.blocking_lock();
        for pid in pids.iter() {
            kill_process(*pid);
        }
    }

    // Remove from sessions map (blocking_lock since we're in spawn_blocking).
    {
        let mut sessions = sessions.blocking_lock();
        sessions.remove(&session_key);
    }

    tracing::info!(
        "Browser session closed for key ({}, {})",
        session_key.0,
        session_key.1
    );
}

fn set_ai_active(
    ai_active: &Arc<AtomicBool>,
    viewer_tx: &broadcast::Sender<BrowserViewerEvent>,
    active: bool,
    action: &str,
) {
    ai_active.store(active, Ordering::SeqCst);
    let _ = viewer_tx.send(BrowserViewerEvent::AiActive {
        active,
        action: action.to_string(),
    });
}

/// Spawn an Xvfb process for the given display number.
fn spawn_xvfb(display: u16) -> Result<i32, String> {
    let display_arg = format!(":{}", display);
    let child = std::process::Command::new("Xvfb")
        .args([
            &display_arg,
            "-screen",
            "0",
            "1280x800x24",
            "-ac",
            "-nolisten",
            "tcp",
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to spawn Xvfb: {}", e))?;

    Ok(child.id() as i32)
}

/// Spawn x11vnc to expose the Xvfb display via VNC.
fn spawn_x11vnc(display: u16) -> Result<i32, String> {
    let display_arg = format!(":{}", display);
    let child = std::process::Command::new("x11vnc")
        .args([
            "-display",
            &display_arg,
            "-nopw",
            "-forever",
            "-shared",
            "-rfbport",
            &(VNC_PORT_BASE + (display - DISPLAY_BASE)).to_string(),
            "-localhost",
            "-bg",
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to spawn x11vnc: {}", e))?;

    Ok(child.id() as i32)
}

/// Spawn websockify to proxy VNC over WebSocket for noVNC.
fn spawn_websockify(ws_port: u16, vnc_port: u16) -> Result<i32, String> {
    let vnc_target = format!("localhost:{}", vnc_port);
    let ws_port_str = ws_port.to_string();
    let child = std::process::Command::new("websockify")
        .args([
            "--web",
            "/usr/share/novnc",
            &ws_port_str,
            &vnc_target,
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to spawn websockify: {}", e))?;

    Ok(child.id() as i32)
}

/// Check if a process is still running.
fn is_process_alive(pid: i32) -> bool {
    // kill with signal 0 just checks if the process exists.
    nix::sys::signal::kill(nix::unistd::Pid::from_raw(pid), None).is_ok()
}

/// Kill a process by PID with SIGTERM, then SIGKILL after a short delay.
fn kill_process(pid: i32) {
    let _ = nix::sys::signal::kill(nix::unistd::Pid::from_raw(pid), nix::sys::signal::Signal::SIGTERM);
    std::thread::sleep(Duration::from_millis(50));
    let _ = nix::sys::signal::kill(nix::unistd::Pid::from_raw(pid), nix::sys::signal::Signal::SIGKILL);
}

/// Idle reaper: kills browser sessions with no activity for 30 minutes.
async fn idle_session_reaper(
    sessions: Arc<Mutex<HashMap<(String, String), BrowserSessionHandle>>>,
) {
    loop {
        tokio::time::sleep(Duration::from_secs(60)).await;
        let to_shutdown: Vec<BrowserSessionHandle> = {
            let sessions = sessions.lock().await;
            sessions
                .values()
                .filter(|h| {
                    h.last_activity
                        .try_lock()
                        .map(|t| t.elapsed() >= IDLE_TIMEOUT)
                        .unwrap_or(false)
                })
                .cloned()
                .collect()
        };
        for h in to_shutdown {
            tracing::info!(
                "Idle browser session reaper shutting down session {} for user {}",
                h.session_id,
                h.user_id
            );
            h.shutdown_session();
        }
    }
}