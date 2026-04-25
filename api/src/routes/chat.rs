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
    models::{Chat, Claims, CreateChatRequest, Message, SendMessageRequest, User},
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/chats", post(create_chat).get(list_chats))
        .route("/chats/:id", get(get_chat))
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
) -> Result<Json<Chat>, StatusCode> {
    let title = req.title.unwrap_or_else(|| "New Chat".to_string());

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

    Ok(Json(chat))
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

async fn send_message(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path(id): Path<String>,
    Json(req): Json<SendMessageRequest>,
) -> Result<Sse<impl futures::Stream<Item = Result<axum::response::sse::Event, Infallible>>>, StatusCode> {
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
        .bind(&req.content)
        .execute(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

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

    let body = json!({
        "model": chat.model_id,
        "messages": messages_payload,
        "stream": true,
        "max_tokens": 2048,
    });

    let client = reqwest::Client::new();
    let res = client
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

    let mut stream = res.bytes_stream();
    let db = state.db.clone();
    let chat_id = id;

    let (tx, rx) = mpsc::unbounded_channel::<String>();

    tokio::spawn(async move {
        let mut buffer = String::new();
        let mut full_content = String::new();

        while let Some(chunk_result) = stream.next().await {
            match chunk_result {
                Ok(bytes) => {
                    buffer.push_str(&String::from_utf8_lossy(&bytes));
                    while let Some(pos) = buffer.find("\n\n") {
                        let frame = buffer[..pos].to_string();
                        buffer = buffer[pos + 2..].to_string();

                        for line in frame.lines() {
                            if line.starts_with("data: ") {
                                let data = &line[6..];
                                if data == "[DONE]" {
                                    let _ = tx.send("[DONE]".to_string());
                                    let _ = sqlx::query(
                                        "INSERT INTO messages (chat_id, role, content) VALUES (?1, 'assistant', ?2)"
                                    )
                                    .bind(chat_id.clone())
                                    .bind(&full_content)
                                    .execute(&db)
                                    .await;
                                    return;
                                }
                                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data) {
                                    if let Some(content) = parsed["choices"][0]["delta"]["content"].as_str() {
                                        full_content.push_str(content);
                                        let _ = tx.send(content.to_string());
                                    }
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    tracing::error!("Stream chunk error: {}", e);
                    let _ = tx.send("[ERROR]".to_string());
                    break;
                }
            }
        }

        if !full_content.is_empty() {
            let _ = sqlx::query(
                "INSERT INTO messages (chat_id, role, content) VALUES (?1, 'assistant', ?2)"
            )
            .bind(chat_id)
            .bind(&full_content)
            .execute(&db)
            .await;
        }
    });

    let sse_stream = tokio_stream::wrappers::UnboundedReceiverStream::new(rx).map(|text| {
        Ok::<_, Infallible>(axum::response::sse::Event::default().data(text))
    });

    Ok(Sse::new(sse_stream))
}
