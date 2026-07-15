use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use headless_chrome::{Browser, LaunchOptions, protocol::cdp::Page, util};
use std::sync::Arc as StdArc;
use tokio::sync::{broadcast, mpsc, Mutex, oneshot, OwnedSemaphorePermit, Semaphore};

/// Fixed resource allocation for the single shared Chrome + Xvfb + x11vnc.
const SHARED_DISPLAY: u16 = 100;
const SHARED_CDP_PORT: u16 = 9223;
const SHARED_VNC_PORT: u16 = 5901;

/// Maximum concurrent browser sessions (tabs) per user.
const MAX_CONCURRENT_BROWSERS: usize = 3;

/// Idle timeout before the reaper kills a session.
const IDLE_TIMEOUT: Duration = Duration::from_secs(30 * 60);

#[derive(Clone)]
pub struct BrowserState {
    pub semaphore: Arc<Semaphore>,
    pub sessions: Arc<Mutex<HashMap<(String, String), BrowserSessionHandle>>>,
    pub shared: Arc<Mutex<Option<SharedBrowser>>>,
}

impl BrowserState {
    pub fn new() -> Self {
        Self {
            semaphore: Arc::new(Semaphore::new(MAX_CONCURRENT_BROWSERS)),
            sessions: Arc::new(Mutex::new(HashMap::new())),
            shared: Arc::new(Mutex::new(None)),
        }
    }
}

impl Default for BrowserState {
    fn default() -> Self {
        Self::new()
    }
}

/// The single shared Chrome + Xvfb + x11vnc process group.
/// Lazily initialized on first session, torn down when the last session closes.
pub struct SharedBrowser {
    pub browser: StdArc<Browser>,
    pub xvfb_pid: i32,
    pub x11vnc_pid: i32,
    pub vnc_port: u16,
    pub session_count: AtomicU16,
    /// Chrome's initial tab (opened at launch with about:blank). The first
    /// session reuses this tab instead of creating a new one. `None` after
    /// it has been claimed or if it failed to load.
    pub initial_tab: Option<StdArc<headless_chrome::Tab>>,
}

impl SharedBrowser {
    /// Get the VNC port (always SHARED_VNC_PORT).
    pub fn vnc_port(&self) -> u16 {
        self.vnc_port
    }
}

/// Handle to a live browser session. Cloneable so both the sessions map
/// and WebSocket handlers can hold references.
#[derive(Clone)]
pub struct BrowserSessionHandle {
    pub user_id: String,
    pub session_id: String,
    /// Chat currently borrowing this session. Empty string = standalone.
    pub chat_id: Arc<std::sync::Mutex<String>>,
    pub vnc_port: u16,
    pub command_tx: mpsc::Sender<BrowserCommand>,
    pub viewer_tx: broadcast::Sender<BrowserViewerEvent>,
    pub ai_active: Arc<AtomicBool>,
    pub current_url: Arc<std::sync::Mutex<String>>,
    pub title: Arc<std::sync::Mutex<String>>,
    pub last_activity: Arc<Mutex<Instant>>,
    pub shutdown: Arc<AtomicBool>,
    pub permit: Arc<Mutex<Option<OwnedSemaphorePermit>>>,
    /// Whether this session's tab is currently the active (visible) tab on VNC.
    pub is_active: Arc<AtomicBool>,
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
        let _ = self.command_tx.try_send(BrowserCommand::Close);
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
    /// Bring this session's tab to the foreground on the VNC display.
    Activate,
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
    SessionReady,
    /// Emitted when the AI borrows (chat_id set) or releases (chat_id cleared)
    /// a session. `chat_id` is empty for standalone sessions.
    ChatAssociated {
        chat_id: String,
    },
    SessionClosed,
}

