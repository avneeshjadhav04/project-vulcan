use crate::{
    auth::decrypt_key,
    middleware::AppState,
    models::{
        Chat, Claims, CreateChatRequest, Message, Provider, SendMessageRequest,
        UpdateAgentStepsRequest, UpdateChatOrganizationRequest, UpdateToolsConfigRequest, User,
    },
};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{Json, Sse},
    routing::{delete, get, post},
    Router,
};
use base64::Engine;
use futures::stream::StreamExt;
use serde_json::json;
use std::collections::HashMap;
use std::convert::Infallible;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, RwLock};
use tokio_util::sync::CancellationToken;

struct ResolvedProvider {
    id: String,
    base_url: String,
    api_key: String,
}

// ─── Active stream registry for reconnectable chat streaming ───

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum StreamStatus {
    Running,
    Done,
    Error,
}

#[derive(Clone)]
pub struct ActiveStream {
    pub chat_id: String,
    pub content: Arc<RwLock<String>>,
    pub tool_executions: Arc<RwLock<Vec<serde_json::Value>>>,
    pub status: Arc<RwLock<StreamStatus>>,
    pub cancel_token: CancellationToken,
}

impl ActiveStream {
    pub fn new(chat_id: String) -> Self {
        Self {
            chat_id,
            content: Arc::new(RwLock::new(String::new())),
            tool_executions: Arc::new(RwLock::new(Vec::new())),
            status: Arc::new(RwLock::new(StreamStatus::Running)),
            cancel_token: CancellationToken::new(),
        }
    }

    pub async fn append_content(&self, delta: &str) {
        let mut content = self.content.write().await;
        content.push_str(delta);
    }

    pub async fn append_tool_execution(&self, tool: serde_json::Value) {
        let mut tools = self.tool_executions.write().await;
        tools.push(tool);
    }

    pub async fn set_status(&self, status: StreamStatus) {
        let mut s = self.status.write().await;
        *s = status;
    }

    pub fn cancel(&self) {
        self.cancel_token.cancel();
    }
}

pub async fn get_active_stream(
    state: &AppState,
    chat_id: &str,
) -> Option<Arc<ActiveStream>> {
    let streams = state.active_streams.read().await;
    streams.get(chat_id).cloned()
}

pub async fn insert_active_stream(
    state: &AppState,
    chat_id: String,
    stream: Arc<ActiveStream>,
) {
    let mut streams = state.active_streams.write().await;
    streams.insert(chat_id.clone(), stream);
    tracing::info!("Active stream registered for chat {}", chat_id);
}

pub async fn remove_active_stream(state: &AppState, chat_id: &str) {
    let mut streams = state.active_streams.write().await;
    streams.remove(chat_id);
    tracing::info!("Active stream removed for chat {}", chat_id);
}



async fn resolve_chat_provider(
    state: &AppState,
    chat: &Chat,
    user: &User,
) -> Result<ResolvedProvider, StatusCode> {
    if let Some(ref provider_id) = chat.provider_id {
        let provider: Provider =
            sqlx::query_as("SELECT * FROM providers WHERE id = ?1 AND user_id = ?2")
                .bind(provider_id)
                .bind(&user.id)
                .fetch_one(&state.db)
                .await
                .map_err(|_| StatusCode::NOT_FOUND)?;

        if provider.is_active == 0 {
            return Err(StatusCode::PRECONDITION_FAILED);
        }

        let api_key = decrypt_key(&provider.encrypted_api_key, &state.config.master_key)
            .map_err(|_| StatusCode::BAD_REQUEST)?;

        Ok(ResolvedProvider {
            id: provider.id,
            base_url: provider.base_url,
            api_key,
        })
    } else {
        Err(StatusCode::PRECONDITION_FAILED)
    }
}

const MAX_MESSAGE_LENGTH: usize = 100_000;
const MAX_TITLE_LENGTH: usize = 255;

// Memory summarization settings
const MEMORY_SUMMARIZE_THRESHOLD: usize = 20; // Summarize when >20 messages
const MEMORY_RECENT_WINDOW: usize = 6; // Always keep last 6 messages

/// Build the tools definition array for LLM requests.
fn build_tools_def() -> Vec<serde_json::Value> {
    vec![
        json!({
            "type": "function",
            "function": {
                "name": "execute_terminal_command",
                "description": "Execute a shell command in a sandboxed terminal environment.",
                "parameters": {
                    "type": "object",
                    "properties": {"command": {"type": "string", "description": "The shell command to execute"}},
                    "required": ["command"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "create_file",
                "description": "Create a new file in the workspace directory.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "filename": {"type": "string", "description": "Name of the file to create"},
                        "content": {"type": "string", "description": "Content to write into the file"}
                    },
                    "required": ["filename", "content"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "read_file",
                "description": "Read the contents of a file in the workspace directory.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "filename": {"type": "string", "description": "Name of the file to read"}
                    },
                    "required": ["filename"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "modify_file",
                "description": "Modify a file in the workspace. Supports replace, append, or regex_replace operations.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "filename": {"type": "string", "description": "Name of the file to modify"},
                        "operation": {"type": "string", "enum": ["replace", "append", "regex_replace"], "description": "Type of modification"},
                        "old_content": {"type": "string", "description": "Text to replace (for replace/regex_replace)"},
                        "new_content": {"type": "string", "description": "New text to insert"}
                    },
                    "required": ["filename", "operation", "new_content"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "search_web",
                "description": "Search the web for real-time information.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Search query"}
                    },
                    "required": ["query"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "browser_fetch",
                "description": "Fetch a webpage using a headless browser to get its text content. Use this to scrape URLs.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "url": {"type": "string", "description": "URL to fetch"}
                    },
                    "required": ["url"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "update_scratchpad",
                "description": "Update the user's permanent scratchpad memory. Use this to remember important facts about the user.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "content": {"type": "string", "description": "Text content to remember"}
                    },
                    "required": ["content"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "read_scratchpad",
                "description": "Read the user's permanent scratchpad memory to recall important facts.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Search query"}
                    },
                    "required": ["query"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "fetch_webpage",
                "description": "Fetch and extract the text content of a webpage. Use this to read articles, documentation, or any web page.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "url": {"type": "string", "description": "The URL of the webpage to fetch"},
                        "extract_mode": {"type": "string", "enum": ["text", "html"], "description": "Extract clean readable text (default) or raw HTML"}
                    },
                    "required": ["url"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "execute_python",
                "description": "Execute Python code in the sandboxed environment. The code runs in an isolated Ubuntu container with Python 3 installed.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "code": {"type": "string", "description": "The Python code to execute"},
                        "dependencies": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "List of pip packages to install before running"
                        }
                    },
                    "required": ["code"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "browser_session_open",
                "description": "Open a browser session for automation, or reuse an existing standalone session. Returns a session_id to use with all other browser_* tools. The user can view the browser in real-time. If the max session limit is reached, an existing idle standalone session is borrowed automatically. When done, call browser_session_release to release the session back to the user (do NOT call browser_session_close).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "session_id": {"type": "string", "description": "Optional custom session ID. If omitted, a UUID is generated."}
                    },
                    "required": []
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "browser_navigate",
                "description": "Navigate the browser to a URL. Waits for the page to finish loading.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "session_id": {"type": "string", "description": "The browser session ID from browser_session_open"},
                        "url": {"type": "string", "description": "The URL to navigate to"}
                    },
                    "required": ["session_id", "url"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "browser_click",
                "description": "Click an element on the page by CSS selector. Waits for the element to appear before clicking.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "session_id": {"type": "string", "description": "The browser session ID"},
                        "selector": {"type": "string", "description": "CSS selector for the element to click (e.g. '#login-btn', 'button[type=submit]', '.nav-link')"}
                    },
                    "required": ["session_id", "selector"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "browser_type",
                "description": "Type text into an input field identified by CSS selector. Optionally clear the field first.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "session_id": {"type": "string", "description": "The browser session ID"},
                        "selector": {"type": "string", "description": "CSS selector for the input element"},
                        "text": {"type": "string", "description": "Text to type into the field"},
                        "clear": {"type": "boolean", "description": "Whether to clear the field before typing (default: true)"}
                    },
                    "required": ["session_id", "selector", "text"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "browser_extract",
                "description": "Extract content from the page or a specific element. Use mode 'text' for visible text, 'html' for raw HTML, or 'attribute' to get an attribute value (selector format: 'css_selector[attribute_name]').",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "session_id": {"type": "string", "description": "The browser session ID"},
                        "selector": {"type": "string", "description": "CSS selector for the element to extract from. If omitted, extracts from the entire page (body)."},
                        "mode": {"type": "string", "enum": ["text", "html", "attribute"], "description": "Extraction mode: 'text' (default), 'html', or 'attribute'"}
                    },
                    "required": ["session_id"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "browser_screenshot",
                "description": "Capture a screenshot of the current page. The screenshot is persisted and can be viewed in the chat. Use this to visually inspect the page state.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "session_id": {"type": "string", "description": "The browser session ID"}
                    },
                    "required": ["session_id"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "browser_scroll",
                "description": "Scroll the page to specific coordinates.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "session_id": {"type": "string", "description": "The browser session ID"},
                        "x": {"type": "integer", "description": "Horizontal scroll position in pixels (default: 0)"},
                        "y": {"type": "integer", "description": "Vertical scroll position in pixels (default: 0)"}
                    },
                    "required": ["session_id"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "browser_wait",
                "description": "Wait for a specified number of milliseconds. Useful for waiting for dynamic content to load or animations to complete.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "session_id": {"type": "string", "description": "The browser session ID"},
                        "ms": {"type": "integer", "description": "Number of milliseconds to wait"}
                    },
                    "required": ["session_id", "ms"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "browser_run_js",
                "description": "Execute arbitrary JavaScript in the page and return the result. The script runs in the page context.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "session_id": {"type": "string", "description": "The browser session ID"},
                        "script": {"type": "string", "description": "JavaScript code to execute. Use 'return' to return a value."}
                    },
                    "required": ["session_id", "script"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "browser_get_url",
                "description": "Get the current URL of the browser page.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "session_id": {"type": "string", "description": "The browser session ID"}
                    },
                    "required": ["session_id"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "browser_session_release",
                "description": "Release a browser session back to the user when automation is complete. The session stays alive and reverts to standalone, so it can be reused by you or another chat later. Always call this (or browser_session_close, which is an alias) when browser automation is done.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "session_id": {"type": "string", "description": "The browser session ID to release"}
                    },
                    "required": ["session_id"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "browser_session_close",
                "description": "Alias for browser_session_release. Releases the browser session back to the user. Non-destructive: the session stays alive for reuse. Prefer browser_session_release.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "session_id": {"type": "string", "description": "The browser session ID to release"}
                    },
                    "required": ["session_id"]
                }
            }
        }),
    ]
}

/// Build the MCP tools definition array for LLM requests by reading discovered
/// tools from `mcp_tools`. Only tools whose MCP server is currently connected
/// are included.
async fn build_mcp_tools_def(
    state: &AppState,
    db: &sqlx::SqlitePool,
    user_id: &str,
) -> anyhow::Result<Vec<serde_json::Value>> {
    let rows: Vec<(String, String, String, String, String)> = sqlx::query_as(
        r#"
        SELECT mt.id, mt.server_id, mt.tool_name, mt.namespaced_name, mt.schema
        FROM mcp_tools mt
        JOIN mcp_servers ms ON ms.id = mt.server_id
        WHERE mt.user_id = ?1 AND ms.enabled = 1
        "#,
    )
    .bind(user_id)
    .fetch_all(db)
    .await?;

    let mut defs = Vec::with_capacity(rows.len());
    for (_id, server_id, original_name, namespaced_name, schema_str) in rows {
        // Skip tools whose server is not currently connected; advertising
        // disconnected tools leads to "Unknown tool" errors.
        if !state.mcp_manager.is_connected(user_id, &server_id).await {
            continue;
        }

        let schema: serde_json::Value = match serde_json::from_str(&schema_str) {
            Ok(v) => v,
            Err(_) => serde_json::json!({}),
        };

        // Normalize schema into OpenAI function parameters shape.
        let parameters = if schema.get("type").is_some() {
            schema
        } else {
            serde_json::json!({
                "type": "object",
                "properties": schema.get("properties").cloned().unwrap_or_else(|| serde_json::json!({})),
                "required": schema.get("required").cloned().unwrap_or_else(|| serde_json::json!([]))
            })
        };

        // Explicitly tell the LLM to use the exact namespaced name. Some models
        // ignore the function name field and use the original tool name from
        // the description or from a previous turn.
        defs.push(serde_json::json!({
            "type": "function",
            "function": {
                "name": namespaced_name,
                "description": format!(
                    "MCP tool '{}'. You MUST call this tool using the exact name '{}'.",
                    original_name, namespaced_name
                ),
                "parameters": parameters
            }
        }));
    }

    Ok(defs)
}

/// Resolve a non-namespaced MCP tool name to the namespaced name of a
/// currently connected server, if any. This handles LLMs that call tools by
/// their original name instead of the Vulcan namespaced name.
async fn resolve_mcp_tool_name(
    state: &AppState,
    user_id: &str,
    original_name: &str,
) -> Option<String> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        r#"
        SELECT mt.server_id, mt.namespaced_name
        FROM mcp_tools mt
        JOIN mcp_servers ms ON ms.id = mt.server_id
        WHERE mt.user_id = ?1 AND mt.tool_name = ?2 AND ms.enabled = 1
        "#,
    )
    .bind(user_id)
    .bind(original_name)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    for (server_id, namespaced_name) in rows {
        if state.mcp_manager.is_connected(user_id, &server_id).await {
            return Some(namespaced_name);
        }
    }
    None
}

