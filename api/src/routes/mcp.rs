use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
    routing::{get, post, put},
    Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::{
    auth::decrypt_key,
    middleware::AppState,
    models::Claims,
    mcp::manager::{encrypt_json_blob, McpServerConfig},
};

/// Request payload to create or update an MCP server configuration.
#[derive(Debug, Deserialize)]
pub struct UpsertMcpServerRequest {
    pub name: String,
    pub enabled: bool,
    pub auto_start: bool,
    pub transport: String, // "stdio" or "sse"
    pub command: Option<String>,
    pub args: Option<String>, // JSON array string
    pub url: Option<String>,
    pub env: Option<Value>,     // plain JSON object; encrypted before storage
    pub headers: Option<Value>, // plain JSON object; encrypted before storage
    pub default_permission_level: String,
}

/// Response payload for listing servers. Secrets are omitted.
#[derive(Debug, Serialize)]
pub struct McpServerResponse {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub enabled: bool,
    pub auto_start: bool,
    pub transport: String,
    pub command: Option<String>,
    pub args: Option<String>,
    pub url: Option<String>,
    pub env_keys: Vec<String>,    // env var keys only
    pub header_keys: Vec<String>, // header keys only
    pub default_permission_level: String,
    pub created_at: String,
    pub updated_at: String,
}

/// Public status of an MCP server connection.
#[derive(Debug, Serialize)]
pub struct McpServerStatus {
    pub connected: bool,
    pub tools: usize,
    pub last_error: Option<String>,
}

impl McpServerResponse {
    pub fn from_config(
        config: &McpServerConfig,
        master_key: &[u8; 32],
    ) -> Self {
        let env_keys = config
            .env
            .as_ref()
            .and_then(|enc| decrypt_key(enc, master_key).ok())
            .and_then(|plain| serde_json::from_str::<Value>(&plain).ok())
            .map(|v| {
                v.as_object()
                    .map(|m| m.keys().cloned().collect())
                    .unwrap_or_default()
            })
            .unwrap_or_default();

        let header_keys = config
            .headers
            .as_ref()
            .and_then(|enc| decrypt_key(enc, master_key).ok())
            .and_then(|plain| serde_json::from_str::<Value>(&plain).ok())
            .map(|v| {
                v.as_object()
                    .map(|m| m.keys().cloned().collect())
                    .unwrap_or_default()
            })
            .unwrap_or_default();

        Self {
            id: config.id.clone(),
            user_id: config.user_id.clone(),
            name: config.name.clone(),
            enabled: config.enabled == 1,
            auto_start: config.auto_start == 1,
            transport: config.transport.clone(),
            command: config.command.clone(),
            args: config.args.clone(),
            url: config.url.clone(),
            env_keys,
            header_keys,
            default_permission_level: config.default_permission_level.clone(),
            created_at: config.created_at.clone(),
            updated_at: config.updated_at.clone(),
        }
    }
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/mcp/servers", get(list_servers).post(create_server))
        .route(
            "/mcp/servers/{id}",
            get(get_server).put(update_server).delete(delete_server),
        )
        .route("/mcp/servers/{id}/connect", post(connect_server))
        .route("/mcp/servers/{id}/disconnect", post(disconnect_server))
        .route("/mcp/servers/{id}/test", post(test_server))
        .route(
            "/mcp/servers/{id}/default-permission",
            put(update_default_permission),
        )
}

async fn list_servers(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
) -> Result<Json<Vec<McpServerResponse>>, StatusCode> {
    let configs: Vec<McpServerConfig> = sqlx::query_as::<_, McpServerConfig>(
        "SELECT * FROM mcp_servers WHERE user_id = ?1 ORDER BY name",
    )
    .bind(&claims.sub)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to list MCP servers: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let responses: Vec<_> = configs
        .iter()
        .map(|c| McpServerResponse::from_config(c, &state.config.master_key))
        .collect();

    Ok(Json(responses))
}

async fn get_server(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path(id): Path<String>,
) -> Result<Json<McpServerResponse>, (StatusCode, String)> {
    let config: Option<McpServerConfig> = sqlx::query_as::<_, McpServerConfig>(
        "SELECT * FROM mcp_servers WHERE id = ?1 AND user_id = ?2",
    )
    .bind(&id)
    .bind(&claims.sub)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to fetch MCP server: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, "Database error".to_string())
    })?;

    let config = config.ok_or((StatusCode::NOT_FOUND, "Server not found".to_string()))?;
    Ok(Json(McpServerResponse::from_config(
        &config,
        &state.config.master_key,
    )))
}

