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
    routing::{delete, get, patch, post},
    Router,
};
use futures::stream::StreamExt;
use serde_json::json;
use std::collections::HashMap;
use std::convert::Infallible;
use tokio::sync::mpsc;

struct ResolvedProvider {
    id: String,
    base_url: String,
    api_key: String,
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
        // Legacy fallback: use user's NIM key + global NIM base URL
        let nim_key = match user.encrypted_nim_key.clone() {
            Some(enc) => {
                decrypt_key(&enc, &state.config.master_key).map_err(|_| StatusCode::BAD_REQUEST)?
            }
            None => return Err(StatusCode::PRECONDITION_FAILED),
        };

        Ok(ResolvedProvider {
            id: "legacy".to_string(),
            base_url: state.config.nim_base_url.clone(),
            api_key: nim_key,
        })
    }
}

const MAX_MESSAGE_LENGTH: usize = 100_000;
const MAX_TITLE_LENGTH: usize = 255;
const MAX_API_KEY_LENGTH: usize = 512;

// Memory summarization settings
const MEMORY_SUMMARIZE_THRESHOLD: usize = 20; // Summarize when >20 messages
const MEMORY_RECENT_WINDOW: usize = 6; // Always keep last 6 messages

/// Build the full tools definition array for LLM requests.
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
                "name": "calendar_list_events",
                "description": "List upcoming calendar events. Requires Google Calendar connected in Settings.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "time_min": {"type": "string", "description": "Start time in ISO 8601 (default: now)"},
                        "time_max": {"type": "string", "description": "End time in ISO 8601 (default: 7 days from now)"},
                        "max_results": {"type": "integer", "description": "Max events to return (default: 10)"}
                    },
                    "required": []
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "calendar_create_event",
                "description": "Create a new calendar event. Requires Google Calendar connected in Settings.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "summary": {"type": "string", "description": "Event title/summary"},
                        "start_time": {"type": "string", "description": "Start time in ISO 8601 format"},
                        "end_time": {"type": "string", "description": "End time in ISO 8601 format"},
                        "description": {"type": "string", "description": "Event description"},
                        "location": {"type": "string", "description": "Event location"},
                        "timezone": {"type": "string", "description": "Timezone (default: UTC)"}
                    },
                    "required": ["summary", "start_time", "end_time"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "calendar_delete_event",
                "description": "Delete a calendar event by ID. Requires Google Calendar connected.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "event_id": {"type": "string", "description": "ID of the event to delete"}
                    },
                    "required": ["event_id"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "email_send",
                "description": "Send an email. Requires Gmail connected in Settings.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "to": {"type": "string", "description": "Recipient email address"},
                        "subject": {"type": "string", "description": "Email subject"},
                        "body": {"type": "string", "description": "Email body text"}
                    },
                    "required": ["to", "subject", "body"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "email_list",
                "description": "List recent emails from inbox. Requires Gmail connected in Settings.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "max_results": {"type": "integer", "description": "Max emails to return (default: 5)"},
                        "query": {"type": "string", "description": "Search query for emails"}
                    },
                    "required": []
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "email_read",
                "description": "Read a specific email by ID. Requires Gmail connected.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "email_id": {"type": "string", "description": "ID of the email to read"}
                    },
                    "required": ["email_id"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "tasks_list",
                "description": "List tasks from Todoist. Requires Todoist connected in Settings.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "filter": {"type": "string", "description": "Filter query (e.g., 'today', 'overdue', 'p1')"}
                    },
                    "required": []
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "tasks_create",
                "description": "Create a new task in Todoist. Requires Todoist connected.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "content": {"type": "string", "description": "Task content/name"},
                        "description": {"type": "string", "description": "Task description"},
                        "due_string": {"type": "string", "description": "Due date in natural language (e.g., 'tomorrow', 'next Monday')"},
                        "priority": {"type": "integer", "description": "Priority 1-4 (1=normal, 4=urgent)"}
                    },
                    "required": ["content"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "tasks_update",
                "description": "Update an existing Todoist task. Requires Todoist connected.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "task_id": {"type": "string", "description": "ID of the task to update"},
                        "content": {"type": "string", "description": "New task content"},
                        "due_string": {"type": "string", "description": "New due date"}
                    },
                    "required": ["task_id"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "tasks_complete",
                "description": "Mark a Todoist task as complete. Requires Todoist connected.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "task_id": {"type": "string", "description": "ID of the task to complete"}
                    },
                    "required": ["task_id"]
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
    ]
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
        "calendar_list_events" => {
            crate::integrations::google::list_calendar_events(state, user_id, &args)
                .await
                .map_err(|e| e.to_string())
        }
        "calendar_create_event" => {
            crate::integrations::google::create_calendar_event(state, user_id, &args)
                .await
                .map_err(|e| e.to_string())
        }
        "calendar_delete_event" => {
            crate::integrations::google::delete_calendar_event(state, user_id, &args)
                .await
                .map_err(|e| e.to_string())
        }
        "email_send" => crate::integrations::google::send_email(state, user_id, &args)
            .await
            .map_err(|e| e.to_string()),
        "email_list" => crate::integrations::google::list_emails(state, user_id, &args)
            .await
            .map_err(|e| e.to_string()),
        "email_read" => crate::integrations::google::read_email(state, user_id, &args)
            .await
            .map_err(|e| e.to_string()),
        "tasks_list" => crate::integrations::todoist::list_tasks(state, user_id, &args)
            .await
            .map_err(|e| e.to_string()),
        "tasks_create" => crate::integrations::todoist::create_task(state, user_id, &args)
            .await
            .map_err(|e| e.to_string()),
        "tasks_update" => crate::integrations::todoist::update_task(state, user_id, &args)
            .await
            .map_err(|e| e.to_string()),
        "tasks_complete" => crate::integrations::todoist::complete_task(state, user_id, &args)
            .await
            .map_err(|e| e.to_string()),
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
        _ => Err(format!("Unknown tool: {}", name)),
    }
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
) {
    let content = serde_json::to_string(result).unwrap_or_default();
    if let Err(e) = sqlx::query(
        "INSERT INTO messages (chat_id, role, content, tool_call_id, tool_name) VALUES (?1, 'tool', ?2, ?3, ?4)"
    )
    .bind(chat_id)
    .bind(content)
    .bind(tool_call_id)
    .bind(tool_name)
    .execute(db)
    .await
    {
        tracing::error!("Failed to persist tool message: {}", e);
    }
}