/// Spawn a new browser session or return an error.
///
/// This creates a new tab on the shared Chrome instance. The shared Chrome +
/// Xvfb + x11vnc are lazily initialized on first use.
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

    // Acquire semaphore permit (max 3 concurrent tabs).
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

    // Ensure the shared Chrome + Xvfb + x11vnc are running, and try to
    // claim the initial tab (Chrome's about:blank tab) for reuse.
    let (browser, initial_tab) = ensure_shared_browser(&state).await?;

    // Use the initial tab if available, else create a new one.
    let tab = if let Some(tab) = initial_tab {
        tab
    } else {
        let browser = browser.clone();
        tokio::task::spawn_blocking(move || {
            browser
                .new_tab()
                .map_err(|e| format!("Failed to create tab: {}", e))
        })
        .await
        .map_err(|e| format!("Tab creation task failed: {}", e))??
    };

    // Increment session count so teardown works when the last session closes.
    {
        let shared = state.shared.lock().await;
        if let Some(ref sb) = *shared {
            sb.session_count.fetch_add(1, Ordering::SeqCst);
        }
    }

    let _tab_target_id = tab.get_target_id().to_string();

    // Create channels.
    let (command_tx, command_rx) = mpsc::channel::<BrowserCommand>(64);
    let (viewer_tx, _) = broadcast::channel::<BrowserViewerEvent>(32);
    let ai_active = Arc::new(AtomicBool::new(false));
    let current_url = Arc::new(std::sync::Mutex::new(String::new()));
    let title = Arc::new(std::sync::Mutex::new(String::new()));
    let last_activity = Arc::new(Mutex::new(Instant::now()));
    let shutdown = Arc::new(AtomicBool::new(false));
    let permit_arc = Arc::new(Mutex::new(Some(permit)));
    let is_active = Arc::new(AtomicBool::new(false));

    let handle = BrowserSessionHandle {
        user_id: user_id.clone(),
        session_id: session_id.clone(),
        chat_id: Arc::new(std::sync::Mutex::new(chat_id.clone())),
        vnc_port: SHARED_VNC_PORT,
        command_tx: command_tx.clone(),
        viewer_tx: viewer_tx.clone(),
        ai_active: ai_active.clone(),
        current_url: current_url.clone(),
        title: title.clone(),
        last_activity: last_activity.clone(),
        shutdown: shutdown.clone(),
        permit: permit_arc.clone(),
        is_active: is_active.clone(),
    };

    // Notify viewers that the session is ready.
    let _ = viewer_tx.send(BrowserViewerEvent::SessionReady);

    // Spawn the blocking command loop that owns the Tab.
    let sessions_for_task = state.sessions.clone();
    let sessions_key = key.clone();
    let viewer_tx_task = viewer_tx.clone();
    let ai_active_task = ai_active.clone();
    let shutdown_task = shutdown.clone();
    let shared_state = state.shared.clone();
    let is_active_task = is_active.clone();

    tokio::task::spawn_blocking(move || {
        run_browser_command_loop(
            tab,
            command_rx,
            viewer_tx_task,
            ai_active_task,
            current_url,
            title,
            shutdown_task,
            sessions_for_task,
            sessions_key,
            shared_state,
            is_active_task,
        );
    });

    // Store the session in the map.
    {
        let mut sessions = state.sessions.lock().await;
        sessions.insert(key, handle.clone());
    }

    // Spawn the idle reaper and tab watcher (once, shared across all sessions).
    static REAPER_STARTED: AtomicBool = AtomicBool::new(false);
    if !REAPER_STARTED.swap(true, Ordering::SeqCst) {
        tokio::spawn(idle_session_reaper(state.sessions.clone()));
        tokio::spawn(tab_watcher(state.sessions.clone(), state.shared.clone()));
    }

    Ok(handle)
}

/// Lazily initialize the shared Chrome + Xvfb + x11vnc, or return the existing one.
/// Returns the browser handle and, if available, the initial tab for reuse.
async fn ensure_shared_browser(
    state: &BrowserState,
) -> Result<(StdArc<Browser>, Option<StdArc<headless_chrome::Tab>>), String> {
    // Fast path: already running.
    {
        let mut shared = state.shared.lock().await;
        if let Some(ref mut sb) = *shared {
            // Verify Chrome is still alive by checking the process.
            let pid = sb.browser.get_process_id();
            if let Some(pid) = pid {
                if is_process_alive(pid as i32) {
                    // Take the initial tab if still available.
                    let initial_tab = sb.initial_tab.take();
                    return Ok((sb.browser.clone(), initial_tab));
                }
            }
            // Chrome is dead — fall through to reinit.
        }
    }

    // Slow path: initialize.
    init_shared_browser(state).await
}