async fn create_server(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Json(payload): Json<UpsertMcpServerRequest>,
) -> Result<Json<McpServerResponse>, (StatusCode, String)> {
    validate_transport(&payload).map_err(|e| (StatusCode::BAD_REQUEST, e))?;
    validate_permission_level(&payload.default_permission_level)
        .map_err(|e| (StatusCode::BAD_REQUEST, e))?;

    let env_encrypted = encrypt_optional_blob(
        payload.env.as_ref(),
        &state.config.master_key,
    )
    .map_err(|e| (StatusCode::BAD_REQUEST, format!("Failed to encrypt env: {}", e)))?;

    let headers_encrypted = encrypt_optional_blob(
        payload.headers.as_ref(),
        &state.config.master_key,
    )
    .map_err(|e| (StatusCode::BAD_REQUEST, format!("Failed to encrypt headers: {}", e)))?;

    let config: McpServerConfig = sqlx::query_as::<_, McpServerConfig>(
        r#"
        INSERT INTO mcp_servers
            (user_id, name, enabled, auto_start, transport, command, args, url, env, headers, default_permission_level)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        RETURNING *
        "#,
    )
    .bind(&claims.sub)
    .bind(&payload.name)
    .bind(i32::from(payload.enabled))
    .bind(i32::from(payload.auto_start))
    .bind(&payload.transport)
    .bind(payload.command.as_ref())
    .bind(payload.args.as_ref())
    .bind(payload.url.as_ref())
    .bind(env_encrypted.as_deref())
    .bind(headers_encrypted.as_deref())
    .bind(&payload.default_permission_level)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to create MCP server: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to create server".to_string(),
        )
    })?;

    Ok(Json(McpServerResponse::from_config(
        &config,
        &state.config.master_key,
    )))
}

async fn update_server(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path(id): Path<String>,
    Json(payload): Json<UpsertMcpServerRequest>,
) -> Result<Json<McpServerResponse>, (StatusCode, String)> {
    validate_transport(&payload).map_err(|e| (StatusCode::BAD_REQUEST, e))?;
    validate_permission_level(&payload.default_permission_level)
        .map_err(|e| (StatusCode::BAD_REQUEST, e))?;

    // Verify ownership before updating.
    let existing: Option<McpServerConfig> = sqlx::query_as::<_, McpServerConfig>(
        "SELECT * FROM mcp_servers WHERE id = ?1 AND user_id = ?2",
    )
    .bind(&id)
    .bind(&claims.sub)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to fetch MCP server for update: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, "Database error".to_string())
    })?;

    let _existing =
        existing.ok_or((StatusCode::NOT_FOUND, "Server not found".to_string()))?;

    let env_encrypted = encrypt_optional_blob(
        payload.env.as_ref(),
        &state.config.master_key,
    )
    .map_err(|e| (StatusCode::BAD_REQUEST, format!("Failed to encrypt env: {}", e)))?;

    let headers_encrypted = encrypt_optional_blob(
        payload.headers.as_ref(),
        &state.config.master_key,
    )
    .map_err(|e| (StatusCode::BAD_REQUEST, format!("Failed to encrypt headers: {}", e)))?;

    let config: McpServerConfig = sqlx::query_as::<_, McpServerConfig>(
        r#"
        UPDATE mcp_servers SET
            name = ?1,
            enabled = ?2,
            auto_start = ?3,
            transport = ?4,
            command = ?5,
            args = ?6,
            url = ?7,
            env = ?8,
            headers = ?9,
            default_permission_level = ?10,
            updated_at = datetime('now')
        WHERE id = ?11 AND user_id = ?12
        RETURNING *
        "#,
    )
    .bind(&payload.name)
    .bind(i32::from(payload.enabled))
    .bind(i32::from(payload.auto_start))
    .bind(&payload.transport)
    .bind(payload.command.as_ref())
    .bind(payload.args.as_ref())
    .bind(payload.url.as_ref())
    .bind(env_encrypted.as_deref())
    .bind(headers_encrypted.as_deref())
    .bind(&payload.default_permission_level)
    .bind(&id)
    .bind(&claims.sub)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to update MCP server: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to update server".to_string(),
        )
    })?;

    // If the server is currently connected, disconnect it so it reconnects with new config.
    state.mcp_manager.disconnect(&claims.sub, &id).await;

    Ok(Json(McpServerResponse::from_config(
        &config,
        &state.config.master_key,
    )))
}

async fn delete_server(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    state.mcp_manager.disconnect(&claims.sub, &id).await;

    let result = sqlx::query(
        "DELETE FROM mcp_servers WHERE id = ?1 AND user_id = ?2",
    )
    .bind(&id)
    .bind(&claims.sub)
    .execute(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to delete MCP server: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Database error".to_string(),
        )
    })?;

    if result.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, "Server not found".to_string()));
    }

    Ok(StatusCode::NO_CONTENT)
}