/// Build a dynamic system prompt based on available integrations and current context.
fn build_dynamic_system_prompt(has_google: bool, has_todoist: bool) -> String {
    let mut prompt = String::from(
        "You are a helpful AI assistant running on Project Vulcan, a personal SaaS platform.\n\n\
         You have access to the following capabilities:\n\
         - Sandboxed terminal: Execute shell commands in an isolated Ubuntu environment.\n\
         - File operations: Create, read, and modify files in the workspace.\n\
         - Web search: Search the web for current information.\n\
         - Pre-installed tools: python3, pip, nodejs, npm, git, curl, wget, gcc, g++, make, and build-essential are already available. \
           Use `execute_terminal_command` with `apt-get update && apt-get install -y <package>` only if you need software that is not pre-installed (e.g. nmap, ffmpeg, imagemagick).\n\n",
    );

    if has_google {
        prompt.push_str(
            "- Google Calendar: You can list, create, and manage calendar events on the user's behalf.\n\
             - Gmail: You can read, search, and send emails for the user.\n\n"
        );
    }

    if has_todoist {
        prompt.push_str(
            "- Todoist: You can list, create, update, and complete tasks on the user's behalf.\n\n",
        );
    }

    prompt.push_str(
        "When the user asks you to do something that requires these tools, use them proactively. \
         If you need multiple tools, call them in sequence. \
         Always explain what you're doing when using tools. \
         **Self-Healing execution:** If a tool execution fails (e.g. returns an error or non-zero exit code), \
         carefully analyze the error output (stderr or json error) and attempt to fix the issue by running a corrected tool call. \
         You may retry autonomously before asking the user for help. \
         **Artifacts:** When generating complex HTML, CSS, SVG, React, or Mermaid diagrams, wrap the code block in an artifact tag to render it visually for the user. \
         Syntax: ```html artifact=\"Title of Artifact\"\n...code...\n```. \
         Be concise and helpful.",
    );

    prompt
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
            "/chats/:id",
            get(get_chat).patch(rename_chat).delete(delete_chat),
        )
        .route("/chats/:id/message", post(send_message))
        .route("/chats/:id/messages/:msg_id", patch(edit_message))
        .route(
            "/chats/:id/messages/:msg_id/after",
            delete(delete_messages_after),
        )
        .route(
            "/chats/:id/messages/:msg_id/react",
            post(add_reaction).delete(remove_reaction),
        )
        .route("/chats/:id/export", get(export_chat))
        .route("/search", get(search_chats))
        .route("/usage", get(get_usage))
        .route("/me", get(get_me))
        .route("/me/key", post(update_nim_key))
        .route("/me/key/validate", get(validate_nim_key))
        .route("/me/memory", post(toggle_memory))
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

    Ok(Json(json!({
        "id": user.id,
        "email": user.email,
        "role": user.role,
        "has_nim_key": user.encrypted_nim_key.is_some(),
        "has_provider": provider_count > 0,
        "provider_count": provider_count,
        "memory_enabled": user.memory_enabled == 1,
        "tools_enabled": user.tools_enabled == 1,
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

async fn update_nim_key(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Json(req): Json<crate::models::UpdateNimKeyRequest>,
) -> Result<StatusCode, StatusCode> {
    if req.api_key.len() > MAX_API_KEY_LENGTH {
        return Err(StatusCode::BAD_REQUEST);
    }

    // Legacy endpoint: map to a "nvidia" provider for backward compatibility
    let trimmed = req.api_key.trim();
    if trimmed.is_empty() {
        // Remove legacy key and delete nvidia provider
        sqlx::query("UPDATE users SET encrypted_nim_key = NULL WHERE id = ?1")
            .bind(&claims.sub)
            .execute(&state.db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let _ =
            sqlx::query("DELETE FROM providers WHERE user_id = ?1 AND provider_type = 'nvidia'")
                .bind(&claims.sub)
                .execute(&state.db)
                .await;
    } else {
        let encrypted = crate::auth::encrypt_key(trimmed, &state.config.master_key)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        // Update legacy field too
        sqlx::query("UPDATE users SET encrypted_nim_key = ?1 WHERE id = ?2")
            .bind(&encrypted)
            .bind(&claims.sub)
            .execute(&state.db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        // Upsert nvidia provider
        let existing: Option<(String,)> = sqlx::query_as(
            "SELECT id FROM providers WHERE user_id = ?1 AND provider_type = 'nvidia' LIMIT 1",
        )
        .bind(&claims.sub)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        if let Some((id,)) = existing {
            sqlx::query("UPDATE providers SET encrypted_api_key = ?1, updated_at = datetime('now') WHERE id = ?2")
                .bind(&encrypted)
                .bind(&id)
                .execute(&state.db)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        } else {
            sqlx::query("INSERT INTO providers (user_id, name, provider_type, base_url, encrypted_api_key) VALUES (?1, 'NVIDIA NIM', 'nvidia', ?2, ?3)")
                .bind(&claims.sub)
                .bind(&state.config.nim_base_url)
                .bind(&encrypted)
                .execute(&state.db)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        }
    }

    Ok(StatusCode::OK)
}

async fn validate_nim_key(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    // Legacy endpoint: validate the user's nvidia provider or legacy nim key
    let provider: Option<Provider> = sqlx::query_as(
        "SELECT * FROM providers WHERE user_id = ?1 AND provider_type = 'nvidia' LIMIT 1",
    )
    .bind(&claims.sub)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let (base_url, api_key) = if let Some(p) = provider {
        let key = decrypt_key(&p.encrypted_api_key, &state.config.master_key)
            .map_err(|_| StatusCode::BAD_REQUEST)?;
        (p.base_url, key)
    } else {
        let user: User = sqlx::query_as("SELECT * FROM users WHERE id = ?1")
            .bind(&claims.sub)
            .fetch_one(&state.db)
            .await
            .map_err(|_| StatusCode::NOT_FOUND)?;
        let nim_key = match user.encrypted_nim_key {
            Some(enc) => {
                decrypt_key(&enc, &state.config.master_key).map_err(|_| StatusCode::BAD_REQUEST)?
            }
            None => {
                return Ok(Json(
                    json!({"valid": false, "error": "No API key configured"}),
                ))
            }
        };
        (state.config.nim_base_url.clone(), nim_key)
    };

    let test_res = state
        .http_client
        .get(format!("{}/models", base_url))
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await;

    match test_res {
        Ok(res) => {
            let status = res.status();
            if status.is_success() {
                Ok(Json(json!({"valid": true, "status": status.as_u16()})))
            } else {
                let body = res.text().await.unwrap_or_default();
                tracing::error!("NIM key validation failed: {} - {}", status, body);
                Ok(Json(json!({
                    "valid": false,
                    "status": status.as_u16(),
                    "error": format!("NIM API returned {}", status)
                })))
            }
        }
        Err(e) => {
            tracing::error!("NIM key validation request failed: {}", e);
            Ok(Json(json!({
                "valid": false,
                "error": format!("Connection failed: {}", e)
            })))
        }
    }
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

    let messages: Vec<Message> =
        sqlx::query_as("SELECT * FROM messages WHERE chat_id = ?1 ORDER BY created_at ASC")
            .bind(id.clone())
            .fetch_all(&state.db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(json!({
        "chat": chat,
        "messages": messages,
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

async fn edit_message(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path((chat_id, msg_id)): Path<(String, String)>,
    Json(req): Json<crate::models::EditMessageRequest>,
) -> Result<StatusCode, StatusCode> {
    let content = req.content.trim();
    if content.is_empty() || content.len() > MAX_MESSAGE_LENGTH {
        return Err(StatusCode::BAD_REQUEST);
    }

    let result = sqlx::query(
        "UPDATE messages SET content = ?1 WHERE id = ?2 AND chat_id = ?3 AND role = 'user' AND EXISTS (SELECT 1 FROM chats WHERE id = ?3 AND user_id = ?4)"
    )
    .bind(content)
    .bind(&msg_id)
    .bind(&chat_id)
    .bind(&claims.sub)
    .execute(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Edit message error: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    if result.rows_affected() == 0 {
        return Err(StatusCode::NOT_FOUND);
    }

    Ok(StatusCode::OK)
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
                let mut file_contents = Vec::new();
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
                            if let Some(extracted_text) = file.extracted_text {
                                file_contents.push(format!(
                                    "[File: {}]\n```\n{}\n```",
                                    file.filename,
                                    extracted_text
                                ));
                            } else {
                                file_contents.push(format!("[File: {}]", file.filename));
                            }
                        }
                    }
                }
                if !file_contents.is_empty() {
                    if !msg.content.is_empty() {
                        msg.content = format!("{}\n\n{}", file_contents.join("\n\n"), msg.content);
                    } else {
                        msg.content = file_contents.join("\n\n");
                    }
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

    let resolved = resolve_chat_provider(&state, &chat, &user).await?;

    let is_regenerate = req.is_regenerate.unwrap_or(false);
    let attachments_json = req.attachments.as_ref().map(|a| serde_json::to_string(a).unwrap_or_default());
    if !is_regenerate {
        sqlx::query("INSERT INTO messages (chat_id, role, content, attachments) VALUES (?1, 'user', ?2, ?3)")
            .bind(id.clone())
            .bind(content)
            .bind(attachments_json.as_deref())
            .execute(&state.db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    } else {
        // Optionally, we could delete the last assistant message here if we want to be thorough,
        // but the frontend will also call DELETE on the specific message it wants to replace.
        // It's safer to rely on the frontend deleting the exact message and its descendants.
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
        sqlx::query_as("SELECT * FROM messages WHERE chat_id = ?1 ORDER BY created_at ASC")
            .bind(id.clone())
            .fetch_all(&state.db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Resolve file attachments for AI context
    resolve_message_attachments(&state.db, &mut history).await;

    let connected_integrations: Vec<(String,)> = sqlx::query_as(
        "SELECT provider FROM integration_credentials WHERE user_id = ?1 AND provider IN ('google', 'todoist')"
    )
    .bind(&claims.sub)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();
    let has_google = connected_integrations
        .iter()
        .any(|(provider,)| provider == "google");
    let has_todoist = connected_integrations
        .iter()
        .any(|(provider,)| provider == "todoist");
    let mut system_prompt = build_dynamic_system_prompt(has_google, has_todoist);

    // ─── Memory / Summarization Logic ───
    let memory_enabled = user.memory_enabled == 1;
    if memory_enabled {
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
    let needs_summarization =
        memory_enabled && history.len() > MEMORY_SUMMARIZE_THRESHOLD + MEMORY_RECENT_WINDOW;

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

            // While summary generates, return a lightweight placeholder
            "(Generating summary of earlier conversation...)".to_string()
        };

        build_messages_payload(&system_prompt, Some(&summary_text), recent)
    } else {
        build_messages_payload(&system_prompt, None, &history)
    };

    let should_use_tools = std::env::var("DISABLE_TOOLS").is_err() && user.tools_enabled == 1;

    let (tx, rx) = mpsc::channel::<String>(64);

    let db = state.db.clone();
    let chat_id = id.clone();
    let model = chat.model_id.clone();
    let provider = resolved.id.clone();
    let url = resolved.base_url.clone();
    let key = resolved.api_key.clone();
    let max_steps = user.max_agent_steps as usize;
    let state_clone = state.clone();
    let user_id = claims.sub.clone();

    tokio::spawn(async move {
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
                tx: &tx,
            })
            .await;
            return;
        }

        let mut current_messages = messages_payload;
        let tools = build_tools_def();
        let mut total_steps = 0;

        loop {
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
            let _ = sqlx::query(
                "INSERT INTO messages (chat_id, role, content, tool_call_id, tool_name) VALUES (?1, 'assistant', ?2, ?3, ?4)"
            )
            .bind(&chat_id)
            .bind(asst_content)
            .bind(&asst_tool_calls_str)
            .bind("tool_calls_init")
            .execute(&db)
            .await;

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
                let _ = tx.send(format!("[TOOL]{}[/TOOL]", event_obj)).await;

                persist_tool_message(&db, &chat_id, tool_id, tool_name, tool_result).await;

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
            tx: &tx,
        })
        .await;
    });

    let sse_stream = tokio_stream::wrappers::ReceiverStream::new(rx)
        .map(|text| Ok::<_, Infallible>(axum::response::sse::Event::default().data(text)));

    Ok(Sse::new(sse_stream))
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
    tx: &'a mpsc::Sender<String>,
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
        tx,
    } = ctx;
    let body = json!({"model": model_id, "messages": messages, "stream": true, "max_tokens": 2048});

    let provider_response = state
        .http_client
        .post(format!("{}/chat/completions", base_url))
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await;

    let mut stream_opt = None;

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
                let _ = tx.send(user_msg).await;
                let _ = tx.send("[DONE]".to_string()).await;
            } else {
                stream_opt = Some(res.bytes_stream());
            }
        }
        Err(e) => {
            tracing::error!("Provider request error: {}", e);
            let _ = tx.send("[ERR]Failed to connect to AI provider. Please check your internet connection and API key.[/ERR]".to_string()).await;
            let _ = tx.send("[DONE]".to_string()).await;
        }
    }

    if let Some(mut stream) = stream_opt {
        let mut buffer = String::new();
        let mut full_content = String::new();
        let chat_id = chat_id.to_string();
        let provider_id = provider_id.to_string();
        let model_id = model_id.to_string();
        let db = db.clone();

        while let Some(chunk_result) = stream.next().await {
            match chunk_result {
                Ok(bytes) => {
                    buffer.push_str(&String::from_utf8_lossy(&bytes));
                    if buffer.len() > MAX_MESSAGE_LENGTH * 2 {
                        tracing::error!("SSE buffer exceeded max size, aborting stream");
                        break;
                    }
                    while let Some(pos) = buffer.find("\n\n") {
                        let frame = buffer[..pos].to_string();
                        buffer = buffer[pos + 2..].to_string();
                        for line in frame.lines() {
                            if let Some(data) = line.strip_prefix("data: ") {
                                if data == "[DONE]" {
                                    let _ = tx.send("[DONE]".to_string()).await;
                                    let estimated_tokens = (full_content.len() / 4) as i32;
                                    if let Err(e) = sqlx::query("INSERT INTO messages (chat_id, role, content, tokens_used, provider_id, model_id) VALUES (?1, 'assistant', ?2, ?3, ?4, ?5)")
                                        .bind(&chat_id).bind(&full_content).bind(estimated_tokens).bind(&provider_id).bind(&model_id)
                                        .execute(&db).await {
                                        tracing::error!("Failed to persist assistant message: {}", e);
                                    }
                                    return;
                                }
                                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data)
                                {
                                    if let Some(content) =
                                        parsed["choices"][0]["delta"]["content"].as_str()
                                    {
                                        full_content.push_str(content);
                                        let _ = tx.send(content.to_string()).await;
                                        if full_content.len() > MAX_MESSAGE_LENGTH {
                                            tracing::error!(
                                                "Full content exceeded max size, aborting stream"
                                            );
                                            let _ = tx.send("[DONE]".to_string()).await;
                                            let estimated_tokens = (full_content.len() / 4) as i32;
                                            let _ = sqlx::query("INSERT INTO messages (chat_id, role, content, tokens_used, provider_id, model_id) VALUES (?1, 'assistant', ?2, ?3, ?4, ?5)")
                                                .bind(&chat_id).bind(&full_content).bind(estimated_tokens).bind(&provider_id).bind(&model_id)
                                                .execute(&db).await;
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
                    break;
                }
            }
        }

        let _ = tx.send("[DONE]".to_string()).await;
        if !full_content.is_empty() {
            if let Err(e) = sqlx::query("INSERT INTO messages (chat_id, role, content, tokens_used, provider_id, model_id) VALUES (?1, 'assistant', ?2, ?3, ?4, ?5)")
                .bind(&chat_id).bind(&full_content).bind(full_content.len() as i32 / 4).bind(&provider_id).bind(&model_id)
                .execute(&db).await {
                tracing::error!("Failed to persist assistant message: {}", e);
            }
        }
    } else {
        let _ = tx.send("[DONE]".to_string()).await;
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
) -> Result<Json<serde_json::Value>, StatusCode> {
    let totals: (i64, Option<i64>) = sqlx::query_as(
        "SELECT COUNT(*), SUM(tokens_used) FROM messages m 
         JOIN chats c ON m.chat_id = c.id WHERE c.user_id = ?1 AND m.role = 'assistant'",
    )
    .bind(&claims.sub)
    .fetch_one(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let daily: Vec<(String, i64, Option<i64>)> = sqlx::query_as(
        "SELECT date(m.created_at) as day, COUNT(*), SUM(m.tokens_used)
         FROM messages m JOIN chats c ON m.chat_id = c.id
         WHERE c.user_id = ?1 AND m.role = 'assistant' AND date(m.created_at) >= date('now', '-6 days')
         GROUP BY day ORDER BY day"
    )
    .bind(&claims.sub)
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let daily_stats: Vec<_> = daily.into_iter().map(|(day, count, tokens)| {
        json!({ "date": day, "messages": count, "tokens": tokens.unwrap_or(0) })
    }).collect();

    Ok(Json(json!({
        "total_messages": totals.0,
        "total_tokens": totals.1.unwrap_or(0),
        "daily": daily_stats,
    })))
}