/// Initialize the shared Chrome + Xvfb + x11vnc.
/// Returns the browser handle and the initial tab for reuse.
async fn init_shared_browser(
    state: &BrowserState,
) -> Result<(StdArc<Browser>, Option<StdArc<headless_chrome::Tab>>), String> {
    let display_str = format!(":{}", SHARED_DISPLAY);

    // 1. Spawn Xvfb
    let xvfb_pid = spawn_xvfb(SHARED_DISPLAY)?;
    tokio::time::sleep(Duration::from_millis(300)).await;
    if !is_process_alive(xvfb_pid) {
        return Err("Xvfb failed to start".to_string());
    }

    // 2. Launch Chrome via headless_chrome (in spawn_blocking since it's sync).
    let display_env = display_str.clone();
    let cdp_port = SHARED_CDP_PORT;
    let browser = tokio::task::spawn_blocking(move || {
        let mut env = std::collections::HashMap::new();
        env.insert("DISPLAY".to_string(), display_env);

        Browser::new(LaunchOptions {
            headless: false,
            sandbox: false,
            window_size: Some((1280, 800)),
            port: Some(cdp_port),
            process_envs: Some(env),
            idle_browser_timeout: Duration::from_secs(1800),
            ignore_certificate_errors: true,
            // Open about:blank as the initial tab so Chrome doesn't load
            // its default start page (Google). The first session reuses
            // this tab instead of creating a new one.
            args: vec![std::ffi::OsStr::new("about:blank")],
            ..Default::default()
        })
        .map_err(|e| format!("Failed to launch Chrome: {}", e))
    })
    .await
    .map_err(|e| format!("Chrome launch task failed: {}", e))??;

    let browser = StdArc::new(browser);

    // Grab Chrome's initial tab (opened with about:blank) so the first
    // session can reuse it instead of creating a second tab.
    let initial_tab = tokio::task::spawn_blocking({
        let browser = browser.clone();
        move || {
            let tabs = browser.get_tabs();
            // Wait briefly for the initial tab to appear.
            util::Wait::with_timeout(Duration::from_secs(5))
                .until(|| tabs.lock().unwrap().first().cloned())
                .ok()
        }
    })
    .await
    .unwrap_or(None);

    // 3. Spawn x11vnc
    let x11vnc_pid = spawn_x11vnc(SHARED_DISPLAY, SHARED_VNC_PORT)?;
    tokio::time::sleep(Duration::from_millis(200)).await;
    if !is_process_alive(x11vnc_pid) {
        kill_process(xvfb_pid);
        return Err("x11vnc failed to start".to_string());
    }

    // Store in the shared slot, then take the initial tab back for the
    // first session to claim.
    let initial_tab_return;
    {
        let mut shared = state.shared.lock().await;
        *shared = Some(SharedBrowser {
            browser: browser.clone(),
            xvfb_pid,
            x11vnc_pid,
            vnc_port: SHARED_VNC_PORT,
            session_count: AtomicU16::new(0),
            initial_tab,
        });
        initial_tab_return = shared.as_mut().unwrap().initial_tab.take();
    }

    // Return the browser and the initial tab (to be claimed by the first session).
    Ok((browser, initial_tab_return))
}

