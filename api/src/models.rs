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
    pub tools_enabled: i32,
    pub max_agent_steps: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Chat {
    pub id: String,
    pub user_id: String,
    pub title: String,
    pub model_id: String,
    pub provider_id: Option<String>,
    pub folder: String,
    pub tags: String,
    pub is_pinned: i32,
    pub is_archived: i32,
    pub summary: Option<String>,
    pub summary_updated_at: Option<DateTime<Utc>>,
    pub agent_plan: Option<String>,
    pub agent_step: i32,
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
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
    pub tool_call_id: Option<String>,
    pub tool_name: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Provider {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub provider_type: String,
    pub base_url: String,
    #[serde(skip_serializing)]
    pub encrypted_api_key: String,
    pub is_active: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderResponse {
    pub id: String,
    pub name: String,
    pub provider_type: String,
    pub base_url: String,
    pub is_active: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateProviderRequest {
    pub name: String,
    pub provider_type: String,
    pub base_url: String,
    pub api_key: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateProviderRequest {
    pub api_key: Option<String>,
    pub is_active: Option<bool>,
}

#[allow(dead_code)]
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
    pub provider_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SendMessageRequest {
    pub content: String,
    pub is_regenerate: Option<bool>,
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
    pub model_id: Option<String>,
    pub provider_id: Option<String>,
    pub folder: Option<String>,
    pub tags: Option<Vec<String>>,
    pub is_pinned: Option<bool>,
    pub is_archived: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EditMessageRequest {
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateToolsConfigRequest {
    pub tools_enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct IntegrationCredential {
    pub id: String,
    pub user_id: String,
    pub provider: String,
    #[serde(skip_serializing)]
    pub encrypted_access_token: String,
    #[serde(skip_serializing)]
    pub encrypted_refresh_token: Option<String>,
    pub expires_at: Option<String>,
    pub scopes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct IntegrationInfo {
    pub provider: String,
    pub connected: bool,
    pub scopes: Option<String>,
    pub expires_at: Option<String>,
}