async fn connect_server(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path(id): Path<String>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let config: Option<McpServerConfig> = sqlx::query_as::<_, McpServerConfig>(
        "SELECT * FROM mcp_servers WHERE id = ?1 AND user_id = ?2 AND enabled = 1",
    )
    .bind(&id)
    .bind(&claims.sub)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to fetch MCP server for connect: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, "Database error".to_string())
    })?;

    let config =
        config.ok_or((StatusCode::NOT_FOUND, "Server not found or disabled".to_string()))?;

    match state.mcp_manager.connect(&state.db, config).await {
        Ok(_) => Ok(Json(json!({ "status": "connected" }))),
        Err(e) => {
            tracing::warn!("MCP server {} connect failed: {}", id, e);
            Err((
                StatusCode::BAD_GATEWAY,
                format!("Failed to connect MCP server: {}", e),
            ))
        }
    }
}

async fn disconnect_server(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path(id): Path<String>,
) -> Result<Json<Value>, StatusCode> {
    state.mcp_manager.disconnect(&claims.sub, &id).await;
    Ok(Json(json!({ "status": "disconnected" })))
}

async fn test_server(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path(id): Path<String>,
) -> Result<Json<Value>, (StatusCode, String)> {
    // Reuse connect logic; a successful connect implies the server is reachable.
    let config: Option<McpServerConfig> = sqlx::query_as::<_, McpServerConfig>(
        "SELECT * FROM mcp_servers WHERE id = ?1 AND user_id = ?2 AND enabled = 1",
    )
    .bind(&id)
    .bind(&claims.sub)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to fetch MCP server for test: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, "Database error".to_string())
    })?;

    let config =
        config.ok_or((StatusCode::NOT_FOUND, "Server not found or disabled".to_string()))?;

    match state.mcp_manager.connect(&state.db, config).await {
        Ok(handle) => {
            let info = handle
                .with_client(|client| {
                    Box::pin(async move {
                        Ok(client
                            .server_info()
                            .cloned()
                            .map(|i| json!({ "name": i.name, "version": i.version }))
                            .unwrap_or_else(|| json!({ "name": "unknown", "version": "unknown" })))
                    })
                })
                .await
                .unwrap_or_else(|_| json!({ "name": "unknown" }));

            Ok(Json(json!({
                "status": "ok",
                "server_info": info,
            })))
        }
        Err(e) => Err((
            StatusCode::BAD_GATEWAY,
            format!("Failed to connect MCP server: {}", e),
        )),
    }
}

#[derive(Debug, Deserialize)]
pub struct UpdateDefaultPermissionRequest {
    pub default_permission_level: String,
}

async fn update_default_permission(
    State(state): State<AppState>,
    claims: axum::Extension<Claims>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateDefaultPermissionRequest>,
) -> Result<Json<McpServerResponse>, (StatusCode, String)> {
    validate_permission_level(&payload.default_permission_level,
    )
    .map_err(|e| (StatusCode::BAD_REQUEST, e))?;

    let config: McpServerConfig = sqlx::query_as::<_, McpServerConfig>(
        r#"
        UPDATE mcp_servers SET
            default_permission_level = ?1,
            updated_at = datetime('now')
        WHERE id = ?2 AND user_id = ?3
        RETURNING *
        "#,
    )
    .bind(&payload.default_permission_level)
    .bind(&id)
    .bind(&claims.sub)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to update MCP default permission: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Database error".to_string(),
        )
    })?;

    Ok(Json(McpServerResponse::from_config(
        &config,
        &state.config.master_key,
    )))
}

fn validate_transport(payload: &UpsertMcpServerRequest) -> Result<(), String> {
    match payload.transport.as_str() {
        "stdio" => {
            if payload.command.as_ref().map(|s| s.is_empty()).unwrap_or(true) {
                return Err("stdio transport requires a non-empty command".to_string());
            }
        }
        "sse" => {
            if payload.url.as_ref().map(|s| s.is_empty()).unwrap_or(true) {
                return Err("sse transport requires a non-empty url".to_string());
            }
        }
        other => return Err(format!("Unsupported transport: {}", other)),
    }
    Ok(())
}

fn validate_permission_level(level: &str) -> Result<(), String> {
    if matches!(level, "auto" | "ask" | "deny") {
        Ok(())
    } else {
        Err(format!(
            "Invalid default_permission_level: {}. Must be 'auto', 'ask', or 'deny'.",
            level
        ))
    }
}

fn encrypt_optional_blob(
    value: Option<&Value>,
    master_key: &[u8; 32],
) -> anyhow::Result<Option<String>> {
    match value {
        Some(v) if !v.is_null() => Ok(Some(encrypt_json_blob(v, master_key)?)),
        _ => Ok(None),
    }
}
