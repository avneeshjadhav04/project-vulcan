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
use crate::{
    auth::decrypt_key,
    middleware::AppState,
    models::{Chat, Claims, CreateChatRequest, Message, SendMessageRequest, UpdateChatOrganizationRequest, User},
};

const MAX_MESSAGE_LENGTH: usize = 100_000;
const MAX_TITLE_LENGTH: usize = 255;
const MAX_API_KEY_LENGTH: usize = 512;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/chats", post(create_chat).get(list_chats))
        .route("/chats/:id", get(get_chat).patch(rename_chat).delete(delete_chat))
        .route("/chats/:id/message", post(send_message))
        .route("/chats/:id/messages/:msg_id", patch(edit_message))
        .route("/chats/:id/messages/:msg_id/after", delete(delete_messages_after))
        .route("/chats/:id/messages/:msg_id/react", post(add_reaction).delete(remove_reaction))
        .route("/chats/:id/agent", post(agent_workflow))
        .route("/chats/:id/export", get(export_chat))
        .route("/search", get(search_chats))
        .route("/usage", get(get_usage))
        .route("/me", get(get_me))
        .route("/me/key", post(update_nim_key))
        .route("/me/key/validate", get(validate_nim_key))
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

    Ok(Json(json!({
        "id": user.id,
        "email": user.email,
        "role": user.role,
        "has_nim_key": user.encrypted_nim_key.is_some(),
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

    // Treat empty string as a removal (set to NULL)
    let encrypted: Option<String> = if req.api_key.trim().is_empty() {
        None
    } else {
        Some(crate::auth::encrypt_key(&req.api_key, &state.config.master_key)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?)
    };

    sqlx::query("UPDATE users SET encrypted_nim_key = ?1 WHERE id = ?2")
        .bind(encrypted)
        .bind(claims.sub.clone())
        .execute(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(StatusCode::OK)
}

async fn validate_nim_key(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let user: User = sqlx::query_as("SELECT * FROM users WHERE id = ?1")
        .bind(claims.sub.clone())
        .fetch_one(&state.db)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;

    let nim_key = match user.encrypted_nim_key {
        Some(enc) => decrypt_key(&enc, &state.config.master_key).map_err(|_| StatusCode::BAD_REQUEST)?,
        None => return Ok(Json(json!({"valid": false, "error": "No API key configured"}))),
    };

    let test_res = state.http_client
        .get(format!("{}/models", state.config.nim_base_url))
        .header("Authorization", format!("Bearer {}", nim_key))
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

    let chat: Chat = sqlx::query_as(
        "INSERT INTO chats (user_id, title, model_id) VALUES (?1, ?2, ?3) RETURNING *"
    )
    .bind(claims.sub.clone())
    .bind(&title)
    .bind(&req.model_id)
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
    let chats: Vec<Chat> = sqlx::query_as(
        "SELECT * FROM chats WHERE user_id = ?1 ORDER BY updated_at DESC"
    )
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

    let messages: Vec<Message> = sqlx::query_as(
        "SELECT * FROM messages WHERE chat_id = ?1 ORDER BY created_at ASC"
    )
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

    let tags_json = req.tags.map(|t| serde_json::to_string(&t).unwrap_or_else(|_| "[]".to_string()));

    let chat: Chat = sqlx::query_as(
        "UPDATE chats SET
            title = COALESCE(?1, title),
            folder = COALESCE(?2, folder),
            tags = COALESCE(?3, tags),
            is_pinned = COALESCE(?4, is_pinned),
            is_archived = COALESCE(?5, is_archived),
            updated_at = datetime('now')
         WHERE id = ?6 AND user_id = ?7
         RETURNING *"
    )
    .bind(req.title.as_deref())
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
    .bind(&content)
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

    let messages: Vec<Message> = sqlx::query_as(
        "SELECT * FROM messages WHERE chat_id = ?1 ORDER BY created_at ASC"
    )
    .bind(id.clone())
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let format = params.get("format").map(|s| s.as_str()).unwrap_or("markdown");

    let (content, content_type, filename) = match format {
        "json" => {
            let data = json!({"chat": chat, "messages": messages});
            (data.to_string(), "application/json", format!("{}.json", chat.title))
        }
        _ => {
            let mut md = format!("# {}\n\n", chat.title);
            md.push_str(&format!("Model: {}\n", chat.model_id));
            md.push_str(&format!("Created: {}\n\n", chat.created_at));
            md.push_str("---\n\n");
            for msg in messages {
                let role_label = if msg.role == "assistant" { "Carbon AI" } else { "User" };
                md.push_str(&format!("## {}\n\n{}", role_label, msg.content));
                if msg.tokens_used.is_some() {
                    md.push_str(&format!("\n\n*Tokens: {}*", msg.tokens_used.unwrap()));
                }
                md.push_str("\n\n---\n\n");
            }
            (md, "text/markdown", format!("{}.md", chat.title))
        }
    };

    let mut headers = axum::http::HeaderMap::new();
    headers.insert(axum::http::header::CONTENT_TYPE, content_type.parse().unwrap());
    headers.insert(
        axum::http::header::CONTENT_DISPOSITION,
        format!("attachment; filename=\"{}\"", filename.replace('"', "\\\"")).parse().unwrap(),
    );

    Ok((headers, content))
}

async fn send_message(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path(id): Path<String>,
    Json(req): Json<SendMessageRequest>,
) -> Result<Sse<impl futures::Stream<Item = Result<axum::response::sse::Event, Infallible>>>, StatusCode> {
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

    let nim_key = match user.encrypted_nim_key {
        Some(enc) => decrypt_key(&enc, &state.config.master_key).map_err(|_| StatusCode::BAD_REQUEST)?,
        None => return Err(StatusCode::PRECONDITION_FAILED),
    };

    let chat: Chat = sqlx::query_as("SELECT * FROM chats WHERE id = ?1 AND user_id = ?2")
        .bind(id.clone())
        .bind(claims.sub.clone())
        .fetch_one(&state.db)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;

    sqlx::query("INSERT INTO messages (chat_id, role, content) VALUES (?1, 'user', ?2)")
        .bind(id.clone())
        .bind(&content)
        .execute(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let _ = sqlx::query("UPDATE chats SET updated_at = datetime('now') WHERE id = ?1")
        .bind(id.clone())
        .execute(&state.db)
        .await;

    let history: Vec<Message> = sqlx::query_as(
        "SELECT * FROM messages WHERE chat_id = ?1 ORDER BY created_at ASC"
    )
    .bind(id.clone())
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let mut messages_payload = vec![json!({
        "role": "system",
        "content": "You are a helpful AI assistant running on a personal SaaS platform. You can execute sandboxed terminal commands when the user asks you to run code or system operations."
    })];

    for msg in &history {
        messages_payload.push(json!({"role": msg.role, "content": msg.content}));
    }

    let should_use_tools = std::env::var("DISABLE_TOOLS").is_err();

    if should_use_tools {
        let tools = json!([{
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
        }]);

        let tool_body = json!({
            "model": chat.model_id,
            "messages": messages_payload.clone(),
            "tools": tools,
            "tool_choice": "auto",
            "max_tokens": 2048,
        });

        match state.http_client
            .post(format!("{}/chat/completions", state.config.nim_base_url))
            .header("Authorization", format!("Bearer {}", nim_key))
            .header("Content-Type", "application/json")
            .json(&tool_body)
            .send()
            .await
        {
            Ok(tool_res) => {
                if tool_res.status().is_success() {
                    if let Ok(tool_data) = tool_res.json::<serde_json::Value>().await {
                        if let Some(calls) = tool_data["choices"][0]["message"]["tool_calls"].as_array() {
                            if !calls.is_empty() {
                                if let Some(call) = calls.first() {
                                    if let Some(func) = call["function"].as_object() {
                                        let name = func["name"].as_str().unwrap_or("");
                                        let args_str = func["arguments"].as_str().unwrap_or("{}");
                                        if name == "execute_terminal_command" {
                                            if let Ok(args) = serde_json::from_str::<serde_json::Value>(args_str) {
                                                if let Some(cmd) = args["command"].as_str() {
                                                    tracing::info!("AI executing command: {}", cmd);
                                                    let exec_res = crate::sandbox_engine::run_command_http(cmd, &state.sandbox).await;
                                                    let tool_result = match exec_res {
                                                        Ok(resp) => {
                                                            json!({"stdout": resp.stdout, "stderr": resp.stderr, "status": resp.status, "code": resp.code})
                                                        }
                                                        Err(_e) => {
                                                            let mut tool_messages = messages_payload.clone();
                                                            tool_messages.push(json!({"role": "assistant", "content": null, "tool_calls": [{"id": call["id"].as_str().unwrap_or("call_1"), "type": "function", "function": {"name": "execute_terminal_command", "arguments": args_str}}]}));
                                                            tool_messages.push(json!({"role": "tool", "tool_call_id": call["id"].as_str().unwrap_or("call_1"), "content": "Sandbox is currently unavailable. Please inform the user that terminal execution is not available at this time."}));
                                                            let db = state.db.clone();
                                                            return stream_final_response(state, nim_key, chat.model_id, tool_messages, id, db, Some(cmd.to_string()), json!({"status": "unavailable"})).await;
                                                        }
                                                    };
                                                    let mut tool_messages = messages_payload.clone();
                                                    tool_messages.push(json!({"role": "assistant", "content": null, "tool_calls": [{"id": call["id"].as_str().unwrap_or("call_1"), "type": "function", "function": {"name": "execute_terminal_command", "arguments": args_str}}]}));
                                                    tool_messages.push(json!({"role": "tool", "tool_call_id": call["id"].as_str().unwrap_or("call_1"), "content": serde_json::to_string(&tool_result).unwrap_or_default()}));
                                                    let db = state.db.clone();
                                                    return stream_final_response(state, nim_key, chat.model_id, tool_messages, id, db, Some(cmd.to_string()), tool_result.clone()).await;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                } else {
                    let status = tool_res.status();
                    let body_text = tool_res.text().await.unwrap_or_default();
                    tracing::warn!("NIM tool request returned non-success status: {} body: {}. Falling back to normal streaming.", status, body_text);
                }
            }
            Err(e) => {
                tracing::warn!("NIM tool request failed: {}. Falling back to normal streaming.", e);
            }
        }
    }

    let db = state.db.clone();
    stream_final_response(state, nim_key, chat.model_id, messages_payload, id, db, None, json!({})).await
}

async fn stream_final_response(
    state: AppState,
    nim_key: String,
    model_id: String,
    messages: Vec<serde_json::Value>,
    chat_id: String,
    db: sqlx::SqlitePool,
    tool_command: Option<String>,
    tool_result: serde_json::Value,
) -> Result<Sse<impl futures::Stream<Item = Result<axum::response::sse::Event, Infallible>>>, StatusCode> {
    let body = json!({"model": model_id, "messages": messages, "stream": true, "max_tokens": 2048});
    let (tx, rx) = mpsc::channel::<String>(64);

    let nim_response = state.http_client
        .post(format!("{}/chat/completions", state.config.nim_base_url))
        .header("Authorization", format!("Bearer {}", nim_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await;

    let mut stream_opt = None;

    match nim_response {
        Ok(res) => {
            if !res.status().is_success() {
                let status = res.status();
                let body_text = res.text().await.unwrap_or_default();
                tracing::error!("NIM returned error status: {} body: {} model={}", status, body_text, model_id);
                let user_msg = if status == 404 {
                    let models_res = state.http_client
                        .get(format!("{}/models", state.config.nim_base_url))
                        .header("Authorization", format!("Bearer {}", nim_key))
                        .send()
                        .await;
                    let suggestion = match models_res {
                        Ok(mres) if mres.status().is_success() => {
                            if let Ok(data) = mres.json::<serde_json::Value>().await {
                                data["data"].as_array().and_then(|arr| arr.first()).and_then(|m| m["id"].as_str()).map(|s| s.to_string())
                            } else { None }
                        }
                        _ => None
                    };
                    let base_msg = format!("[ERR]Model '{}' not found (404). The model may be unavailable or your API key doesn't have access to it.", model_id);
                    if let Some(suggested) = suggestion {
                        format!("{} Try using '{}' instead, or select a different model from the dropdown.[/ERR]", base_msg, suggested)
                    } else {
                        format!("{} Try selecting a different model from the dropdown.[/ERR]", base_msg)
                    }
                } else if status == 401 {
                    "[ERR]Invalid API key (401). Please check your NVIDIA NIM API key in Settings.[/ERR]".to_string()
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
            tracing::error!("NIM request error: {}", e);
            let _ = tx.send("[ERR]Failed to connect to AI provider. Please check your internet connection and API key.[/ERR]".to_string()).await;
            let _ = tx.send("[DONE]".to_string()).await;
        }
    }

    if let Some(mut stream) = stream_opt {
        tokio::spawn(async move {
            if let Some(cmd) = tool_command {
                let tool_json = serde_json::json!({"command": cmd, "stdout": tool_result["stdout"].as_str().unwrap_or(""), "stderr": tool_result["stderr"].as_str().unwrap_or(""), "status": tool_result["status"].as_str().unwrap_or("error")});
                let _ = tx.send(format!("[TOOL]{}[/TOOL]", tool_json.to_string())).await;
            }

            let mut buffer = String::new();
            let mut full_content = String::new();
            const MAX_BUFFER_SIZE: usize = MAX_MESSAGE_LENGTH * 2;

            while let Some(chunk_result) = stream.next().await {
                match chunk_result {
                    Ok(bytes) => {
                        buffer.push_str(&String::from_utf8_lossy(&bytes));
                        if buffer.len() > MAX_BUFFER_SIZE {
                            tracing::error!("SSE buffer exceeded max size, aborting stream");
                            break;
                        }
                        while let Some(pos) = buffer.find("\n\n") {
                            let frame = buffer[..pos].to_string();
                            buffer = buffer[pos + 2..].to_string();
                            for line in frame.lines() {
                                if line.starts_with("data: ") {
                                    let data = &line[6..];
                                    if data == "[DONE]" {
                                        let _ = tx.send("[DONE]".to_string()).await;
                                        let estimated_tokens = (full_content.len() / 4) as i32;
                                        if let Err(e) = sqlx::query("INSERT INTO messages (chat_id, role, content, tokens_used) VALUES (?1, 'assistant', ?2, ?3)")
                                            .bind(chat_id.clone()).bind(&full_content).bind(estimated_tokens)
                                            .execute(&db).await {
                                            tracing::error!("Failed to persist assistant message: {}", e);
                                        }
                                        return;
                                    }
                                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data) {
                                        if let Some(content) = parsed["choices"][0]["delta"]["content"].as_str() {
                                            full_content.push_str(content);
                                            let _ = tx.send(content.to_string()).await;
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
                let estimated_tokens = (full_content.len() / 4) as i32;
                if let Err(e) = sqlx::query("INSERT INTO messages (chat_id, role, content, tokens_used) VALUES (?1, 'assistant', ?2, ?3)")
                    .bind(chat_id).bind(&full_content).bind(estimated_tokens)
                    .execute(&db).await {
                    tracing::error!("Failed to persist assistant message: {}", e);
                }
            }
        });
    }

    let sse_stream = tokio_stream::wrappers::ReceiverStream::new(rx).map(|text| {
        Ok::<_, Infallible>(axum::response::sse::Event::default().data(text))
    });

    Ok(Sse::new(sse_stream))
}

// ─── Agent Workflow ───
async fn agent_workflow(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path(id): Path<String>,
    Json(req): Json<SendMessageRequest>,
) -> Result<Sse<impl futures::Stream<Item = Result<axum::response::sse::Event, Infallible>>>, StatusCode> {
    let content = req.content.trim().to_string();
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

    let nim_key = match user.encrypted_nim_key {
        Some(enc) => decrypt_key(&enc, &state.config.master_key).map_err(|_| StatusCode::BAD_REQUEST)?,
        None => return Err(StatusCode::PRECONDITION_FAILED),
    };

    let chat: Chat = sqlx::query_as("SELECT * FROM chats WHERE id = ?1 AND user_id = ?2")
        .bind(id.clone())
        .bind(claims.sub.clone())
        .fetch_one(&state.db)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;

    sqlx::query("INSERT INTO messages (chat_id, role, content) VALUES (?1, 'user', ?2)")
        .bind(id.clone())
        .bind(&content)
        .execute(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let _ = sqlx::query("UPDATE chats SET updated_at = datetime('now') WHERE id = ?1")
        .bind(id.clone())
        .execute(&state.db)
        .await;

    let (tx, rx) = mpsc::channel::<String>(64);

    let state_clone = state.clone();
    let nim_key_clone = nim_key.clone();
    let chat_id = id.clone();
    let model_id = chat.model_id.clone();

    tokio::spawn(async move {
        let _ = tx.send("[AGENT]Starting agent workflow...[/AGENT]".to_string()).await;
        let mut messages_payload = vec![
            json!({"role": "system", "content": "You are an autonomous agent. You can execute terminal commands to accomplish tasks. When given a task, break it down into steps. For each step, you may use the execute_terminal_command tool to run commands. After each command, analyze the output and decide the next step. Continue until the task is complete. Be concise."}),
            json!({"role": "user", "content": &content}),
        ];

        let max_steps = 5;
        let mut full_response = String::new();

        for step in 0..max_steps {
            let _ = tx.send(format!("[AGENT]Step {}: Planning...[/AGENT]", step + 1)).await;

            let tools = json!([{
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
            }]);

            let body = json!({"model": model_id, "messages": messages_payload.clone(), "tools": tools, "tool_choice": "auto", "max_tokens": 2048});

            let res = state_clone.http_client
                .post(format!("{}/chat/completions", state_clone.config.nim_base_url))
                .header("Authorization", format!("Bearer {}", nim_key_clone))
                .header("Content-Type", "application/json")
                .json(&body)
                .send()
                .await;

            match res {
                Ok(r) => {
                    if !r.status().is_success() {
                        let _ = tx.send(format!("[ERR]AI provider error: {}[/ERR]", r.status())).await;
                        break;
                    }
                    match r.json::<serde_json::Value>().await {
                        Ok(data) => {
                            let msg = &data["choices"][0]["message"];
                            if let Some(calls) = msg["tool_calls"].as_array() {
                                if !calls.is_empty() {
                                    if let Some(call) = calls.first() {
                                        if let Some(func) = call["function"].as_object() {
                                            let name = func["name"].as_str().unwrap_or("");
                                            let args_str = func["arguments"].as_str().unwrap_or("{}");
                                            if name == "execute_terminal_command" {
                                                if let Ok(args) = serde_json::from_str::<serde_json::Value>(args_str) {
                                                    if let Some(cmd) = args["command"].as_str() {
                                                        let _ = tx.send(format!("[AGENT]Executing: {}[/AGENT]", cmd)).await;
                                                        let exec_res = crate::sandbox_engine::run_command_http(cmd, &state_clone.sandbox).await;
                                                        let tool_result = match exec_res {
                                                            Ok(resp) => {
                                                                let _ = tx.send(format!("[TOOL]{}", serde_json::json!({"command": cmd, "stdout": resp.stdout, "stderr": resp.stderr, "status": resp.status}).to_string())).await;
                                                                serde_json::json!({"stdout": resp.stdout, "stderr": resp.stderr, "status": resp.status, "code": resp.code})
                                                            }
                            Err(e) => {
                                                                let _ = tx.send(format!("[ERR]Command failed: {}[/ERR]", e)).await;
                                                                break;
                                                            }
                                                        };
                                                        messages_payload.push(json!({"role": "assistant", "content": null, "tool_calls": [{"id": call["id"].as_str().unwrap_or("call_1"), "type": "function", "function": {"name": name, "arguments": args_str}}]}));
                                                        messages_payload.push(json!({"role": "tool", "tool_call_id": call["id"].as_str().unwrap_or("call_1"), "content": serde_json::to_string(&tool_result).unwrap_or_default()}));
                                                        continue;
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            let resp_content = msg["content"].as_str().unwrap_or("").to_string();
                            full_response.push_str(&resp_content);
                            let _ = tx.send(resp_content).await;
                            break;
                        }
                        Err(e) => {
                            let _ = tx.send(format!("[ERR]Failed to parse response: {}[/ERR]", e)).await;
                            break;
                        }
                    }
                }
                Err(e) => {
                    let _ = tx.send(format!("[ERR]Request failed: {}[/ERR]", e)).await;
                    break;
                }
            }
        }

        let _ = tx.send("[DONE]".to_string()).await;
        if !full_response.is_empty() {
            let _ = sqlx::query("INSERT INTO messages (chat_id, role, content) VALUES (?1, 'assistant', ?2)")
                .bind(&chat_id).bind(&full_response)
                .execute(&state_clone.db).await;
        }
    });

    let sse_stream = tokio_stream::wrappers::ReceiverStream::new(rx).map(|text| {
        Ok::<_, Infallible>(axum::response::sse::Event::default().data(text))
    });

    Ok(Sse::new(sse_stream))
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
         WHERE m.id = ?1 AND c.id = ?4 AND c.user_id = ?2"
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
            let _ = sqlx::query("UPDATE message_reactions SET reaction = ?1 WHERE message_id = ?2 AND user_id = ?3")
                .bind(&reaction).bind(&msg_id).bind(&claims.sub)
                .execute(&state.db).await;
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
    let result = sqlx::query("DELETE FROM message_reactions WHERE message_id = ?1 AND user_id = ?2")
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
         ORDER BY m.created_at DESC LIMIT 20"
    )
    .bind(&q)
    .bind(&claims.sub)
    .fetch_all(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let chat_results: Vec<_> = chats.into_iter().map(|(id, title)| {
        json!({ "id": id, "title": title, "type": "chat" })
    }).collect();

    let message_results: Vec<_> = messages.into_iter().map(|(id, chat_id, content, chat_title)| {
        let preview = if content.len() > 120 { format!("{}...", &content[..120]) } else { content };
        json!({ "id": id, "chat_id": chat_id, "preview": preview, "chat_title": chat_title, "type": "message" })
    }).collect();

    Ok(Json(json!({ "chats": chat_results, "messages": message_results })))
}

// ─── Usage Stats ───

async fn get_usage(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let totals: (i64, Option<i64>) = sqlx::query_as(
        "SELECT COUNT(*), SUM(tokens_used) FROM messages m 
         JOIN chats c ON m.chat_id = c.id WHERE c.user_id = ?1 AND m.role = 'assistant'"
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