/// Call an MCP tool with up to 3 retries on transient failures.
async fn call_mcp_tool_with_retry(
    state: &AppState,
    user_id: &str,
    namespaced_tool: &str,
    args_str: &str,
) -> Result<serde_json::Value, String> {
    let args: serde_json::Value =
        serde_json::from_str(args_str).map_err(|e| format!("Invalid args: {}", e))?;

    let mut last_error = String::new();
    for attempt in 0..3 {
        match state
            .mcp_manager
            .call_tool(user_id, namespaced_tool, args.clone())
            .await
        {
            Ok(result) => return Ok(result),
            Err(e) => {
                last_error = e.to_string();
                tracing::warn!(
                    "MCP tool call {} attempt {} failed: {}",
                    namespaced_tool,
                    attempt + 1,
                    e
                );
                if attempt < 2 {
                    tokio::time::sleep(std::time::Duration::from_millis(300 * (attempt + 1) as u64))
                        .await;
                }
            }
        }
    }
    Err(format!("MCP tool call failed after 3 attempts: {}", last_error))
}

/// Execute a single tool call and return the result JSON.
async fn execute_tool(
    name: &str,
    args_str: &str,
    chat_id: &str,
    user_id: &str,
    state: &AppState,
) -> Result<serde_json::Value, String> {
    let args: serde_json::Value =
        serde_json::from_str(args_str).map_err(|e| format!("Invalid args: {}", e))?;

    match name {
        "execute_terminal_command" => {
            let cmd = args["command"].as_str().ok_or("Missing command")?;
            let exec_res =
                crate::sandbox_engine::run_command_http(&["/bin/bash", "-c", cmd], user_id, &state.sandbox)
                    .await;
            match exec_res {
                Ok(resp) => Ok(
                    json!({"command": cmd, "stdout": resp.stdout, "stderr": resp.stderr, "status": resp.status, "code": resp.code}),
                ),
                Err(e) => Ok(
                    json!({"command": cmd, "error": format!("Execution failed: {}", e), "status": "error"}),
                ),
            }
        }
        "create_file" => {
            let filename = args["filename"].as_str().ok_or("Missing filename")?;
            if filename.contains("..") || filename.contains('\\') || filename.starts_with('/') {
                return Err("Invalid filename: Path traversal is not allowed".to_string());
            }
            let content = args["content"].as_str().ok_or("Missing content")?;
            let workspace = format!("./workspace/{}", user_id);
            let path = std::path::Path::new(&workspace).join(filename);
            if let Some(parent) = path.parent() {
                tokio::fs::create_dir_all(parent)
                    .await
                    .map_err(|e| e.to_string())?;
            }
            // Atomic write: write to temp file then rename
            let temp_path = format!("{}.tmp", path.display());
            tokio::fs::write(&temp_path, content)
                .await
                .map_err(|e| e.to_string())?;
            tokio::fs::rename(&temp_path, &path)
                .await
                .map_err(|e| e.to_string())?;
            Ok(json!({"status": "created", "filename": filename, "size": content.len()}))
        }
        "read_file" => {
            let filename = args["filename"].as_str().ok_or("Missing filename")?;
            if filename.contains("..") || filename.contains('\\') || filename.starts_with('/') {
                return Err("Invalid filename: Path traversal is not allowed".to_string());
            }
            let workspace = format!("./workspace/{}", user_id);
            let path = std::path::Path::new(&workspace).join(filename);
            let content = tokio::fs::read_to_string(&path)
                .await
                .map_err(|e| e.to_string())?;
            Ok(json!({"status": "success", "filename": filename, "content": content}))
        }
        "modify_file" => {
            let filename = args["filename"].as_str().ok_or("Missing filename")?;
            if filename.contains("..") || filename.contains('\\') || filename.starts_with('/') {
                return Err("Invalid filename: Path traversal is not allowed".to_string());
            }
            let operation = args["operation"].as_str().ok_or("Missing operation")?;
            let new_content = args["new_content"].as_str().ok_or("Missing new_content")?;
            let workspace = format!("./workspace/{}", user_id);
            let path = std::path::Path::new(&workspace).join(filename);
            let mut content = tokio::fs::read_to_string(&path)
                .await
                .map_err(|e| e.to_string())?;

            match operation {
                "replace" => {
                    let old = args["old_content"].as_str().ok_or("Missing old_content")?;
                    if !content.contains(old) {
                        return Ok(
                            json!({"status": "error", "message": "old_content not found in file"}),
                        );
                    }
                    content = content.replace(old, new_content);
                }
                "append" => {
                    content.push_str(new_content);
                }
                "regex_replace" => {
                    let old = args["old_content"].as_str().ok_or("Missing old_content")?;
                    let re = regex::Regex::new(old).map_err(|e| format!("Invalid regex: {}", e))?;
                    content = re.replace_all(&content, new_content).to_string();
                }
                _ => return Err(format!("Unknown operation: {}", operation)),
            }

            // Atomic write: write to temp file then rename
            let temp_path = format!("{}.tmp", path.display());
            tokio::fs::write(&temp_path, content)
                .await
                .map_err(|e| e.to_string())?;
            tokio::fs::rename(&temp_path, &path)
                .await
                .map_err(|e| e.to_string())?;
            Ok(json!({"status": "modified", "filename": filename}))
        }
        "search_web" => {
            let query = args["query"].as_str().ok_or("Missing query")?;
            let url = format!(
                "https://lite.duckduckgo.com/lite/?q={}",
                urlencoding::encode(query)
            );
            let res = state
                .http_client
                .get(&url)
                .send()
                .await
                .map_err(|e| e.to_string())?;
            let html = res.text().await.map_err(|e| e.to_string())?;

            let mut results = Vec::new();
            let link_re = regex::Regex::new(
                r#"<a[^>]*class=['"]result-link['"][^>]*href=['"]([^'"]+)['"][^>]*>(.*?)</a>"#,
            )
            .unwrap();
            let snippet_re =
                regex::Regex::new(r#"<td[^>]*class=['"]result-snippet['"][^>]*>(.*?)</td>"#).unwrap();

            let links: Vec<_> = link_re.captures_iter(&html).collect();
            let snippets: Vec<_> = snippet_re.captures_iter(&html).collect();

            let tag_re = regex::Regex::new(r"<[^>]+>").unwrap();
            for (i, link_cap) in links.iter().enumerate().take(5) {
                let href = link_cap.get(1).map(|m| m.as_str()).unwrap_or("");
                let title_raw = link_cap.get(2).map(|m| m.as_str()).unwrap_or("");
                let title = tag_re.replace_all(title_raw, "").to_string();
                let snippet = snippets
                    .get(i)
                    .and_then(|s| s.get(1))
                    .map(|m| tag_re.replace_all(m.as_str(), "").to_string())
                    .unwrap_or_default();

                results.push(json!({
                    "title": title.trim(),
                    "url": href,
                    "snippet": snippet.trim()
                }));
            }

            Ok(json!({"status": "success", "query": query, "results": results}))
        }
        "browser_fetch" => {
            let url = args["url"].as_str().ok_or("Missing url")?;
            let text = crate::tools::browser::browser_fetch(url).await?;
            Ok(json!({"status": "success", "content": text}))
        }
        "update_scratchpad" => {
            let content = args.get("content").and_then(|v| v.as_str()).unwrap_or("");
            sqlx::query(
                "INSERT INTO scratchpad_memory (user_id, content, updated_at) VALUES (?1, ?2, datetime('now')) ON CONFLICT(user_id) DO UPDATE SET content = ?2, updated_at = datetime('now')"
            )
            .bind(user_id)
            .bind(content)
            .execute(&state.db)
            .await
            .map_err(|e| format!("Failed to update scratchpad: {}", e))?;
            Ok(json!({"status": "success", "message": "Scratchpad updated"}))
        }
        "read_scratchpad" => {
            let content = sqlx::query_scalar::<_, String>(
                "SELECT content FROM scratchpad_memory WHERE user_id = ?1"
            )
            .bind(user_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| format!("Failed to read scratchpad: {}", e))?;
            
            if let Some(content) = content {
                Ok(json!({"status": "success", "content": content}))
            } else {
                Ok(json!({"status": "success", "content": "Scratchpad is empty."}))
            }
        }
        "fetch_webpage" => {
            let url = args["url"].as_str().ok_or("Missing url")?;
            let extract_mode = args["extract_mode"].as_str().unwrap_or("text");

            // Validate URL to prevent SSRF
            let parsed_url = reqwest::Url::parse(url).map_err(|e| format!("Invalid URL: {}", e))?;
            let scheme = parsed_url.scheme();
            if scheme != "http" && scheme != "https" {
                return Err(format!("Unsupported URL scheme: {}. Only http and https are allowed.", scheme));
            }
            let host = parsed_url.host_str().unwrap_or("");
            let blocked_hosts = ["localhost", "127.0.0.1", "0.0.0.0", "::1"];
            if blocked_hosts.contains(&host) {
                return Err("Access to internal addresses is not allowed.".to_string());
            }
            
            let res = state
                .http_client
                .get(url)
                .header("User-Agent", "Mozilla/5.0 (compatible; ProjectVulcan/1.0)")
                .timeout(std::time::Duration::from_secs(30))
                .send()
                .await
                .map_err(|e| format!("Fetch failed: {}", e))?;

            if !res.status().is_success() {
                return Err(format!("HTTP {}", res.status()));
            }

            let html = res.text().await.map_err(|e| e.to_string())?;

            if extract_mode == "html" {
                return Ok(
                    json!({"status": "success", "url": url, "content": html, "length": html.len()}),
                );
            }

            let document = scraper::Html::parse_document(&html);

            let mut text = String::new();
            for node in document.root_element().text() {
                let trimmed = node.trim();
                if !trimmed.is_empty() {
                    if !text.is_empty() {
                        text.push('\n');
                    }
                    text.push_str(trimmed);
                }
            }

            if text.len() > 50000 {
                text = text[..50000].to_string();
                text.push_str("\n\n[Content truncated at 50000 characters]");
            }

            Ok(json!({
                "status": "success",
                "url": url,
                "page_content": text,
                "length": text.len(),
            }))
        }
        "execute_python" => {
            let code = args["code"].as_str().ok_or("Missing code")?;
            
            let mut install_out = String::new();
            let mut install_err = String::new();
            if let Some(deps) = args["dependencies"].as_array() {
                let mut packages = Vec::new();
                for d in deps {
                    if let Some(s) = d.as_str() {
                        packages.push(s.to_string());
                    }
                }
                if !packages.is_empty() {
                    let mut pip_cmd = vec!["pip3", "install", "--user", "--no-cache-dir"];
                    pip_cmd.extend(packages.iter().map(|s| s.as_str()));
                    match crate::sandbox_engine::run_command_http(&pip_cmd, user_id, &state.sandbox).await {
                        Ok(pip_res) => {
                            install_out = format!("Pip install output:\n{}\n", pip_res.stdout);
                            if !pip_res.stderr.is_empty() {
                                install_err = format!("Pip install stderr:\n{}\n", pip_res.stderr);
                            }
                        }
                        Err(e) => {
                            install_err = format!("Pip install failed: {}\n", e);
                        }
                    }
                }
            }
            
            let workspace = format!("./workspace/{}", chat_id);
            tokio::fs::create_dir_all(&workspace)
                .await
                .map_err(|e| e.to_string())?;
            let script_path = format!("{}/__temp_script.py", workspace);
            let guest_script_path = format!("/workspace/{}/__temp_script.py", chat_id);
            tokio::fs::write(&script_path, code)
                .await
                .map_err(|e| e.to_string())?;
            let script_cmd = format!("python3 {}", guest_script_path);
            let exec_res = crate::sandbox_engine::run_command_http(
                &["/bin/bash", "-c", &script_cmd],
                user_id,
                &state.sandbox,
            )
            .await;

            let _ = tokio::fs::remove_file(&script_path).await;

            match exec_res {
                Ok(resp) => Ok(json!({
                    "command": format!("python3 {}", guest_script_path),
                    "script": code,
                    "stdout": format!("{}{}{}", install_out, install_err, resp.stdout),
                    "stderr": resp.stderr,
                    "status": resp.status,
                    "exit_code": resp.code,
                })),
                Err(e) => Ok(json!({
                    "command": format!("python3 {}", guest_script_path),
                    "script": code,
                    "stdout": format!("{}{}", install_out, install_err),
                    "error": format!("Execution failed: {}", e),
                    "status": "error"
                })),
            }
        }
        "browser_session_open" => {
            let session_id = args["session_id"]
                .as_str()
                .map(|s| s.to_string())
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

            // Try to create a new session (non-blocking on the semaphore).
            let _session = match crate::browser_engine::try_create_session(
                state.browser.clone(),
                user_id.to_string(),
                session_id.clone(),
                Some(chat_id.to_string()),
            )
            .await
            {
                Ok(h) => h,
                Err(ref e) if e == "max_sessions_reached" => {
                    // Max sessions reached: try to borrow an existing
                    // standalone (non-AI-active, chat_id empty) session for
                    // this user. First one wins.
                    let borrow = {
                        let sessions = state.browser.sessions.lock().await;
                        sessions
                            .values()
                            .find(|h| {
                                h.user_id == user_id
                                    && h.get_chat_id().is_empty()
                                    && !h.ai_active.load(std::sync::atomic::Ordering::Relaxed)
                            })
                            .cloned()
                    };
                    match borrow {
                        Some(h) => {
                            // Borrow: associate with this chat and reuse its
                            // existing session_id for the rest of the tool chain.
                            h.set_chat_id(chat_id);
                            let _ = sqlx::query(
                                "UPDATE browser_sessions SET chat_id = ?1, status = 'active', last_activity = datetime('now') WHERE user_id = ?2 AND session_id = ?3",
                            )
                            .bind(chat_id)
                            .bind(user_id)
                            .bind(&h.session_id)
                            .execute(&state.db)
                            .await;
                            return Ok(json!({
                                "status": "success",
                                "session_id": h.session_id,
                                "borrowed": true,
                                "message": "Max sessions reached; borrowed an existing standalone browser session. Use this session_id with all other browser_* tools. Call browser_session_release when done."
                            }));
                        }
                        None => {
                            return Err("All browser sessions are busy and the max session limit is reached. Ask the user to close one in the Browser Control panel.".to_string());
                        }
                    }
                }
                Err(e) => return Err(e),
            };

            // Insert audit row for the newly created session.
            let _ = sqlx::query(
                "INSERT INTO browser_sessions (user_id, chat_id, session_id, status) VALUES (?1, ?2, ?3, 'active')"
            )
            .bind(user_id)
            .bind(chat_id)
            .bind(&session_id)
            .execute(&state.db)
            .await;

            Ok(json!({
                "status": "success",
                "session_id": session_id,
                "message": "Browser session opened. Use this session_id with all other browser_* tools. Call browser_session_release when done (not browser_session_close)."
            }))
        }
        "browser_navigate" => {
            let session_id = args["session_id"].as_str().ok_or("Missing session_id")?;
            let url = args["url"].as_str().ok_or("Missing url")?;

            // SSRF protection: block internal addresses for AI-driven navigation.
            let parsed_url = reqwest::Url::parse(url).map_err(|e| format!("Invalid URL: {}", e))?;
            let scheme = parsed_url.scheme();
            if scheme != "http" && scheme != "https" {
                return Err(format!("Unsupported URL scheme: {}. Only http and https are allowed.", scheme));
            }
            let host = parsed_url.host_str().unwrap_or("");
            let blocked_hosts = ["localhost", "127.0.0.1", "0.0.0.0", "::1"];
            if blocked_hosts.contains(&host) {
                return Err("Access to internal addresses is not allowed.".to_string());
            }

            let session = get_browser_session(&state.browser, user_id, session_id).await?;
            let (reply, reply_rx) = tokio::sync::oneshot::channel();
            session.command_tx.send(
                crate::browser_engine::BrowserCommand::Navigate {
                    url: url.to_string(),
                    reply,
                }
            ).await.map_err(|e| format!("Failed to send command: {}", e))?;

            let result = tokio::time::timeout(
                std::time::Duration::from_secs(30),
                reply_rx,
            ).await
                .map_err(|_| "Navigation timed out".to_string())?
                .map_err(|e| e.to_string())?;

            match result {
                crate::browser_engine::BrowserCommandResult::Navigate { url: final_url, title } => {
                    // Update audit row.
                    let _ = sqlx::query(
                        "UPDATE browser_sessions SET current_url = ?1, title = ?2, last_activity = datetime('now') WHERE user_id = ?3 AND session_id = ?4"
                    )
                    .bind(&final_url)
                    .bind(&title)
                    .bind(user_id)
                    .bind(session_id)
                    .execute(&state.db)
                    .await;

                    Ok(json!({"status": "success", "url": final_url, "title": title}))
                }
                crate::browser_engine::BrowserCommandResult::Error(e) => {
                    Ok(json!({"status": "error", "error": e}))
                }
                _ => Ok(json!({"status": "error", "error": "Unexpected result type"})),
            }
        }
        "browser_click" => {
            let session_id = args["session_id"].as_str().ok_or("Missing session_id")?;
            let selector = args["selector"].as_str().ok_or("Missing selector")?;

            let session = get_browser_session(&state.browser, user_id, session_id).await?;
            let (reply, reply_rx) = tokio::sync::oneshot::channel();
            session.command_tx.send(
                crate::browser_engine::BrowserCommand::Click {
                    selector: selector.to_string(),
                    reply,
                }
            ).await.map_err(|e| format!("Failed to send command: {}", e))?;

            let result = tokio::time::timeout(
                std::time::Duration::from_secs(15),
                reply_rx,
            ).await
                .map_err(|_| "Click timed out".to_string())?
                .map_err(|e| e.to_string())?;

            match result {
                crate::browser_engine::BrowserCommandResult::Click { selector: s } => {
                    Ok(json!({"status": "success", "selector": s, "action": "clicked"}))
                }
                crate::browser_engine::BrowserCommandResult::Error(e) => {
                    Ok(json!({"status": "error", "error": e}))
                }
                _ => Ok(json!({"status": "error", "error": "Unexpected result type"})),
            }
        }
        "browser_type" => {
            let session_id = args["session_id"].as_str().ok_or("Missing session_id")?;
            let selector = args["selector"].as_str().ok_or("Missing selector")?;
            let text = args["text"].as_str().ok_or("Missing text")?;
            let clear = args["clear"].as_bool().unwrap_or(true);

            let session = get_browser_session(&state.browser, user_id, session_id).await?;
            let (reply, reply_rx) = tokio::sync::oneshot::channel();
            session.command_tx.send(
                crate::browser_engine::BrowserCommand::Type {
                    selector: selector.to_string(),
                    text: text.to_string(),
                    clear,
                    reply,
                }
            ).await.map_err(|e| format!("Failed to send command: {}", e))?;

            let result = tokio::time::timeout(
                std::time::Duration::from_secs(15),
                reply_rx,
            ).await
                .map_err(|_| "Type timed out".to_string())?
                .map_err(|e| e.to_string())?;

            match result {
                crate::browser_engine::BrowserCommandResult::Type { selector: s, text: t } => {
                    Ok(json!({"status": "success", "selector": s, "text": t, "action": "typed"}))
                }
                crate::browser_engine::BrowserCommandResult::Error(e) => {
                    Ok(json!({"status": "error", "error": e}))
                }
                _ => Ok(json!({"status": "error", "error": "Unexpected result type"})),
            }
        }
        "browser_extract" => {
            let session_id = args["session_id"].as_str().ok_or("Missing session_id")?;
            let selector = args["selector"].as_str().map(|s| s.to_string());
            let mode = args["mode"].as_str().unwrap_or("text").to_string();

            let session = get_browser_session(&state.browser, user_id, session_id).await?;
            let (reply, reply_rx) = tokio::sync::oneshot::channel();
            session.command_tx.send(
                crate::browser_engine::BrowserCommand::Extract {
                    selector: selector.clone(),
                    mode: mode.clone(),
                    reply,
                }
            ).await.map_err(|e| format!("Failed to send command: {}", e))?;

            let result = tokio::time::timeout(
                std::time::Duration::from_secs(15),
                reply_rx,
            ).await
                .map_err(|_| "Extract timed out".to_string())?
                .map_err(|e| e.to_string())?;

            match result {
                crate::browser_engine::BrowserCommandResult::Extract { content } => {
                    let truncated = content.len() > 50000;
                    let content_out = if truncated {
                        format!("{}...\n[Content truncated at 50000 characters]", &content[..50000.min(content.len())])
                    } else {
                        content
                    };
                    Ok(json!({
                        "status": "success",
                        "selector": selector,
                        "mode": mode,
                        "content": content_out,
                        "truncated": truncated
                    }))
                }
                crate::browser_engine::BrowserCommandResult::Error(e) => {
                    Ok(json!({"status": "error", "error": e}))
                }
                _ => Ok(json!({"status": "error", "error": "Unexpected result type"})),
            }
        }
        "browser_screenshot" => {
            let session_id = args["session_id"].as_str().ok_or("Missing session_id")?;

            let session = get_browser_session(&state.browser, user_id, session_id).await?;
            let (reply, reply_rx) = tokio::sync::oneshot::channel();
            session.command_tx.send(
                crate::browser_engine::BrowserCommand::Screenshot { reply }
            ).await.map_err(|e| format!("Failed to send command: {}", e))?;

            let result = tokio::time::timeout(
                std::time::Duration::from_secs(15),
                reply_rx,
            ).await
                .map_err(|_| "Screenshot timed out".to_string())?
                .map_err(|e| e.to_string())?;

            match result {
                crate::browser_engine::BrowserCommandResult::Screenshot { jpeg, url, title } => {
                    // Persist screenshot to DB.
                    let screenshot_id = uuid::Uuid::new_v4().to_string();
                    let _ = sqlx::query(
                        "INSERT INTO browser_screenshots (id, chat_id, session_id, image, mime_type, page_url) VALUES (?1, ?2, ?3, ?4, 'image/jpeg', ?5)"
                    )
                    .bind(&screenshot_id)
                    .bind(chat_id)
                    .bind(session_id)
                    .bind(&jpeg)
                    .bind(&url)
                    .execute(&state.db)
                    .await;

                    Ok(json!({
                        "status": "success",
                        "screenshot_id": screenshot_id,
                        "url": url,
                        "title": title,
                        "size_bytes": jpeg.len()
                    }))
                }
                crate::browser_engine::BrowserCommandResult::Error(e) => {
                    Ok(json!({"status": "error", "error": e}))
                }
                _ => Ok(json!({"status": "error", "error": "Unexpected result type"})),
            }
        }
        "browser_scroll" => {
            let session_id = args["session_id"].as_str().ok_or("Missing session_id")?;
            let x = args["x"].as_i64().unwrap_or(0) as i32;
            let y = args["y"].as_i64().unwrap_or(0) as i32;

            let session = get_browser_session(&state.browser, user_id, session_id).await?;
            let (reply, reply_rx) = tokio::sync::oneshot::channel();
            session.command_tx.send(
                crate::browser_engine::BrowserCommand::Scroll { x, y, reply }
            ).await.map_err(|e| format!("Failed to send command: {}", e))?;

            let result = tokio::time::timeout(
                std::time::Duration::from_secs(10),
                reply_rx,
            ).await
                .map_err(|_| "Scroll timed out".to_string())?
                .map_err(|e| e.to_string())?;

            match result {
                crate::browser_engine::BrowserCommandResult::Scroll { x, y } => {
                    Ok(json!({"status": "success", "x": x, "y": y}))
                }
                crate::browser_engine::BrowserCommandResult::Error(e) => {
                    Ok(json!({"status": "error", "error": e}))
                }
                _ => Ok(json!({"status": "error", "error": "Unexpected result type"})),
            }
        }
        "browser_wait" => {
            let session_id = args["session_id"].as_str().ok_or("Missing session_id")?;
            let ms = args["ms"].as_u64().ok_or("Missing ms")?;

            // Cap wait at 10 seconds to prevent excessive blocking.
            let ms = ms.min(10000);

            let session = get_browser_session(&state.browser, user_id, session_id).await?;
            let (reply, reply_rx) = tokio::sync::oneshot::channel();
            session.command_tx.send(
                crate::browser_engine::BrowserCommand::Wait { ms, reply }
            ).await.map_err(|e| format!("Failed to send command: {}", e))?;

            let result = tokio::time::timeout(
                std::time::Duration::from_secs(ms / 1000 + 5),
                reply_rx,
            ).await
                .map_err(|_| "Wait timed out".to_string())?
                .map_err(|e| e.to_string())?;

            match result {
                crate::browser_engine::BrowserCommandResult::Wait => {
                    Ok(json!({"status": "success", "waited_ms": ms}))
                }
                crate::browser_engine::BrowserCommandResult::Error(e) => {
                    Ok(json!({"status": "error", "error": e}))
                }
                _ => Ok(json!({"status": "error", "error": "Unexpected result type"})),
            }
        }
        "browser_run_js" => {
            let session_id = args["session_id"].as_str().ok_or("Missing session_id")?;
            let script = args["script"].as_str().ok_or("Missing script")?;

            let session = get_browser_session(&state.browser, user_id, session_id).await?;
            let (reply, reply_rx) = tokio::sync::oneshot::channel();
            session.command_tx.send(
                crate::browser_engine::BrowserCommand::RunJs {
                    script: script.to_string(),
                    reply,
                }
            ).await.map_err(|e| format!("Failed to send command: {}", e))?;

            let result = tokio::time::timeout(
                std::time::Duration::from_secs(15),
                reply_rx,
            ).await
                .map_err(|_| "JavaScript execution timed out".to_string())?
                .map_err(|e| e.to_string())?;

            match result {
                crate::browser_engine::BrowserCommandResult::RunJs { result } => {
                    let truncated = result.len() > 50000;
                    let result_out = if truncated {
                        format!("{}...\n[Result truncated]", &result[..50000.min(result.len())])
                    } else {
                        result
                    };
                    Ok(json!({"status": "success", "result": result_out, "truncated": truncated}))
                }
                crate::browser_engine::BrowserCommandResult::Error(e) => {
                    Ok(json!({"status": "error", "error": e}))
                }
                _ => Ok(json!({"status": "error", "error": "Unexpected result type"})),
            }
        }
        "browser_get_url" => {
            let session_id = args["session_id"].as_str().ok_or("Missing session_id")?;

            let session = get_browser_session(&state.browser, user_id, session_id).await?;
            let (reply, reply_rx) = tokio::sync::oneshot::channel();
            session.command_tx.send(
                crate::browser_engine::BrowserCommand::GetUrl { reply }
            ).await.map_err(|e| format!("Failed to send command: {}", e))?;

            let result = tokio::time::timeout(
                std::time::Duration::from_secs(5),
                reply_rx,
            ).await
                .map_err(|_| "Get URL timed out".to_string())?
                .map_err(|e| e.to_string())?;

            match result {
                crate::browser_engine::BrowserCommandResult::GetUrl { url } => {
                    Ok(json!({"status": "success", "url": url}))
                }
                crate::browser_engine::BrowserCommandResult::Error(e) => {
                    Ok(json!({"status": "error", "error": e}))
                }
                _ => Ok(json!({"status": "error", "error": "Unexpected result type"})),
            }
        }
        "browser_session_release" | "browser_session_close" => {
            // Both names map to a non-destructive release: the session stays
            // alive and reverts to standalone so the user (or another chat)
            // can reuse it later. Only the Browser Control panel's close
            // button truly destroys a session (via the WS `close` message).
            let session_id = args["session_id"].as_str().ok_or("Missing session_id")?;

            let session = {
                let sessions = state.browser.sessions.lock().await;
                sessions.get(&(user_id.to_string(), session_id.to_string())).cloned()
            };

            if let Some(session) = session {
                session.set_chat_id("");
                session.ai_active.store(false, std::sync::atomic::Ordering::SeqCst);

                // Reflect the release in the audit row.
                let _ = sqlx::query(
                    "UPDATE browser_sessions SET chat_id = NULL, last_activity = datetime('now') WHERE user_id = ?1 AND session_id = ?2"
                )
                .bind(user_id)
                .bind(session_id)
                .execute(&state.db)
                .await;

                Ok(json!({"status": "success", "session_id": session_id, "message": "Browser session released back to the user. It remains available for reuse."}))
            } else {
                Ok(json!({"status": "error", "error": "Browser session not found"}))
            }
        }
        _ => {
            // The LLM may use either the namespaced name (filesystem__list_directory)
            // or the original tool name (list_directory). Resolve non-namespaced
            // names to the connected server's namespaced name when unique.
            let effective_name = if name.contains("__") {
                name.to_string()
            } else {
                match resolve_mcp_tool_name(state, user_id, name).await {
                    Some(namespaced) => namespaced,
                    None => return Err(format!("Unknown tool: {}", name)),
                }
            };

            if state.mcp_manager.is_mcp_tool(user_id, &effective_name).await {
                match call_mcp_tool_with_retry(state, user_id, &effective_name, args_str).await {
                    Ok(result) => Ok(result),
                    Err(e) => Ok(json!({"error": e})),
                }
            } else {
                Err(format!("Unknown tool: {}", name))
            }
        }
    }
}

/// Look up a browser session by user_id and session_id, returning an error
/// message suitable for the AI if the session doesn't exist.
async fn get_browser_session(
    browser_state: &crate::browser_engine::BrowserState,
    user_id: &str,
    session_id: &str,
) -> Result<crate::browser_engine::BrowserSessionHandle, String> {
    let sessions = browser_state.sessions.lock().await;
    sessions
        .get(&(user_id.to_string(), session_id.to_string()))
        .cloned()
        .ok_or_else(|| {
            "Browser session not found. Call browser_session_open first to create a session.".to_string()
        })
}

/// Resolve all tool calls from the LLM response concurrently.
async fn resolve_tool_calls(
    calls: &[serde_json::Value],
    chat_id: &str,
    user_id: &str,
    state: &AppState,
) -> Vec<(String, String, serde_json::Value)> {
    let mut results = Vec::with_capacity(calls.len());

    let permissions: std::collections::HashMap<String, String> = sqlx::query_as::<_, (String, String)>(
        "SELECT tool_name, permission_level FROM tool_permissions WHERE user_id = ?1",
    )
    .bind(user_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default()
    .into_iter()
    .collect();

    for call in calls {
        let func = match call["function"].as_object() {
            Some(f) => f,
            None => continue,
        };
        let name = match func["name"].as_str() {
            Some(n) => n.to_string(),
            None => continue,
        };
        let args_str = func["arguments"].as_str().unwrap_or("{}");
        let tool_id = call["id"].as_str().unwrap_or("call_1").to_string();

        let perm = permissions.get(&name).map(|s| s.as_str()).unwrap_or("auto");
        if perm == "deny" {
            results.push((tool_id, name, json!({"error": "Tool execution denied by user configuration."})));
            continue;
        }
        if perm == "ask" {
            let preview_len = args_str.len().min(200);
            let preview = &args_str[..preview_len];
            results.push((tool_id.clone(), name.clone(), json!({"error": "Tool execution requires user approval.", "tool": name, "args_preview": preview, "approval_needed": true})));
            continue;
        }

        match execute_tool(&name, args_str, chat_id, user_id, state).await {
            Ok(result) => results.push((tool_id, name, result)),
            Err(e) => results.push((tool_id, name, json!({"error": e}))),
        }
    }
    results
}

/// Persist a tool execution result as a message in the database.
async fn persist_tool_message(
    db: &sqlx::SqlitePool,
    chat_id: &str,
    tool_call_id: &str,
    tool_name: &str,
    result: &serde_json::Value,
    parent_id: &Option<String>,
) {
    let content = serde_json::to_string(result).unwrap_or_default();
    if let Err(e) = sqlx::query(
        "INSERT INTO messages (chat_id, role, content, tool_call_id, tool_name, parent_id) VALUES (?1, 'tool', ?2, ?3, ?4, ?5)"
    )
    .bind(chat_id)
    .bind(content)
    .bind(tool_call_id)
    .bind(tool_name)
    .bind(parent_id)
    .execute(db)
    .await
    {
        tracing::error!("Failed to persist tool message: {}", e);
    }
}

/// Build the dynamic system prompt based on current context.
fn build_dynamic_system_prompt() -> String {
    String::from(
        "You are a helpful AI assistant running on Project Vulcan, a personal SaaS platform.\n\n\
         You have access to the following capabilities:\n\
         - Sandboxed terminal: Execute shell commands in an isolated Ubuntu environment.\n\
         - File operations: Create, read, and modify files in the workspace.\n\
         - Web search: Search the web for current information.\n\
         - Browser automation: Open or reuse a browser session with browser_session_open, then drive it \
           with browser_navigate, browser_click, browser_type, browser_extract, browser_screenshot, \
           browser_scroll, browser_wait, browser_run_js, browser_get_url, and browser_session_release. \
           Always open or reuse a session first and pass the returned session_id to all subsequent browser tools. \
           Use CSS selectors for click/type/extract. Use browser_wait for dynamic content to load. \
           Use browser_screenshot to capture the current page state. The user can see the browser in \
           real-time — when you are controlling, they cannot interact. Browser sessions are standalone \
           resources owned by the user; when you are done, call browser_session_release (not \
           browser_session_close) so the session reverts to standalone and can be reused by you or \
           another chat later. Do NOT destroy sessions unless the user explicitly asks.\n\
         - Pre-installed tools: python3, pip, nodejs, npm, git, curl, wget, gcc, g++, make, and build-essential are already available. \
           Use `execute_terminal_command` with `apt-get update && apt-get install -y <package>` only if you need software that is not pre-installed (e.g. nmap, ffmpeg, imagemagick).\n\n\
         When the user asks you to do something that requires these tools, use them proactively. \
         If you need multiple tools, call them in sequence. \
         Always explain what you're doing when using tools. \
         **Self-Healing execution:** If a tool execution fails (e.g. returns an error or non-zero exit code), \
         carefully analyze the error output (stderr or json error) and attempt to fix the issue by running a corrected tool call. \
         You may retry autonomously before asking the user for help. \
         **Artifacts:** When generating complex HTML, CSS, SVG, React, or Mermaid diagrams, wrap the code block in an artifact tag to render it visually for the user. \
         Syntax: ```html artifact=\"Title of Artifact\"\n...code...\n```. \
         Be concise and helpful.",
    )
}

async fn get_scratchpad(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let content = sqlx::query_scalar::<_, String>(
        "SELECT content FROM scratchpad_memory WHERE user_id = ?1"
    )
    .bind(&claims.sub)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(json!({"content": content.unwrap_or_default()})))
}

async fn update_scratchpad_endpoint(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Json(req): Json<serde_json::Value>,
) -> Result<StatusCode, StatusCode> {
    let content = req["content"].as_str().unwrap_or("");
    sqlx::query(
        "INSERT INTO scratchpad_memory (user_id, content, updated_at) VALUES (?1, ?2, datetime('now')) ON CONFLICT(user_id) DO UPDATE SET content = ?2, updated_at = datetime('now')"
    )
    .bind(&claims.sub)
    .bind(content)
    .execute(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(StatusCode::OK)
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/chats", post(create_chat).get(list_chats))
        .route(
            "/chats/{id}",
            get(get_chat).patch(rename_chat).delete(delete_chat),
        )
        .route("/chats/{id}/message", post(send_message))
        .route("/chats/{id}/stream", delete(stop_stream))
        .route(
            "/chats/{id}/messages/{msg_id}/edit-replace",
            post(edit_message_replace),
        )
        .route(
            "/chats/{id}/messages/{msg_id}/after",
            delete(delete_messages_after),
        )
        .route(
            "/chats/{id}/messages/{msg_id}/siblings",
            get(get_message_siblings),
        )
        .route(
            "/chats/{id}/messages/{msg_id}/activate",
            post(activate_message_variant),
        )
        .route(
            "/chats/{id}/messages/{msg_id}/react",
            post(add_reaction).delete(remove_reaction),
        )
        .route("/chats/{id}/export", get(export_chat))
        .route("/search", get(search_chats))
        .route("/usage", get(get_usage))
        .route("/me", get(get_me))
        .route("/me/memory", post(toggle_memory))
        .route("/me/summarization", post(toggle_summarization))
        .route("/me/cross-chat-memory", post(toggle_cross_chat_memory))
        .route("/me/tools", post(update_tools_config))
        .route("/me/agent-steps", post(update_agent_steps))
        .route("/me/scratchpad", get(get_scratchpad).post(update_scratchpad_endpoint))
}

async fn get_me(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let user: User = sqlx::query_as("SELECT * FROM users WHERE id = ?1")
        .bind(claims.sub.clone())
        .fetch_one(&state.db)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;

    let provider_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM providers WHERE user_id = ?1 AND is_active = 1")
            .bind(&claims.sub)
            .fetch_one(&state.db)
            .await
            .unwrap_or(0);
    let has_provider = provider_count > 0;

    Ok(Json(json!({
        "id": user.id,
        "email": user.email,
        "role": user.role,
        "is_active": user.is_active == 1,
        "has_provider": has_provider,
        "provider_count": provider_count,
        "tools_enabled": user.tools_enabled == 1,
        "memory_enabled": user.memory_enabled == 1,
        "summarization_enabled": user.summarization_enabled == 1,
        "cross_chat_memory_enabled": user.cross_chat_memory_enabled == 1,
        "max_agent_steps": user.max_agent_steps,
    })))
}

async fn update_tools_config(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Json(req): Json<UpdateToolsConfigRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let user: User = sqlx::query_as("SELECT * FROM users WHERE id = ?1")
        .bind(claims.sub.clone())
        .fetch_one(&state.db)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;

    let tools_enabled = req.tools_enabled.map(|v| if v { 1 } else { 0 });

    sqlx::query("UPDATE users SET tools_enabled = COALESCE(?1, tools_enabled) WHERE id = ?2")
        .bind(tools_enabled)
        .bind(claims.sub.clone())
        .execute(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(json!({
        "tools_enabled": tools_enabled.unwrap_or(user.tools_enabled) == 1,
    })))
}

async fn update_agent_steps(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Json(req): Json<UpdateAgentStepsRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    if req.max_agent_steps < 1 || req.max_agent_steps > 50 {
        return Err(StatusCode::BAD_REQUEST);
    }

    sqlx::query("UPDATE users SET max_agent_steps = ?1 WHERE id = ?2")
        .bind(req.max_agent_steps)
        .bind(claims.sub.clone())
        .execute(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(json!({
        "max_agent_steps": req.max_agent_steps,
    })))
}

async fn toggle_memory(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let user: User = sqlx::query_as("SELECT * FROM users WHERE id = ?1")
        .bind(claims.sub.clone())
        .fetch_one(&state.db)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;

    let new_value = if user.memory_enabled == 1 { 0 } else { 1 };

    sqlx::query("UPDATE users SET memory_enabled = ?1 WHERE id = ?2")
        .bind(new_value)
        .bind(claims.sub.clone())
        .execute(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(json!({
        "memory_enabled": new_value == 1,
    })))
}

async fn toggle_summarization(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let user: User = sqlx::query_as("SELECT * FROM users WHERE id = ?1")
        .bind(claims.sub.clone())
        .fetch_one(&state.db)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;

    let new_value = if user.summarization_enabled == 1 { 0 } else { 1 };

    sqlx::query("UPDATE users SET summarization_enabled = ?1 WHERE id = ?2")
        .bind(new_value)
        .bind(claims.sub.clone())
        .execute(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(json!({
        "summarization_enabled": new_value == 1,
    })))
}

async fn toggle_cross_chat_memory(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let user: User = sqlx::query_as("SELECT * FROM users WHERE id = ?1")
        .bind(claims.sub.clone())
        .fetch_one(&state.db)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;

    let new_value = if user.cross_chat_memory_enabled == 1 { 0 } else { 1 };

    sqlx::query("UPDATE users SET cross_chat_memory_enabled = ?1 WHERE id = ?2")
        .bind(new_value)
        .bind(claims.sub.clone())
        .execute(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(json!({
        "cross_chat_memory_enabled": new_value == 1,
    })))
}

async fn create_chat(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Json(req): Json<CreateChatRequest>,
) -> Result<(StatusCode, Json<Chat>), StatusCode> {
    let title = req.title.unwrap_or_else(|| "New Chat".to_string());
    if title.len() > MAX_TITLE_LENGTH {
        return Err(StatusCode::BAD_REQUEST);
    }
    if req.model_id.is_empty() || req.model_id.len() > 255 {
        return Err(StatusCode::BAD_REQUEST);
    }

    let provider_id = req.provider_id.as_deref().filter(|s| !s.is_empty());

    let chat: Chat = sqlx::query_as(
        "INSERT INTO chats (user_id, title, model_id, provider_id) VALUES (?1, ?2, ?3, ?4) RETURNING *"
    )
    .bind(claims.sub.clone())
    .bind(&title)
    .bind(&req.model_id)
    .bind(provider_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Create chat error: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok((StatusCode::CREATED, Json(chat)))
}

async fn list_chats(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
) -> Result<Json<Vec<Chat>>, StatusCode> {
    let chats: Vec<Chat> =
        sqlx::query_as("SELECT * FROM chats WHERE user_id = ?1 ORDER BY updated_at DESC")
            .bind(claims.sub.clone())
            .fetch_all(&state.db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(chats))
}

async fn get_chat(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let chat: Chat = sqlx::query_as("SELECT * FROM chats WHERE id = ?1 AND user_id = ?2")
        .bind(id.clone())
        .bind(claims.sub.clone())
        .fetch_one(&state.db)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;

    // Active path: root messages (parent_id IS NULL) + active variants.
    // Tool messages have parent_id set to the assistant variant that spawned
    // them, so they only show when their parent assistant is active.
    let mut messages: Vec<Message> =
        sqlx::query_as("SELECT * FROM messages WHERE chat_id = ?1 AND (parent_id IS NULL OR is_active = 1) ORDER BY created_at ASC")
            .bind(id.clone())
            .fetch_all(&state.db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Merge in-memory streaming content: if there is an active stream for this
    // chat, replace the placeholder message's content with the live content
    // from the ActiveStream registry. This avoids per-chunk DB writes while
    // still serving up-to-date content to polling clients.
    if let Some(active_stream) = get_active_stream(&state, &id).await {
        let live_content = active_stream.content.read().await.clone();
        let status = *active_stream.status.read().await;
        for msg in &mut messages {
            if msg.streaming == 1 {
                msg.content = live_content.clone();
                if status != StreamStatus::Running {
                    msg.streaming = 0;
                }
            }
        }
    }

    // Build sibling counts for each message on the active path.
    // Group by (parent_id, role): count all messages sharing the same parent_id
    // AND the same role. This lets both user messages and assistant messages have
    // independent variant counts.
    let sibling_rows: Vec<(String, String, i64)> = sqlx::query_as(
        "SELECT parent_id, role, COUNT(*) FROM messages
         WHERE chat_id = ?1 AND parent_id IS NOT NULL AND role IN ('user', 'assistant')
         AND (tool_name IS NULL OR tool_name != 'tool_calls_init')
         GROUP BY parent_id, role",
    )
    .bind(id.clone())
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Key by (parent_id, role) -> count
    let mut sibling_counts: std::collections::HashMap<(String, String), i64> = std::collections::HashMap::new();
    for (parent_id, role, count) in sibling_rows {
        sibling_counts.insert((parent_id, role), count);
    }

    // For each active message (user or assistant), look up its sibling count.
    let variants: Vec<serde_json::Value> = messages
        .iter()
        .filter(|m| m.role == "user" || (m.role == "assistant" && m.tool_name.is_none()))
        .filter_map(|m| {
            m.parent_id.as_ref().and_then(|pid| {
                let total = sibling_counts.get(&(pid.clone(), m.role.clone())).copied().unwrap_or(1);
                if total > 1 {
                    Some(serde_json::json!({
                        "message_id": m.id,
                        "parent_id": pid,
                        "total": total,
                        "role": m.role,
                    }))
                } else {
                    None
                }
            })
        })
        .collect();

    Ok(Json(json!({
        "chat": chat,
        "messages": messages,
        "variants": variants,
    })))
}

async fn rename_chat(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path(id): Path<String>,
    Json(req): Json<UpdateChatOrganizationRequest>,
) -> Result<Json<Chat>, StatusCode> {
    if let Some(ref title) = req.title {
        let trimmed = title.trim();
        if trimmed.is_empty() || trimmed.len() > MAX_TITLE_LENGTH {
            return Err(StatusCode::BAD_REQUEST);
        }
    }

    let tags_json = req
        .tags
        .map(|t| serde_json::to_string(&t).unwrap_or_else(|_| "[]".to_string()));

    let chat: Chat = sqlx::query_as(
        "UPDATE chats SET
            title = COALESCE(?1, title),
            model_id = COALESCE(?2, model_id),
            provider_id = COALESCE(?3, provider_id),
            folder = COALESCE(?4, folder),
            tags = COALESCE(?5, tags),
            is_pinned = COALESCE(?6, is_pinned),
            is_archived = COALESCE(?7, is_archived),
            updated_at = datetime('now')
         WHERE id = ?8 AND user_id = ?9
         RETURNING *",
    )
    .bind(req.title.as_deref())
    .bind(req.model_id.as_deref())
    .bind(req.provider_id.as_deref())
    .bind(req.folder.as_deref())
    .bind(tags_json.as_deref())
    .bind(req.is_pinned.map(|v| if v { 1 } else { 0 }))
    .bind(req.is_archived.map(|v| if v { 1 } else { 0 }))
    .bind(&id)
    .bind(claims.sub.clone())
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Update chat error: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(chat))
}

async fn delete_chat(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path(id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    let result = sqlx::query("DELETE FROM chats WHERE id = ?1 AND user_id = ?2")
        .bind(id)
        .bind(claims.sub.clone())
        .execute(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Delete chat error: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    if result.rows_affected() == 0 {
        return Err(StatusCode::NOT_FOUND);
    }

    Ok(StatusCode::NO_CONTENT)
}

/// POST /chats/:id/messages/:msg_id/edit-replace
/// Destructive edit: updates the user message content in-place and hard-deletes
/// all descendant messages (assistant responses, tool messages, downstream).
/// The edited message keeps its id and parent_id so it stays in the same position.
/// Returns the same message id so the frontend can stream a fresh response.
#[derive(Debug, serde::Deserialize)]
struct EditReplaceRequest {
    content: String,
    attachments: Option<Vec<String>>,
}

async fn edit_message_replace(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path((chat_id, msg_id)): Path<(String, String)>,
    Json(req): Json<EditReplaceRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let content = req.content.trim();
    if content.is_empty() || content.len() > MAX_MESSAGE_LENGTH {
        return Err(StatusCode::BAD_REQUEST);
    }

    // Fetch the old user message (verify ownership + role)
    let old_msg: Message = sqlx::query_as(
        "SELECT m.* FROM messages m
         JOIN chats c ON m.chat_id = c.id
         WHERE m.id = ?1 AND m.chat_id = ?2 AND c.user_id = ?3 AND m.role = 'user'",
    )
    .bind(&msg_id)
    .bind(&chat_id)
    .bind(&claims.sub)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .ok_or(StatusCode::NOT_FOUND)?;

    // Hard-delete all descendants of the old user message (recursive).
    // This removes all assistant responses (including siblings/variants),
    // tool messages, and any downstream messages.
    let _ = sqlx::query(
        "WITH RECURSIVE descendants(id) AS (
            SELECT id FROM messages WHERE parent_id = ?1 AND chat_id = ?2
            UNION ALL
            SELECT m.id FROM messages m
            JOIN descendants d ON m.parent_id = d.id
            WHERE m.chat_id = ?2
         )
         DELETE FROM messages WHERE id IN (SELECT id FROM descendants) AND chat_id = ?2",
    )
    .bind(&old_msg.id)
    .bind(&chat_id)
    .execute(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Delete descendants error: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Update the user message content in-place (same id, same parent_id)
    let attachments_json = req.attachments.as_ref().map(|a| serde_json::to_string(a).unwrap_or_default());
    let _ = sqlx::query(
        "UPDATE messages SET content = ?1, attachments = ?2 WHERE id = ?3 AND chat_id = ?4",
    )
    .bind(content)
    .bind(attachments_json.as_deref())
    .bind(&msg_id)
    .bind(&chat_id)
    .execute(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Update edited user message error: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(json!({ "new_message_id": msg_id })))
}

async fn delete_messages_after(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path((chat_id, msg_id)): Path<(String, String)>,
) -> Result<StatusCode, StatusCode> {
    let msg: Option<Message> = sqlx::query_as(
        "SELECT * FROM messages WHERE id = ?1 AND chat_id = ?2 AND EXISTS (SELECT 1 FROM chats WHERE id = ?2 AND user_id = ?3)"
    )
    .bind(&msg_id)
    .bind(&chat_id)
    .bind(&claims.sub)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Get message error: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let message = match msg {
        Some(m) => m,
        None => return Err(StatusCode::NOT_FOUND),
    };

    sqlx::query("DELETE FROM messages WHERE chat_id = ?1 AND created_at > ?2")
        .bind(&chat_id)
        .bind(message.created_at)
        .execute(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Delete messages after error: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    Ok(StatusCode::NO_CONTENT)
}

/// GET /chats/:id/messages/:msg_id/siblings
/// Returns all sibling assistant messages sharing the same parent_id as :msg_id,
/// ordered by created_at. Used by the frontend to render the < > navigator.
async fn get_message_siblings(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path((chat_id, msg_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    // Verify ownership
    let msg: Message = sqlx::query_as(
        "SELECT m.* FROM messages m
         JOIN chats c ON m.chat_id = c.id
         WHERE m.id = ?1 AND m.chat_id = ?2 AND c.user_id = ?3",
    )
    .bind(&msg_id)
    .bind(&chat_id)
    .bind(&claims.sub)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .ok_or(StatusCode::NOT_FOUND)?;

    let parent_id = match msg.parent_id {
        Some(ref pid) => pid.clone(),
        None => return Ok(Json(json!({ "siblings": [] }))),
    };

    // Filter by the same role as the queried message so both user and assistant
    // message siblings are supported.
    let siblings: Vec<Message> = sqlx::query_as(
        "SELECT * FROM messages WHERE chat_id = ?1 AND parent_id = ?2 AND role = ?3
         AND (tool_name IS NULL OR tool_name != 'tool_calls_init')
         ORDER BY created_at ASC",
    )
    .bind(&chat_id)
    .bind(&parent_id)
    .bind(&msg.role)
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let sibling_data: Vec<serde_json::Value> = siblings
        .iter()
        .map(|s| {
            json!({
                "id": s.id,
                "content": s.content,
                "created_at": s.created_at,
                "tokens_used": s.tokens_used,
                "is_active": s.is_active == 1,
            })
        })
        .collect();

    Ok(Json(json!({ "siblings": sibling_data })))
}

/// POST /chats/:id/messages/:msg_id/activate
/// Switches the active variant to :msg_id by deactivating all siblings and
/// their descendants, then activating :msg_id and its descendants.
async fn activate_message_variant(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path((chat_id, msg_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    // Verify ownership and fetch the message
    let msg: Message = sqlx::query_as(
        "SELECT m.* FROM messages m
         JOIN chats c ON m.chat_id = c.id
         WHERE m.id = ?1 AND m.chat_id = ?2 AND c.user_id = ?3",
    )
    .bind(&msg_id)
    .bind(&chat_id)
    .bind(&claims.sub)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .ok_or(StatusCode::NOT_FOUND)?;

    if msg.parent_id.is_none() {
        return Err(StatusCode::BAD_REQUEST);
    }

    // Navigation is now frontend-only; this endpoint just returns the selected
    // message, all of its ancestors, and all of its descendants as a read-only view.
    let selected_messages: Vec<Message> = sqlx::query_as(
        "WITH RECURSIVE
         ancestors(id) AS (
            SELECT ?1
            UNION ALL
            SELECT m.parent_id FROM messages m JOIN ancestors a ON m.id = a.id
            WHERE m.parent_id IS NOT NULL AND m.chat_id = ?2
         ),
         descendants(id) AS (
            SELECT ?1
            UNION ALL
            SELECT m.id FROM messages m JOIN descendants d ON m.parent_id = d.id
            WHERE m.chat_id = ?2
         ),
         selected_path(id) AS (
            SELECT id FROM ancestors
            UNION
            SELECT id FROM descendants
         )
         SELECT * FROM messages
         WHERE chat_id = ?2 AND id IN (SELECT id FROM selected_path)
         ORDER BY created_at ASC",
    )
    .bind(&msg_id)
    .bind(&chat_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Load variant error: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Recompute variants for the selected path. Sibling counts are still based on
    // the full chat so the navigator shows the real total.
    let sibling_rows: Vec<(String, String, i64)> = sqlx::query_as(
        "SELECT parent_id, role, COUNT(*) FROM messages
         WHERE chat_id = ?1 AND parent_id IS NOT NULL AND role IN ('user', 'assistant')
         AND (tool_name IS NULL OR tool_name != 'tool_calls_init')
         GROUP BY parent_id, role",
    )
    .bind(&chat_id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let mut sibling_counts: std::collections::HashMap<(String, String), i64> = std::collections::HashMap::new();
    for (pid, role, count) in sibling_rows {
        sibling_counts.insert((pid, role), count);
    }

    let variants: Vec<serde_json::Value> = selected_messages
        .iter()
        .filter(|m| m.role == "user" || (m.role == "assistant" && m.tool_name.is_none()))
        .filter_map(|m| {
            m.parent_id.as_ref().and_then(|pid| {
                let total = sibling_counts.get(&(pid.clone(), m.role.clone())).copied().unwrap_or(1);
                if total > 1 {
                    Some(serde_json::json!({
                        "message_id": m.id,
                        "parent_id": pid,
                        "total": total,
                        "role": m.role,
                    }))
                } else {
                    None
                }
            })
        })
        .collect();

    Ok(Json(json!({
        "messages": selected_messages,
        "variants": variants,
    })))
}

async fn export_chat(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path(id): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<(axum::http::HeaderMap, String), StatusCode> {
    let chat: Chat = sqlx::query_as("SELECT * FROM chats WHERE id = ?1 AND user_id = ?2")
        .bind(id.clone())
        .bind(claims.sub.clone())
        .fetch_one(&state.db)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;

    let messages: Vec<Message> =
        sqlx::query_as("SELECT * FROM messages WHERE chat_id = ?1 ORDER BY created_at ASC")
            .bind(id.clone())
            .fetch_all(&state.db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let format = params
        .get("format")
        .map(|s| s.as_str())
        .unwrap_or("markdown");

    // Sanitize chat title for use as a filename
    let safe_title = chat.title.replace(|c: char| c.is_ascii_control() || c == '/' || c == '\\' || c == ':' || c == '*' || c == '?' || c == '"' || c == '<' || c == '>' || c == '|', "_");

    let (content, content_type, filename) = match format {
        "json" => {
            let data = json!({"chat": chat, "messages": messages});
            (
                data.to_string(),
                "application/json",
                format!("{}.json", safe_title),
            )
        }
        _ => {
            let mut md = format!("# {}\n\n", chat.title);
            md.push_str(&format!("Model: {}\n", chat.model_id));
            md.push_str(&format!("Created: {}\n\n", chat.created_at));
            md.push_str("---\n\n");
            for msg in messages {
                let role_label = if msg.role == "assistant" {
                    "Project Vulcan"
                } else {
                    "User"
                };
                md.push_str(&format!("## {}\n\n{}", role_label, msg.content));
                if let Some(tokens_used) = msg.tokens_used {
                    md.push_str(&format!("\n\n*Tokens: {}*", tokens_used));
                }
                md.push_str("\n\n---\n\n");
            }
            (md, "text/markdown", format!("{}.md", safe_title))
        }
    };

    let mut headers = axum::http::HeaderMap::new();
    headers.insert(
        axum::http::header::CONTENT_TYPE,
        content_type.parse().unwrap(),
    );
    headers.insert(
        axum::http::header::CONTENT_DISPOSITION,
        format!("attachment; filename=\"{}\"", filename.replace('"', "\\\""))
            .parse()
            .unwrap(),
    );

    Ok((headers, content))
}

/// Summarize older messages in a conversation using the LLM.
/// Returns the summary text.
async fn summarize_conversation(
    state: &AppState,
    base_url: &str,
    api_key: &str,
    model_id: &str,
    messages_to_summarize: &[Message],
) -> Result<String, String> {
    if messages_to_summarize.is_empty() {
        return Ok(String::new());
    }

    let mut summary_messages = vec![json!({
        "role": "system",
        "content": "You are a conversation summarizer. Create a concise summary of the following conversation. Focus on key facts, decisions, code, and context that would help an AI assistant continue the conversation. Be brief but thorough. Output ONLY the summary text."
    })];

    for msg in messages_to_summarize {
        summary_messages.push(json!({
            "role": msg.role,
            "content": msg.content,
        }));
    }

    let body = json!({
        "model": model_id,
        "messages": summary_messages,
        "stream": false,
        "max_tokens": 512,
        "temperature": 0.3,
    });

    let res = state
        .http_client
        .post(format!("{}/chat/completions", base_url))
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Summary request failed: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("Summary request returned {}", res.status()));
    }

    let data: serde_json::Value = res
        .json()
        .await
        .map_err(|e| format!("Failed to parse summary: {}", e))?;
    let summary = data["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .trim()
        .to_string();

    Ok(summary)
}

/// Build the messages payload for an LLM request, using summarization if memory is enabled.
fn build_messages_payload(
    system_prompt: &str,
    summary: Option<&str>,
    recent_messages: &[Message],
) -> Vec<serde_json::Value> {
    let mut payload = vec![json!({"role": "system", "content": system_prompt})];

    if let Some(s) = summary {
        if !s.is_empty() {
            payload.push(json!({
                "role": "system",
                "content": format!("[Previous conversation summary]: {}", s)
            }));
        }
    }

    for msg in recent_messages {
        if msg.role == "assistant" && msg.tool_name.as_deref() == Some("tool_calls_init") {
            // This is an assistant message that initiated tool calls
            let tool_calls: Vec<serde_json::Value> = msg.tool_call_id
                .as_deref()
                .and_then(|s| serde_json::from_str(s).ok())
                .unwrap_or_default();
            if !tool_calls.is_empty() {
                payload.push(json!({
                    "role": "assistant",
                    "content": msg.content,
                    "tool_calls": tool_calls
                }));
            } else {
                payload.push(json!({"role": "assistant", "content": msg.content}));
            }
        } else if msg.role == "tool" {
            let tc = json!({
                "id": msg.tool_call_id.as_deref().unwrap_or(""),
                "type": "function",
                "function": {
                    "name": msg.tool_name.as_deref().unwrap_or("unknown_tool"),
                    "arguments": "{}"
                }
            });
            
            let mut added_to_existing = false;
            if let Some(last) = payload.last_mut() {
                if last["role"] == "assistant" {
                    if let Some(calls) = last.get_mut("tool_calls") {
                        if let Some(calls_array) = calls.as_array_mut() {
                            calls_array.push(tc.clone());
                            added_to_existing = true;
                        }
                    } else {
                        last.as_object_mut().unwrap().insert("tool_calls".to_string(), json!([tc]));
                        added_to_existing = true;
                    }
                }
            }
            if !added_to_existing {
                payload.push(json!({
                    "role": "assistant",
                    "content": null,
                    "tool_calls": [tc]
                }));
            }
            
            payload.push(json!({
                "role": "tool",
                "tool_call_id": msg.tool_call_id.as_deref().unwrap_or(""),
                "content": msg.content
            }));
        } else {
            // Check if message contains multimodal image data
            if msg.content.starts_with("__MULTIMODAL__") {
                let json_str = msg.content.trim_start_matches("__MULTIMODAL__");
                if let Ok(multimodal) = serde_json::from_str::<serde_json::Value>(json_str) {
                    let text = multimodal["text"].as_str().unwrap_or("");
                    let empty_images = Vec::new();
                    let images = multimodal["images"].as_array().unwrap_or(&empty_images);
                    
                    let mut content_parts = vec![json!({"type": "text", "text": text})];
                    for img_url in images {
                        if let Some(url) = img_url.as_str() {
                            content_parts.push(json!({
                                "type": "image_url",
                                "image_url": {"url": url}
                            }));
                        }
                    }
                    
                    payload.push(json!({
                        "role": msg.role,
                        "content": content_parts
                    }));
                    continue;
                }
            }
            payload.push(json!({"role": msg.role, "content": msg.content}));
        }
    }

    payload
}

async fn resolve_message_attachments(
    db: &sqlx::SqlitePool,
    messages: &mut [Message],
) {
    for msg in messages.iter_mut() {
        if let Some(attachments_json) = &msg.attachments {
            if let Ok(attachment_names) = serde_json::from_str::<Vec<String>>(attachments_json) {
                let mut text_contents = Vec::new();
                let mut image_data_urls = Vec::new();
                
                for filename in attachment_names {
                    if let Ok(file) = sqlx::query_as::<_, crate::models::FileRecord>(
                        "SELECT * FROM files WHERE filename = ?1 AND chat_id = ?2 ORDER BY created_at DESC LIMIT 1"
                    )
                    .bind(&filename)
                    .bind(&msg.chat_id)
                    .fetch_optional(db)
                    .await
                    {
                        if let Some(file) = file {
                            let is_image = file.mime_type.starts_with("image/");
                            
                            if is_image {
                                // Read image and encode as base64
                                if let Ok(data) = tokio::fs::read(&file.storage_path).await {
                                    let base64_data = base64::engine::general_purpose::STANDARD.encode(&data);
                                    let data_url = format!("data:{};base64,{}", file.mime_type, base64_data);
                                    image_data_urls.push(data_url);
                                }
                            } else {
                                // Text extraction for non-images
                                if let Some(extracted_text) = file.extracted_text {
                                    text_contents.push(format!(
                                        "[File: {}]\n```\n{}\n```",
                                        file.filename,
                                        extracted_text
                                    ));
                                } else {
                                    text_contents.push(format!("[File: {}]", file.filename));
                                }
                            }
                        }
                    }
                }
                
                // Build the content
                let mut parts = Vec::new();
                if !text_contents.is_empty() {
                    parts.push(text_contents.join("\n\n"));
                }
                if !msg.content.is_empty() {
                    parts.push(msg.content.clone());
                }
                
                let combined_text = parts.join("\n\n");
                
                if !image_data_urls.is_empty() {
                    // Create multimodal format for images
                    let multimodal = json!({
                        "text": combined_text,
                        "images": image_data_urls
                    });
                    msg.content = format!("__MULTIMODAL__{}", multimodal.to_string());
                } else {
                    msg.content = combined_text;
                }
            }
        }
    }
}

async fn send_message(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path(id): Path<String>,
    Json(req): Json<SendMessageRequest>,
) -> Result<
    Sse<impl futures::Stream<Item = Result<axum::response::sse::Event, Infallible>>>,
    StatusCode,
> {
    let content = req.content.trim();
    if content.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    if content.len() > MAX_MESSAGE_LENGTH {
        return Err(StatusCode::PAYLOAD_TOO_LARGE);
    }

    let user: User = sqlx::query_as("SELECT * FROM users WHERE id = ?1")
        .bind(claims.sub.clone())
        .fetch_one(&state.db)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;

    let chat: Chat = sqlx::query_as("SELECT * FROM chats WHERE id = ?1 AND user_id = ?2")
        .bind(id.clone())
        .bind(claims.sub.clone())
        .fetch_one(&state.db)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;

    // Persist model/provider selection from the frontend so this message uses
    // the currently selected model, even if the chat row hasn't been updated yet.
    let chat = if req.provider_id.is_some() || req.model_id.is_some() {
        if let Some(ref pid) = req.provider_id {
            let _: Provider = sqlx::query_as("SELECT * FROM providers WHERE id = ?1 AND user_id = ?2")
                .bind(pid)
                .bind(&claims.sub)
                .fetch_one(&state.db)
                .await
                .map_err(|_| StatusCode::BAD_REQUEST)?;
        }
        sqlx::query_as(
            "UPDATE chats SET
                model_id = COALESCE(?1, model_id),
                provider_id = COALESCE(?2, provider_id),
                updated_at = datetime('now')
             WHERE id = ?3 AND user_id = ?4
             RETURNING *",
        )
        .bind(req.model_id.as_deref())
        .bind(req.provider_id.as_deref())
        .bind(id.clone())
        .bind(claims.sub.clone())
        .fetch_one(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    } else {
        chat
    };

    let resolved = resolve_chat_provider(&state, &chat, &user).await?;

    let is_regenerate = req.is_regenerate.unwrap_or(false);
    let regenerate_from_msg_id = req.regenerate_from_msg_id.clone();
    let existing_user_msg_id = req.existing_user_msg_id.clone();
    let attachments_json = req.attachments.as_ref().map(|a| serde_json::to_string(a).unwrap_or_default());

    // For non-destructive regeneration: deactivate the old assistant message and
    // its descendants (tool messages, downstream), then insert a new sibling.
    // The user message is preserved (not deleted), the new assistant gets
    // parent_id = the user message the old assistant followed.
    if is_regenerate {
        if let Some(ref old_assistant_id) = regenerate_from_msg_id {
            // Look up the old assistant message to find its parent (the user message).
            let old_msg: Option<Message> = sqlx::query_as(
                "SELECT * FROM messages WHERE id = ?1 AND chat_id = ?2 AND role = 'assistant'
                 AND EXISTS (SELECT 1 FROM chats WHERE id = ?2 AND user_id = ?3)",
            )
            .bind(old_assistant_id)
            .bind(id.clone())
            .bind(claims.sub.clone())
            .fetch_optional(&state.db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

            if let Some(old) = old_msg {
                // Deactivate the old assistant + all its descendants (messages whose
                // parent_id chain leads to the old assistant, including tool messages
                // that have parent_id = old assistant id, and any downstream messages).
                // Use a recursive CTE to find all descendants.
                let _ = sqlx::query(
                    "WITH RECURSIVE descendants(id) AS (
                        SELECT id FROM messages WHERE id = ?1
                        UNION ALL
                        SELECT m.id FROM messages m
                        JOIN descendants d ON m.parent_id = d.id
                        WHERE m.chat_id = ?2
                    )
                    UPDATE messages SET is_active = 0
                    WHERE id IN (SELECT id FROM descendants) AND chat_id = ?2",
                )
                .bind(&old.id)
                .bind(id.clone())
                .execute(&state.db)
                .await;
            }
        }
    } else if existing_user_msg_id.is_some() {
        // Edit-branch flow: the user message was already created by the
        // edit-branch endpoint. Skip the user INSERT — the new assistant
        // will use existing_user_msg_id as its parent_id.
    } else {
        // Normal send: insert the user message.
        // parent_id = the last active message in this chat (the current leaf).
        let parent_id: Option<String> = sqlx::query_scalar(
            "SELECT id FROM messages WHERE chat_id = ?1 AND is_active = 1
             ORDER BY created_at DESC LIMIT 1",
        )
        .bind(id.clone())
        .fetch_optional(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        sqlx::query("INSERT INTO messages (chat_id, role, content, attachments, parent_id) VALUES (?1, 'user', ?2, ?3, ?4)")
            .bind(id.clone())
            .bind(content)
            .bind(attachments_json.as_deref())
            .bind(parent_id)
            .execute(&state.db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }

    // Auto-update title on first user message if still "New Chat"
    if chat.title == "New Chat" {
        let new_title = if content.len() > 50 {
            &content[..50]
        } else {
            content
        };
        let _ = sqlx::query("UPDATE chats SET title = ?1 WHERE id = ?2")
            .bind(new_title)
            .bind(id.clone())
            .execute(&state.db)
            .await;
    }

    let _ = sqlx::query("UPDATE chats SET updated_at = datetime('now') WHERE id = ?1")
        .bind(id.clone())
        .execute(&state.db)
        .await;

    let mut history: Vec<Message> =
        sqlx::query_as("SELECT * FROM messages WHERE chat_id = ?1 AND (parent_id IS NULL OR is_active = 1) ORDER BY created_at ASC")
            .bind(id.clone())
            .fetch_all(&state.db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Resolve file attachments for AI context
    resolve_message_attachments(&state.db, &mut history).await;

    let mut system_prompt = build_dynamic_system_prompt();

    // ─── Scratchpad Memory (always available if enabled) ───
    let scratchpad_enabled = user.memory_enabled == 1;
    if scratchpad_enabled {
        let scratchpad = sqlx::query_scalar::<_, String>("SELECT content FROM scratchpad_memory WHERE user_id = ?1")
            .bind(&user.id)
            .fetch_optional(&state.db)
            .await
            .unwrap_or_default();
        if let Some(content) = scratchpad {
            if !content.is_empty() {
                system_prompt.push_str(&format!("\n\n[USER SCRATCHPAD MEMORY]\n{}", content));
            }
        }
    }
    
    // ─── Cross-Chat Memory (opt-in) ───
    let cross_chat_enabled = user.cross_chat_memory_enabled == 1;
    if cross_chat_enabled {
        let cross_chat_facts = sqlx::query_scalar::<_, String>(
            "SELECT content FROM cross_chat_memory WHERE user_id = ?1 ORDER BY updated_at DESC LIMIT 1"
        )
        .bind(&user.id)
        .fetch_optional(&state.db)
        .await
        .unwrap_or_default();
        if let Some(content) = cross_chat_facts {
            if !content.is_empty() {
                system_prompt.push_str(&format!("\n\n[CROSS-CHAT CONTEXT]\n{}", content));
            }
        }
    }
    
    // ─── Summarization Logic ───
    let summarization_enabled = user.summarization_enabled == 1;
    let needs_summarization =
        summarization_enabled && history.len() > MEMORY_SUMMARIZE_THRESHOLD + MEMORY_RECENT_WINDOW;

    let messages_payload = if needs_summarization {
        // Split into older messages (to summarize) and recent messages (to keep verbatim)
        let split_at = history.len() - MEMORY_RECENT_WINDOW;
        let older = &history[..split_at];
        let recent = &history[split_at..];

        let latest_summarized_message_at = older.last().map(|msg| msg.created_at);
        let use_existing_summary = chat
            .summary
            .as_ref()
            .is_some_and(|summary| !summary.is_empty())
            && match (chat.summary_updated_at, latest_summarized_message_at) {
                (Some(summary_updated_at), Some(latest_message_at)) => {
                    summary_updated_at >= latest_message_at
                }
                _ => false,
            };

        let summary_text = if use_existing_summary {
            chat.summary.clone().unwrap_or_default()
        } else {
            // Use previous summary (even if stale) while generating new one in background
            let stale_summary = chat.summary.clone().unwrap_or_default();
            
            // Generate summary in background (don't block response)
            let state_clone = state.clone();
            let base_url_clone = resolved.base_url.clone();
            let api_key_clone = resolved.api_key.clone();
            let model_id_clone = chat.model_id.clone();
            let chat_id_clone = id.clone();
            let older_msgs: Vec<Message> = older.to_vec();

            tokio::spawn(async move {
                match summarize_conversation(
                    &state_clone,
                    &base_url_clone,
                    &api_key_clone,
                    &model_id_clone,
                    &older_msgs,
                )
                .await
                {
                    Ok(summary) => {
                        let _ = sqlx::query(
                            "UPDATE chats SET summary = ?1, summary_updated_at = datetime('now') WHERE id = ?2"
                        )
                        .bind(&summary)
                        .bind(&chat_id_clone)
                        .execute(&state_clone.db)
                        .await;
                        tracing::info!(
                            "Generated summary for chat {} ({} chars)",
                            chat_id_clone,
                            summary.len()
                        );
                    }
                    Err(e) => {
                        tracing::warn!(
                            "Failed to generate summary for chat {}: {}",
                            chat_id_clone,
                            e
                        );
                    }
                }
            });

            // Return stale summary if available, otherwise empty string
            if !stale_summary.is_empty() {
                stale_summary
            } else {
                // No previous summary available - generate synchronously for first time
                match summarize_conversation(
                    &state,
                    &resolved.base_url,
                    &resolved.api_key,
                    &chat.model_id,
                    older,
                )
                .await
                {
                    Ok(summary) => {
                        let _ = sqlx::query(
                            "UPDATE chats SET summary = ?1, summary_updated_at = datetime('now') WHERE id = ?2"
                        )
                        .bind(&summary)
                        .bind(&id)
                        .execute(&state.db)
                        .await;
                        summary
                    }
                    Err(_) => String::new(),
                }
            }
        };

        build_messages_payload(&system_prompt, Some(&summary_text), recent)
    } else {
        build_messages_payload(&system_prompt, None, &history)
    };

    let should_use_tools = std::env::var("DISABLE_TOOLS").is_err() && user.tools_enabled == 1;

    // Determine the parent_id for the new assistant message:
    // - Edit-branch: the newly created user message (existing_user_msg_id).
    // - Regenerate: the user message that the old assistant followed (its parent_id).
    // - Normal send: the just-inserted user message (last active message).
    let new_assistant_parent_id: Option<String> = if let Some(ref eid) = existing_user_msg_id {
        Some(eid.clone())
    } else if is_regenerate {
        if let Some(ref old_id) = regenerate_from_msg_id {
            sqlx::query_scalar::<_, Option<String>>(
                "SELECT parent_id FROM messages WHERE id = ?1 AND chat_id = ?2",
            )
            .bind(old_id)
            .bind(id.clone())
            .fetch_optional(&state.db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
            .flatten()
        } else {
            // Fallback: last active user message's id
            sqlx::query_scalar::<_, String>(
                "SELECT id FROM messages WHERE chat_id = ?1 AND role = 'user' AND is_active = 1
                 ORDER BY created_at DESC LIMIT 1",
            )
            .bind(id.clone())
            .fetch_optional(&state.db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        }
    } else {
        // The user message we just inserted (last active message).
        sqlx::query_scalar::<_, String>(
            "SELECT id FROM messages WHERE chat_id = ?1 AND is_active = 1
             ORDER BY created_at DESC LIMIT 1",
        )
        .bind(id.clone())
        .fetch_optional(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    };

    // ─── Active stream registry for reconnectable streaming ───
    if let Some(existing) = get_active_stream(&state, &id).await {
        let status = *existing.status.read().await;
        if status == StreamStatus::Running {
            return Err(StatusCode::CONFLICT);
        }
    }

    let active_stream = Arc::new(ActiveStream::new(id.clone()));
    insert_active_stream(&state, id.clone(), active_stream.clone()).await;

    let db = state.db.clone();
    let chat_id = id.clone();
    let model = chat.model_id.clone();
    let provider = resolved.id.clone();
    let url = resolved.base_url.clone();
    let key = resolved.api_key.clone();
    let max_steps = user.max_agent_steps as usize;
    let state_clone = state.clone();
    let user_id = claims.sub.clone();
    let assistant_parent_id = new_assistant_parent_id.clone();
    let stream_arc = active_stream.clone();

    tokio::spawn(async move {
        let stream_arc_for_tools = stream_arc.clone();
        let stream_arc_for_final = stream_arc.clone();


        if !should_use_tools {
            run_llm_stream(LlmStreamContext {
                state: &state_clone,
                base_url: &url,
                api_key: &key,
                model_id: &model,
                provider_id: &provider,
                messages: &messages_payload,
                chat_id: &chat_id,
                db: &db,
                active_stream: &stream_arc,
                parent_id: assistant_parent_id.as_deref(),
            })
            .await;
            remove_active_stream(&state_clone, &chat_id).await;
            return;
        }

        let mut current_messages = messages_payload;
        let mut tools = build_tools_def();
        // Discover and append MCP tools for this user. Connect auto-start servers lazily.
        match state_clone.mcp_manager.load_user_servers(&db, &user_id).await {
            Ok(_) => {
                match build_mcp_tools_def(&state_clone, &db, &user_id).await {
                    Ok(mut mcp_tools) => tools.append(&mut mcp_tools),
                    Err(e) => tracing::warn!("Failed to build MCP tools def: {}", e),
                }
            }
            Err(e) => tracing::warn!("Failed to load user MCP servers: {}", e),
        }
        let mut total_steps = 0;

        loop {
            if stream_arc_for_tools.cancel_token.is_cancelled() {
                break;
            }
            if total_steps >= max_steps {
                tracing::info!(
                    "Agent max steps ({}) reached, streaming final response",
                    max_steps
                );
                break;
            }
            total_steps += 1;

            let tool_body = json!({
                "model": model,
                "messages": current_messages,
                "tools": tools,
                "tool_choice": "auto",
                "max_tokens": 2048,
            });

            let tool_res = match state_clone
                .http_client
                .post(format!("{}/chat/completions", url))
                .header("Authorization", format!("Bearer {}", key))
                .header("Content-Type", "application/json")
                .json(&tool_body)
                .send()
                .await
            {
                Ok(r) => r,
                Err(e) => {
                    tracing::warn!("Tool request failed: {}. Falling back to streaming.", e);
                    break;
                }
            };

            if !tool_res.status().is_success() {
                let status = tool_res.status();
                let body_len = tool_res.text().await.map(|t| t.len()).unwrap_or(0);
                tracing::warn!(
                    "Tool request returned {} ({} bytes). Falling back to streaming.",
                    status,
                    body_len
                );
                break;
            }

            let tool_data: serde_json::Value = match tool_res.json().await {
                Ok(d) => d,
                Err(e) => {
                    tracing::warn!("Failed to parse tool response: {}", e);
                    break;
                }
            };

            let choice = match tool_data["choices"][0].as_object() {
                Some(c) => c,
                None => break,
            };

            let assistant_msg = &choice["message"];
            let tool_calls = match assistant_msg["tool_calls"].as_array() {
                Some(calls) if !calls.is_empty() => calls,
                _ => break,
            };

            let mut asst_json = json!({"role": "assistant", "content": null, "tool_calls": []});
            if let Some(text) = assistant_msg["content"].as_str() {
                if !text.is_empty() {
                    asst_json["content"] = json!(text);
                }
            }
            let mut tc_entries = Vec::new();
            for call in tool_calls {
                let tid = call["id"].as_str().unwrap_or("call_1");
                let tname = call["function"]["name"].as_str().unwrap_or("unknown");
                let targs = call["function"]["arguments"].as_str().unwrap_or("{}");
                tc_entries.push(json!({
                    "id": tid,
                    "type": "function",
                    "function": {"name": tname, "arguments": targs}
                }));
            }
            asst_json["tool_calls"] = json!(tc_entries);
            current_messages.push(asst_json.clone());

            // Persist the assistant's tool_calls message to the database
            let asst_content = asst_json["content"].as_str().unwrap_or("");
            let asst_tool_calls_str = serde_json::to_string(&tc_entries).unwrap_or_default();
            let tool_init_id: Option<String> = sqlx::query_scalar(
                "INSERT INTO messages (chat_id, role, content, tool_call_id, tool_name, parent_id) VALUES (?1, 'assistant', ?2, ?3, ?4, ?5) RETURNING id"
            )
            .bind(&chat_id)
            .bind(asst_content)
            .bind(&asst_tool_calls_str)
            .bind("tool_calls_init")
            .bind(&assistant_parent_id)
            .fetch_one(&db)
            .await
            .ok();

            let tool_results =
                resolve_tool_calls(tool_calls, &chat_id, &user_id, &state_clone).await;

            for (tool_id, tool_name, tool_result) in &tool_results {
                let mut event_obj = tool_result.clone();
                if let Some(obj) = event_obj.as_object_mut() {
                    obj.insert("tool_name".to_string(), json!(tool_name));
                    obj.insert("tool_id".to_string(), json!(tool_id));

                    if tool_name == "execute_terminal_command" && !obj.contains_key("command") {
                        obj.insert("command".to_string(), json!(""));
                    }
                }
                let tool_frame = format!("[TOOL]{}[/TOOL]", event_obj);
                stream_arc_for_tools.append_content(&tool_frame).await;
                if let Ok(tool_val) = serde_json::from_str::<serde_json::Value>(&tool_frame[6..tool_frame.len()-7]) {
                    stream_arc_for_tools.append_tool_execution(tool_val).await;
                }

                persist_tool_message(&db, &chat_id, tool_id, tool_name, tool_result, &tool_init_id).await;

                current_messages.push(json!({
                    "role": "tool",
                    "tool_call_id": tool_id,
                    "content": serde_json::to_string(tool_result).unwrap_or_default(),
                }));
            }
        }

        run_llm_stream(LlmStreamContext {
            state: &state_clone,
            base_url: &url,
            api_key: &key,
            model_id: &model,
            provider_id: &provider,
            messages: &current_messages,
            chat_id: &chat_id,
            db: &db,
            active_stream: &stream_arc_for_final,
            parent_id: assistant_parent_id.as_deref(),
        })
        .await;
        remove_active_stream(&state_clone, &chat_id).await;
    });

    // Create a per-request channel and forward the active stream to it live.
    // The generation task writes deltas to the registry, and this forwarder
    // ensures the initial SSE connection receives them until completion.
    let (tx, rx) = mpsc::channel::<String>(64);
    let forward_stream = active_stream.clone();
    tokio::spawn(async move {
        forward_active_stream_to_channel(forward_stream, tx).await;
    });

    Ok(make_sse_stream(rx))
}

struct LlmStreamContext<'a> {
    state: &'a AppState,
    base_url: &'a str,
    api_key: &'a str,
    model_id: &'a str,
    provider_id: &'a str,
    messages: &'a [serde_json::Value],
    chat_id: &'a str,
    db: &'a sqlx::SqlitePool,
    active_stream: &'a Arc<ActiveStream>,
    parent_id: Option<&'a str>,
}

async fn run_llm_stream(ctx: LlmStreamContext<'_>) {
    let LlmStreamContext {
        state,
        base_url,
        api_key,
        model_id,
        provider_id,
        messages,
        chat_id,
        db,
        active_stream,
        parent_id,
    } = ctx;
    let body = json!({"model": model_id, "messages": messages, "stream": true, "max_tokens": 2048});

    // Insert a placeholder streaming assistant message so that a page refresh
    // can immediately show the response as it is being generated.
    let provider_id_str = provider_id.to_string();
    let model_id_str = model_id.to_string();
    let chat_id_str = chat_id.to_string();
    let parent_id_str = parent_id.map(|s| s.to_string());
    let stream_msg_id: Option<String> = sqlx::query_scalar(
        "INSERT INTO messages (chat_id, role, content, streaming, provider_id, model_id, parent_id) VALUES (?1, 'assistant', '', 1, ?2, ?3, ?4) RETURNING id"
    )
    .bind(&chat_id_str)
    .bind(&provider_id_str)
    .bind(&model_id_str)
    .bind(&parent_id_str)
    .fetch_one(db)
    .await
    .ok();

    async fn finalize_stream_message(
        db: &sqlx::SqlitePool,
        msg_id: Option<&String>,
        full_content: &str,
        streaming: bool,
    ) {
        let Some(id) = msg_id else { return };
        let streaming_flag = if streaming { 1 } else { 0 };
        let estimated_tokens = (full_content.len() / 4) as i32;
        if let Err(e) = sqlx::query(
            "UPDATE messages SET content = ?1, streaming = ?2, tokens_used = ?3 WHERE id = ?4"
        )
        .bind(full_content)
        .bind(streaming_flag)
        .bind(estimated_tokens)
        .bind(id)
        .execute(db)
        .await {
            tracing::error!("Failed to update streaming assistant message: {}", e);
        }
    }

        let provider_response = state
        .http_client
        .post(format!("{}/chat/completions", base_url))
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await;

    let mut stream_opt = None;
    let mut is_error = false;

    match provider_response {
        Ok(res) => {
            if !res.status().is_success() {
                let status = res.status();
                let body_text = res.text().await.unwrap_or_default();
                tracing::error!(
                    "Provider returned error status: {} body: {} model={}",
                    status,
                    body_text,
                    model_id
                );
                is_error = true;
                let user_msg = if status == 404 {
                    let models_res = state
                        .http_client
                        .get(format!("{}/models", base_url))
                        .header("Authorization", format!("Bearer {}", api_key))
                        .send()
                        .await;
                    let suggestion = match models_res {
                        Ok(mres) if mres.status().is_success() => {
                            if let Ok(data) = mres.json::<serde_json::Value>().await {
                                data["data"]
                                    .as_array()
                                    .and_then(|arr| arr.first())
                                    .and_then(|m| m["id"].as_str())
                                    .map(|s| s.to_string())
                            } else {
                                None
                            }
                        }
                        _ => None,
                    };
                    let base_msg = format!("[ERR]Model '{}' not found (404). The model may be unavailable or your API key doesn't have access to it.", model_id);
                    if let Some(suggested) = suggestion {
                        format!("{} Try using '{}' instead, or select a different model from the dropdown.[/ERR]", base_msg, suggested)
                    } else {
                        format!(
                            "{} Try selecting a different model from the dropdown.[/ERR]",
                            base_msg
                        )
                    }
                } else if status == 401 {
                    "[ERR]Invalid API key (401). Please check your API key in Settings.[/ERR]"
                        .to_string()
                } else {
                    format!("[ERR]AI provider returned error {}: {}. Please check your API key and try again.[/ERR]", status, body_text.chars().take(200).collect::<String>())
                };
                active_stream.append_content(&user_msg).await;
                active_stream.set_status(StreamStatus::Error).await;
                finalize_stream_message(
                    db,
                    stream_msg_id.as_ref(),
                    &user_msg,
                    false,
                )
                .await;
            } else {
                stream_opt = Some(res.bytes_stream());
            }
        }
        Err(e) => {
            tracing::error!("Provider request error: {}", e);
            let err_msg = "[ERR]Failed to connect to AI provider. Please check your internet connection and API key.[/ERR]";
            active_stream.append_content(err_msg).await;
            active_stream.set_status(StreamStatus::Error).await;
            is_error = true;
            finalize_stream_message(db, stream_msg_id.as_ref(), err_msg, false).await;
        }
    }

    if let Some(mut stream) = stream_opt {
        let mut buffer = String::new();
        let mut full_content = String::new();
        let chat_id = chat_id.to_string();
        let db = db.clone();

        while let Some(chunk_result) = stream.next().await {
            if active_stream.cancel_token.is_cancelled() {
                tracing::info!("Stream cancelled for chat {}", chat_id);
                finalize_stream_message(
                    &db,
                    stream_msg_id.as_ref(),
                    &full_content,
                    false,
                )
                .await;
                break;
            }
            match chunk_result {
                Ok(bytes) => {
                    buffer.push_str(&String::from_utf8_lossy(&bytes));
                    if buffer.len() > MAX_MESSAGE_LENGTH * 2 {
                        tracing::error!("SSE buffer exceeded max size, aborting stream");
                        finalize_stream_message(
                            &db,
                            stream_msg_id.as_ref(),
                            &full_content,
                            false,
                        )
                        .await;
                        break;
                    }
                    while let Some(pos) = buffer.find("\n\n") {
                        let frame = buffer[..pos].to_string();
                        buffer = buffer[pos + 2..].to_string();
                        for line in frame.lines() {
                            if let Some(data) = line.strip_prefix("data: ") {
                                if data == "[DONE]" {
                                    active_stream.set_status(StreamStatus::Done).await;
                                    finalize_stream_message(
                                        &db,
                                        stream_msg_id.as_ref(),
                                        &full_content,
                                        false,
                                    )
                                    .await;
                                    return;
                                }
                                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data)
                                {
                                    if let Some(content) =
                                        parsed["choices"][0]["delta"]["content"].as_str()
                                    {
                                        full_content.push_str(content);
                                        active_stream.append_content(content).await;
                                        if full_content.len() > MAX_MESSAGE_LENGTH {
                                            tracing::error!(
                                                "Full content exceeded max size, aborting stream"
                                            );
                                            active_stream.set_status(StreamStatus::Done).await;
                                            finalize_stream_message(
                                                &db,
                                                stream_msg_id.as_ref(),
                                                &full_content,
                                                false,
                                            )
                                            .await;
                                            return;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    tracing::error!("Stream chunk error: {}", e);
                    finalize_stream_message(
                        &db,
                        stream_msg_id.as_ref(),
                        &full_content,
                        false,
                    )
                    .await;
                    break;
                }
            }
        }

        let status = *active_stream.status.read().await;
        if status != StreamStatus::Error {
            active_stream.set_status(StreamStatus::Done).await;
        }
        finalize_stream_message(
            &db,
            stream_msg_id.as_ref(),
            &full_content,
            false,
        )
        .await;
    } else if !is_error {
        let status = *active_stream.status.read().await;
        if status != StreamStatus::Error {
            active_stream.set_status(StreamStatus::Done).await;
        }
        finalize_stream_message(db, stream_msg_id.as_ref(), "", false).await;
    }
}

// ─── Reactions ───

#[derive(serde::Deserialize)]
struct ReactionRequest {
    reaction: String,
}

async fn add_reaction(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path((chat_id, msg_id)): Path<(String, String)>,
    Json(req): Json<ReactionRequest>,
) -> Result<StatusCode, StatusCode> {
    let reaction = match req.reaction.as_str() {
        "thumbs_up" | "thumbs_down" => req.reaction,
        _ => return Err(StatusCode::BAD_REQUEST),
    };

    let result = sqlx::query(
        "INSERT INTO message_reactions (message_id, user_id, reaction) 
         SELECT ?1, ?2, ?3 FROM messages m JOIN chats c ON m.chat_id = c.id 
         WHERE m.id = ?1 AND c.id = ?4 AND c.user_id = ?2",
    )
    .bind(&msg_id)
    .bind(&claims.sub)
    .bind(&reaction)
    .bind(&chat_id)
    .execute(&state.db)
    .await;

    match result {
        Ok(_) => Ok(StatusCode::CREATED),
        Err(sqlx::Error::Database(db_err)) if db_err.is_unique_violation() => {
            let _ = sqlx::query(
                "UPDATE message_reactions SET reaction = ?1 WHERE message_id = ?2 AND user_id = ?3",
            )
            .bind(&reaction)
            .bind(&msg_id)
            .bind(&claims.sub)
            .execute(&state.db)
            .await;
            Ok(StatusCode::OK)
        }
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

async fn remove_reaction(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path((_chat_id, msg_id)): Path<(String, String)>,
) -> Result<StatusCode, StatusCode> {
    let result =
        sqlx::query("DELETE FROM message_reactions WHERE message_id = ?1 AND user_id = ?2")
            .bind(&msg_id)
            .bind(&claims.sub)
            .execute(&state.db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if result.rows_affected() == 0 {
        return Err(StatusCode::NOT_FOUND);
    }

    Ok(StatusCode::NO_CONTENT)
}

// ─── Reconnectable stream endpoints ───

fn make_sse_stream(
    rx: mpsc::Receiver<String>,
) -> Sse<impl futures::Stream<Item = Result<axum::response::sse::Event, Infallible>>> {
    let sse_stream = tokio_stream::wrappers::ReceiverStream::new(rx)
        .map(|text| Ok::<_, Infallible>(axum::response::sse::Event::default().data(text)));
    Sse::new(sse_stream)
}

/// Forward the active stream to an mpsc channel for the current browser tab.
/// Stops when the client disconnects or the stream finishes.
async fn forward_active_stream_to_channel(stream: Arc<ActiveStream>, tx: mpsc::Sender<String>) {
    let mut last_content_len = 0usize;
    let mut last_tool_count = 0usize;
    loop {
        // Copy everything we need under the locks, then release them before
        // sending over the network. Holding locks during a slow send starves
        // the generation task.
        let (content_delta, new_tools, status) = {
            let content = stream.content.read().await;
            let tools = stream.tool_executions.read().await;
            let status = *stream.status.read().await;

            let delta = if content.len() > last_content_len {
                let d = &content[last_content_len..];
                if !d.starts_with("[TOOL]")
                    && !d.starts_with("[ERR]")
                    && d != "[DONE]"
                {
                    Some(d.to_string())
                } else {
                    None
                }
            } else {
                None
            };

            let tool_frames: Vec<String> = if tools.len() > last_tool_count {
                tools[last_tool_count..]
                    .iter()
                    .map(|t| format!("[TOOL]{}[/TOOL]", t))
                    .collect()
            } else {
                Vec::new()
            };

            (delta, tool_frames, status)
        };

        // Update bookkeeping outside the locks.
        if content_delta.is_some() {
            last_content_len = stream.content.read().await.len();
        }
        if !new_tools.is_empty() {
            last_tool_count += new_tools.len();
        }

        // Send frames to the client. If the channel is closed, stop.
        if let Some(delta) = content_delta {
            if tx.send(delta).await.is_err() {
                break;
            }
        }

        for tool_frame in new_tools {
            if tx.send(tool_frame).await.is_err() {
                break;
            }
        }

        if status != StreamStatus::Running {
            let _ = tx.send("[DONE]".to_string()).await;
            break;
        }

        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

async fn stop_stream(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path(id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    // Verify chat ownership
    let _: Chat = sqlx::query_as("SELECT * FROM chats WHERE id = ?1 AND user_id = ?2")
        .bind(id.clone())
        .bind(claims.sub.clone())
        .fetch_one(&state.db)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;

    if let Some(stream) = get_active_stream(&state, &id).await {
        stream.cancel();
        remove_active_stream(&state, &id).await;
        tracing::info!("Client cancelled active stream for chat {}", id);
    } else {
        tracing::info!("Client cancel requested but no active stream for chat {}", id);
    }

    Ok(StatusCode::NO_CONTENT)
}

// ─── Search ───

async fn search_chats(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let q = params.get("q").cloned().unwrap_or_default();
    if q.len() < 2 {
        return Ok(Json(json!({ "chats": [], "messages": [] })));
    }

    let chats: Vec<(String, String)> = sqlx::query_as(
        "SELECT id, title FROM chats WHERE user_id = ?1 AND title LIKE ?2 ORDER BY updated_at DESC LIMIT 10"
    )
    .bind(&claims.sub)
    .bind(format!("%{}%", q))
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let messages: Vec<(String, String, String, String)> = sqlx::query_as(
        "SELECT m.id, m.chat_id, m.content, c.title 
         FROM messages_fts fts
         JOIN messages m ON m.rowid = fts.rowid
         JOIN chats c ON m.chat_id = c.id
         WHERE fts.content MATCH ?1 AND c.user_id = ?2
         ORDER BY m.created_at DESC LIMIT 20",
    )
    .bind(&q)
    .bind(&claims.sub)
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let chat_results: Vec<_> = chats
        .into_iter()
        .map(|(id, title)| json!({ "id": id, "title": title, "type": "chat" }))
        .collect();

    let message_results: Vec<_> = messages.into_iter().map(|(id, chat_id, content, chat_title)| {
        let preview = if content.len() > 120 { format!("{}...", &content[..120]) } else { content };
        json!({ "id": id, "chat_id": chat_id, "preview": preview, "chat_title": chat_title, "type": "message" })
    }).collect();

    Ok(Json(
        json!({ "chats": chat_results, "messages": message_results }),
    ))
}

// ─── Usage Stats ───

async fn get_usage(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let from = params.get("from").cloned().unwrap_or_default();
    let to = params.get("to").cloned().unwrap_or_default();

    let totals: (i64, Option<i64>) = sqlx::query_as(
        "SELECT COUNT(*), SUM(tokens_used) FROM messages m 
         JOIN chats c ON m.chat_id = c.id 
         WHERE c.user_id = ?1 AND m.role = 'assistant'
         AND (?2 = '' OR date(m.created_at) >= ?2)
         AND (?3 = '' OR date(m.created_at) <= ?3)",
    )
    .bind(&claims.sub)
    .bind(&from)
    .bind(&to)
    .fetch_one(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let daily: Vec<(String, i64, Option<i64>)> = sqlx::query_as(
        "SELECT date(m.created_at) as day, COUNT(*), SUM(m.tokens_used)
         FROM messages m JOIN chats c ON m.chat_id = c.id
         WHERE c.user_id = ?1 AND m.role = 'assistant'
         AND (?2 = '' OR date(m.created_at) >= ?2)
         AND (?3 = '' OR date(m.created_at) <= ?3)
         GROUP BY day ORDER BY day"
    )
    .bind(&claims.sub)
    .bind(&from)
    .bind(&to)
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let daily_stats: Vec<_> = daily.into_iter().map(|(day, count, tokens)| {
        json!({ "date": day, "messages": count, "tokens": tokens.unwrap_or(0) })
    }).collect();

    let providers: Vec<(Option<String>, Option<String>, i64, Option<i64>)> = sqlx::query_as(
        "SELECT m.provider_id, p.name, COUNT(*), SUM(m.tokens_used)
         FROM messages m
         JOIN chats c ON m.chat_id = c.id
         LEFT JOIN providers p ON m.provider_id = p.id AND p.user_id = c.user_id
         WHERE c.user_id = ?1 AND m.role = 'assistant'
         AND (?2 = '' OR date(m.created_at) >= ?2)
         AND (?3 = '' OR date(m.created_at) <= ?3)
         GROUP BY m.provider_id ORDER BY SUM(m.tokens_used) DESC"
    )
    .bind(&claims.sub)
    .bind(&from)
    .bind(&to)
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let provider_stats: Vec<_> = providers.into_iter().map(|(provider_id, provider_name, count, tokens)| {
        let id = provider_id.unwrap_or_default();
        let name = provider_name.filter(|n| !n.is_empty()).unwrap_or_else(|| if id.is_empty() { "Unknown provider".to_string() } else { id.clone() });
        json!({ "provider_id": id, "provider_name": name, "messages": count, "tokens": tokens.unwrap_or(0) })
    }).collect();

    Ok(Json(json!({
        "totals": {
            "messages": totals.0,
            "tokens": totals.1.unwrap_or(0),
        },
        "daily": daily_stats,
        "providers": provider_stats,
    })))
}
