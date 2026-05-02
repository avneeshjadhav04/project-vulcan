use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{Json, Sse},
    routing::{get, post},
    Router,
};
use futures::stream::StreamExt;
use serde_json::json;
use std::convert::Infallible;
use tokio::sync::mpsc;
use crate::{
    auth::decrypt_key,
    middleware::AppState,
    models::{Chat, Claims, CreateChatRequest, Message, RenameChatRequest, SendMessageRequest, User},
};

const MAX_MESSAGE_LENGTH: usize = 100_000;
const MAX_TITLE_LENGTH: usize = 255;
const MAX_API_KEY_LENGTH: usize = 512;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/chats", post(create_chat).get(list_chats))
        .route("/chats/:id", get(get_chat).patch(rename_chat).delete(delete_chat))
        .route("/chats/:id/message", post(send_message))
        .route("/me", get(get_me))
        .route("/me/key", post(update_nim_key))
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

    let encrypted = crate::auth::encrypt_key(&req.api_key, &state.config.master_key)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    sqlx::query("UPDATE users SET encrypted_nim_key = ?1 WHERE id = ?2")
        .bind(&encrypted)
        .bind(claims.sub.clone())
        .execute(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(StatusCode::OK)
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
    Json(req): Json<RenameChatRequest>,
) -> Result<Json<Chat>, StatusCode> {
    let title = req.title.trim();
    if title.is_empty() || title.len() > MAX_TITLE_LENGTH {
        return Err(StatusCode::BAD_REQUEST);
    }

    let chat: Chat = sqlx::query_as(
        "UPDATE chats SET title = ?1 WHERE id = ?2 AND user_id = ?3 RETURNING *"
    )
    .bind(title)
    .bind(id)
    .bind(claims.sub.clone())
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Rename chat error: {}", e);
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

    // Update chat's updated_at timestamp
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
        messages_payload.push(json!({
            "role": msg.role,
            "content": msg.content,
        }));
    }

    // Try tool call first (non-streaming) — gracefully fallback on any error
    let should_use_tools = std::env::var("DISABLE_TOOLS").is_err();

    if should_use_tools {
        let tools = json!([
            {
                "type": "function",
                "function": {
                    "name": "execute_terminal_command",
                    "description": "Execute a shell command in a sandboxed terminal environment. Use this when the user asks you to run code, check system status, list files, or perform any terminal operation.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "command": {
                                "type": "string",
                                "description": "The shell command to execute, e.g. 'ls -la', 'python3 script.py', 'cat file.txt'"
                            }
                        },
                        "required": ["command"]
                    }
                }
            }
        ]);

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
                                                    
                                                    let sandbox_url = std::env::var("SANDBOX_URL")
                                                        .unwrap_or_else(|_| "http://127.0.0.1:8081".to_string())
                                                        .replace("ws://", "http://")
                                                        .replace("/execute", "");
                                                    
                                                    let exec_res = state.http_client
                                                        .post(format!("{}/run", sandbox_url))
                                                        .json(&json!({"command": cmd}))
                                                        .send()
                                                        .await;

                                                    let tool_result = match exec_res {
                                                        Ok(r) => {
                                                            if let Ok(body) = r.json::<serde_json::Value>().await {
                                                                json!({
                                                                    "stdout": body["stdout"].as_str().unwrap_or(""),
                                                                    "stderr": body["stderr"].as_str().unwrap_or(""),
                                                                    "status": body["status"].as_str().unwrap_or("error"),
                                                                    "code": body["code"].as_i64().unwrap_or(-1),
                                                                })
                                                            } else {
                                                                json!({"stdout": "", "stderr": "Failed to parse sandbox response", "status": "error", "code": -1})
                                                            }
                                                        }
                                                        Err(e) => {
                                                            tracing::warn!("Sandbox execution failed, streaming without tool result: {}", e);
                                                            // Don't fail — stream normally and let AI know sandbox is unavailable
                                                            let mut tool_messages = messages_payload.clone();
                                                            tool_messages.push(json!({
                                                                "role": "assistant",
                                                                "content": null,
                                                                "tool_calls": [{
                                                                    "id": call["id"].as_str().unwrap_or("call_1"),
                                                                    "type": "function",
                                                                    "function": {
                                                                        "name": "execute_terminal_command",
                                                                        "arguments": args_str
                                                                    }
                                                                }]
                                                            }));
                                                            tool_messages.push(json!({
                                                                "role": "tool",
                                                                "tool_call_id": call["id"].as_str().unwrap_or("call_1"),
                                                                "content": "Sandbox is currently unavailable. Please inform the user that terminal execution is not available at this time.",
                                                            }));
                                                            let db = state.db.clone();
                                                            return stream_final_response(
                                                                state, nim_key, chat.model_id, tool_messages,
                                                                id, db, Some(cmd.to_string()), json!({"status": "unavailable"}),
                                                            ).await;
                                                        }
                                                    };

                                                    // Build messages with tool call and result
                                                    let mut tool_messages = messages_payload.clone();
                                                    tool_messages.push(json!({
                                                        "role": "assistant",
                                                        "content": null,
                                                        "tool_calls": [{
                                                            "id": call["id"].as_str().unwrap_or("call_1"),
                                                            "type": "function",
                                                            "function": {
                                                                "name": "execute_terminal_command",
                                                                "arguments": args_str
                                                            }
                                                        }]
                                                    }));
                                                    tool_messages.push(json!({
                                                        "role": "tool",
                                                        "tool_call_id": call["id"].as_str().unwrap_or("call_1"),
                                                        "content": serde_json::to_string(&tool_result).unwrap_or_default(),
                                                    }));

                                                    let db = state.db.clone();
                                                    return stream_final_response(
                                                        state, nim_key, chat.model_id, tool_messages,
                                                        id, db, Some(cmd.to_string()), tool_result.clone(),
                                                    ).await;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    } else {
                        tracing::warn!("Failed to parse tool response JSON, falling back to normal streaming");
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

    // No tool call or tool call failed — stream as normal
    let db = state.db.clone();
    stream_final_response(
        state, nim_key, chat.model_id, messages_payload,
        id, db, None, json!({}),
    ).await
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
    let body = json!({
        "model": model_id,
        "messages": messages,
        "stream": true,
        "max_tokens": 2048,
    });

    let res = state.http_client
        .post(format!("{}/chat/completions", state.config.nim_base_url))
        .header("Authorization", format!("Bearer {}", nim_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            tracing::error!("NIM request error: {}", e);
            StatusCode::BAD_GATEWAY
        })?;

    if !res.status().is_success() {
        let status = res.status();
        let body_text = res.text().await.unwrap_or_default();
        tracing::error!("NIM returned error status: {} body: {}", status, body_text);
        return Err(StatusCode::BAD_GATEWAY);
    }

    let mut stream = res.bytes_stream();
    let (tx, rx) = mpsc::channel::<String>(64);

    tokio::spawn(async move {
        // Send tool execution info first if applicable
        if let Some(cmd) = tool_command {
            let tool_event = serde_json::json!({
                "t": "tool",
                "command": cmd,
                "stdout": tool_result["stdout"].as_str().unwrap_or(""),
                "stderr": tool_result["stderr"].as_str().unwrap_or(""),
                "status": tool_result["status"].as_str().unwrap_or("error"),
            });
            let _ = tx.send(tool_event.to_string()).await;
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
                        let _ = tx.send(serde_json::json!({"t": "error"}).to_string()).await;
                        break;
                    }
                    while let Some(pos) = buffer.find("\n\n") {
                        let frame = buffer[..pos].to_string();
                        buffer = buffer[pos + 2..].to_string();

                        for line in frame.lines() {
                            if line.starts_with("data: ") {
                                let data = &line[6..];
                                if data == "[DONE]" {
                                    let _ = tx.send(serde_json::json!({"t": "done"}).to_string()).await;
                                    if let Err(e) = sqlx::query(
                                        "INSERT INTO messages (chat_id, role, content) VALUES (?1, 'assistant', ?2)"
                                    )
                                    .bind(chat_id.clone())
                                    .bind(&full_content)
                                    .execute(&db)
                                    .await {
                                        tracing::error!("Failed to persist assistant message: {}", e);
                                    }
                                    return;
                                }
                                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data) {
                                    if let Some(content) = parsed["choices"][0]["delta"]["content"].as_str() {
                                        full_content.push_str(content);
                                        let _ = tx.send(serde_json::json!({"t": "text", "d": content}).to_string()).await;
                                    }
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    tracing::error!("Stream chunk error: {}", e);
                    let _ = tx.send(serde_json::json!({"t": "error"}).to_string()).await;
                    break;
                }
            }
        }

        if !full_content.is_empty() {
            if let Err(e) = sqlx::query(
                "INSERT INTO messages (chat_id, role, content) VALUES (?1, 'assistant', ?2)"
            )
            .bind(chat_id)
            .bind(&full_content)
            .execute(&db)
            .await {
                tracing::error!("Failed to persist assistant message: {}", e);
            }
        }
    });

    let sse_stream = tokio_stream::wrappers::ReceiverStream::new(rx).map(|text| {
        Ok::<_, Infallible>(axum::response::sse::Event::default().data(text))
    });

    Ok(Sse::new(sse_stream))
}