/// The blocking command loop that owns the Tab.
///
/// Receives commands from the async side, executes them synchronously via
/// headless_chrome, and sends results back via oneshot channels.
/// The Browser itself is owned by SharedBrowser, not this loop.
fn run_browser_command_loop(
    tab: StdArc<headless_chrome::Tab>,
    mut command_rx: mpsc::Receiver<BrowserCommand>,
    viewer_tx: broadcast::Sender<BrowserViewerEvent>,
    ai_active: Arc<AtomicBool>,
    current_url: Arc<std::sync::Mutex<String>>,
    title: Arc<std::sync::Mutex<String>>,
    shutdown: Arc<AtomicBool>,
    sessions: Arc<Mutex<HashMap<(String, String), BrowserSessionHandle>>>,
    session_key: (String, String),
    shared_state: Arc<Mutex<Option<SharedBrowser>>>,
    is_active: Arc<AtomicBool>,
) {
    loop {
        if shutdown.load(Ordering::Relaxed) {
            break;
        }

        let cmd = match command_rx.blocking_recv() {
            Some(c) => c,
            None => break,
        };

        match cmd {
            BrowserCommand::Close => break,

            BrowserCommand::Activate => {
                if !is_active.load(Ordering::Relaxed) {
                    if let Err(e) = tab.activate() {
                        tracing::warn!("Failed to activate tab: {}", e);
                    } else {
                        let _ = tab.bring_to_front();
                        is_active.store(true, Ordering::SeqCst);
                    }
                }
            }

            BrowserCommand::Navigate { url, reply } => {
                ensure_active(&tab, &is_active);
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
                ensure_active(&tab, &is_active);
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
                ensure_active(&tab, &is_active);
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
                ensure_active(&tab, &is_active);
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
                            let sel = selector.as_ref().ok_or("selector required for attribute mode")?;
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
                            if let Some(sel) = &selector {
                                let element = tab.wait_for_element(sel).map_err(|e| e.to_string())?;
                                let text = element.get_inner_text().map_err(|e| e.to_string())?;
                                Ok(BrowserCommandResult::Extract { content: text })
                            } else {
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
                ensure_active(&tab, &is_active);
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
                ensure_active(&tab, &is_active);
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
                ensure_active(&tab, &is_active);
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

    // Cleanup: close the tab.
    let _ = tab.close_target();
    let _ = viewer_tx.send(BrowserViewerEvent::SessionClosed);

    // Remove from sessions map.
    {
        let mut sessions = sessions.blocking_lock();
        sessions.remove(&session_key);
    }

    // Decrement session count and maybe tear down shared browser.
    let shared = shared_state.blocking_lock();
    if let Some(ref sb) = *shared {
        let count = sb.session_count.fetch_sub(1, Ordering::SeqCst);
        if count <= 1 {
            tracing::info!(
                "Last browser session closed — tearing down shared Chrome + Xvfb + x11vnc"
            );
            kill_process(sb.x11vnc_pid);
            kill_process(sb.xvfb_pid);
            // Drop the SharedBrowser (which drops the Browser, killing Chrome).
            drop(shared);
            let mut shared_mut = shared_state.blocking_lock();
            *shared_mut = None;
        }
    }

    tracing::info!(
        "Browser session closed for key ({}, {})",
        session_key.0,
        session_key.1
    );
}

/// Ensure this tab is the active (visible) tab on VNC. Called before
/// commands that interact with the page so the VNC viewer sees the action.
fn ensure_active(tab: &StdArc<headless_chrome::Tab>, is_active: &Arc<AtomicBool>) {
    if !is_active.load(Ordering::Relaxed) {
        if tab.activate().is_ok() {
            let _ = tab.bring_to_front();
            is_active.store(true, Ordering::SeqCst);
        }
    }
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
fn spawn_x11vnc(display: u16, vnc_port: u16) -> Result<i32, String> {
    let display_arg = format!(":{}", display);
    let child = std::process::Command::new("x11vnc")
        .args([
            "-display",
            &display_arg,
            "-nopw",
            "-forever",
            "-shared",
            "-rfbport",
            &vnc_port.to_string(),
            "-localhost",
            "-bg",
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to spawn x11vnc: {}", e))?;

    Ok(child.id() as i32)
}

/// Check if a process is still running.
fn is_process_alive(pid: i32) -> bool {
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

/// Tab watcher: polls Chrome's tab list and detects closed tabs.
/// When a tracked session's tab is closed in Chrome (by the user or AI),
/// the session is cleaned up. Also tears down the shared Chrome when
/// all sessions are gone and Chrome has no remaining tabs.
async fn tab_watcher(
    sessions: Arc<Mutex<HashMap<(String, String), BrowserSessionHandle>>>,
    shared_state: Arc<Mutex<Option<SharedBrowser>>>,
) {
    loop {
        tokio::time::sleep(Duration::from_secs(2)).await;

        // Get the shared browser (if running).
        let browser = {
            let shared = shared_state.lock().await;
            shared.as_ref().map(|sb| sb.browser.clone())
        };

        let Some(browser) = browser else {
            // Chrome not running — nothing to watch.
            continue;
        };

        // Get current Chrome tab target IDs.
        let live_target_ids: std::collections::HashSet<String> = {
            let browser = browser.clone();
            match tokio::task::spawn_blocking(move || {
                let tabs = browser.get_tabs();
                let guard = tabs.lock().unwrap();
                guard.iter().map(|t| t.get_target_id().to_string()).collect::<Vec<_>>()
            })
            .await
            {
                Ok(ids) => ids.into_iter().collect(),
                Err(_) => continue,
            }
        };

        // Find tracked sessions whose tab is no longer in Chrome.
        let stale_keys: Vec<(String, String)> = {
            let sessions = sessions.lock().await;
            sessions
                .keys()
                .filter(|(_, session_id)| !live_target_ids.contains(session_id))
                .cloned()
                .collect()
        };

        for key in &stale_keys {
            tracing::info!(
                "Tab watcher: tab {} closed for user {}, cleaning up session",
                key.1,
                key.0
            );
            let sessions = sessions.lock().await;
            if let Some(h) = sessions.get(key) {
                h.shutdown_session();
            }
        }

        // Teardown guard: if no tracked sessions remain and Chrome has no
        // tabs at all, tear down the shared browser.
        if stale_keys.is_empty() {
            // Check if we should tear down.
            let session_count = {
                let sessions = sessions.lock().await;
                sessions.len()
            };
            if session_count == 0 && live_target_ids.is_empty() {
                let mut shared = shared_state.lock().await;
                if let Some(ref sb) = *shared {
                    tracing::info!(
                        "Tab watcher: no sessions and no Chrome tabs — tearing down shared browser"
                    );
                    kill_process(sb.x11vnc_pid);
                    kill_process(sb.xvfb_pid);
                    *shared = None;
                }
            }
        }
    }
}