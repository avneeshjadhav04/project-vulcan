use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct User {
    pub id: String,
    pub email: String,
    #[serde(skip_serializing)]
    pub password_hash: String,
    #[serde(skip_serializing)]
    pub encrypted_nim_key: Option<String>,
    pub role: String,
    pub memory_enabled: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Chat {
    pub id: String,
    pub user_id: String,
    pub title: String,
    pub model_id: String,
    pub folder: String,
    pub tags: String,
    pub is_pinned: i32,
    pub is_archived: i32,
    pub summary: Option<String>,
    pub summary_updated_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Message {
    pub id: String,
    pub chat_id: String,
    pub role: String,
    pub content: String,
    pub tokens_used: Option<i32>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct TerminalSession {
    pub id: String,
    pub user_id: Option<String>,
    pub command: String,
    pub status: String,
    pub stdout: Option<String>,
    pub stderr: Option<String>,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NimModel {
    pub id: String,
    pub object: String,
    pub created: i64,
    pub owned_by: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub email: String,
    pub role: String,
    pub exp: usize,
    pub iss: String,
    pub aud: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SignupRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateChatRequest {
    pub title: Option<String>,
    pub model_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SendMessageRequest {
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateNimKeyRequest {
    pub api_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct FileRecord {
    pub id: String,
    pub chat_id: String,
    pub message_id: Option<String>,
    pub user_id: String,
    pub filename: String,
    pub mime_type: String,
    pub size_bytes: i64,
    pub storage_path: String,
    pub extracted_text: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateChatOrganizationRequest {
    pub title: Option<String>,
    pub folder: Option<String>,
    pub tags: Option<Vec<String>>,
    pub is_pinned: Option<bool>,
    pub is_archived: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EditMessageRequest {
    pub content: String,
}
