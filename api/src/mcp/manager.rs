use std::collections::HashMap;
use std::sync::Arc;

use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{FromRow, SqlitePool};
use tokio::sync::Mutex;

use crate::auth::{decrypt_key, encrypt_key};
use crate::mcp::protocol::{CallToolResult, McpTool};

use super::client::{McpClient, McpClientHandle};
use super::transport::{StdioTransport, SseTransport};

/// Stored configuration for an MCP server. Mirrors the `mcp_servers` table.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct McpServerConfig {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub enabled: i32,
    pub auto_start: i32,
    pub transport: String,
    pub command: Option<String>,
    pub args: Option<String>,
    pub url: Option<String>,
    pub env: Option<String>,
    pub headers: Option<String>,
    pub default_permission_level: String,
    pub created_at: String,
    pub updated_at: String,
}

impl McpServerConfig {
    pub fn is_enabled(&self) -> bool {
        self.enabled == 1
    }

    pub fn auto_start(&self) -> bool {
        self.auto_start == 1
    }

    /// Decrypt and parse env vars JSON into a Vec.
    pub fn env_vars(&self, master_key: &[u8; 32]) -> Result<Vec<(String, String)>> {
        let mut out = Vec::new();
        if let Some(encrypted) = &self.env {
            let plain = decrypt_key(encrypted, master_key)?;
            let map: HashMap<String, String> = serde_json::from_str(&plain)?;
            out.extend(map.into_iter());
        }
        Ok(out)
    }

    /// Decrypt and parse headers JSON into a Vec.
    pub fn headers(&self, master_key: &[u8; 32]) -> Result<Vec<(String, String)>> {
        let mut out = Vec::new();
        if let Some(encrypted) = &self.headers {
            let plain = decrypt_key(encrypted, master_key)?;
            let map: HashMap<String, String> = serde_json::from_str(&plain)?;
            out.extend(map.into_iter());
        }
        Ok(out)
    }

    pub fn args(&self) -> Result<Vec<String>> {
        match &self.args {
            Some(s) if !s.is_empty() => Ok(serde_json::from_str(s)?),
            _ => Ok(Vec::new()),
        }
    }
}

/// State of a managed MCP server process.
pub struct McpServerState {
    pub config: McpServerConfig,
    pub client: McpClientHandle,
    pub last_error: Option<String>,
}

/// Per-user registry of MCP server states.
type UserServerMap = HashMap<String, McpServerState>;

/// Manages all active MCP server connections across users.
#[derive(Clone)]
pub struct McpManager {
    http_client: reqwest::Client,
    master_key: [u8; 32],
    /// user_id -> server_id -> state
    servers: Arc<Mutex<HashMap<String, UserServerMap>>>,
}

impl McpManager {
    pub fn new(http_client: reqwest::Client, master_key: [u8; 32]) -> Self {
        Self {
            http_client,
            master_key,
            servers: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Load all enabled auto-start servers for a user and connect them.
    pub async fn load_user_servers(
        &self,
        db: &SqlitePool,
        user_id: &str,
    ) -> Result<()> {
        let configs: Vec<McpServerConfig> = sqlx::query_as::<_, McpServerConfig>(
            "SELECT * FROM mcp_servers WHERE user_id = ?1 AND enabled = 1 AND auto_start = 1",
        )
        .bind(user_id)
        .fetch_all(db)
        .await
        .context("Failed to load MCP server configs")?;

        for config in configs {
            let _ = self.connect(db, config).await;
        }

        Ok(())
    }

    /// Connect to a specific MCP server from its stored config.
    pub async fn connect(
        &self,
        db: &SqlitePool,
        config: McpServerConfig,
    ) -> Result<McpClientHandle> {
        // Disconnect any existing connection for this server first.
        self.disconnect(&config.user_id, &config.id).await;

        let client = match config.transport.as_str() {
            "stdio" => {
                let command = config
                    .command
                    .as_ref()
                    .ok_or_else(|| anyhow!("stdio transport requires a command"))?;
                let args = config.args()?;
                let env = config.env_vars(&self.master_key)?;
                let transport = StdioTransport::new(command, args, env).await?;
                McpClient::new(Box::new(transport))
            }
            "sse" => {
                let url = config
                    .url
                    .as_ref()
                    .ok_or_else(|| anyhow!("sse transport requires a url"))?;
                let headers = config.headers(&self.master_key)?;
                let transport = SseTransport::new(url, headers, self.http_client.clone()).await?;
                McpClient::new(Box::new(transport))
            }
            other => bail!("Unsupported MCP transport: {}", other),
        };

        let handle = McpClientHandle::new(client);
        let init_result = handle
            .with_client(|client| {
                Box::pin(async move {
                    client
                        .initialize("vulcan", env!("CARGO_PKG_VERSION"))
                        .await
                })
            })
            .await;

        if let Err(e) = init_result {
            handle.close().await;
            return Err(e);
        }

        // Seed discovered tools into the mcp_tools table.
        let tools: Vec<McpTool> = match handle
            .with_client(|client| Box::pin(async move { client.list_tools().await }))
            .await
        {
            Ok(tools) => tools,
            Err(e) => {
                handle.close().await;
                return Err(e);
            }
        };

        if let Err(e) = self.seed_tools(db, &config, &tools).await {
            tracing::warn!("Failed to seed MCP tools for server {}: {}", config.id, e);
        }

        let state = McpServerState {
            config: config.clone(),
            client: handle.clone(),
            last_error: None,
        };

        {
            let mut servers = self.servers.lock().await;
            servers
                .entry(config.user_id.clone())
                .or_insert_with(HashMap::new)
                .insert(config.id.clone(), state);
        }

        Ok(handle)
    }

    /// Disconnect a specific server for a user.
    pub async fn disconnect(&self,
        user_id: &str,
        server_id: &str,
    ) {
        let maybe_client = {
            let mut servers = self.servers.lock().await;
            servers
                .get_mut(user_id)
                .and_then(|user_servers| user_servers.remove(server_id))
                .map(|state| state.client)
        };
        if let Some(client) = maybe_client {
            client.close().await;
        }
    }

    /// Disconnect every server for a user.
    pub async fn disconnect_user(&self,
        user_id: &str,
    ) {
        let clients: Vec<_> = {
            let mut servers = self.servers.lock().await;
            servers
                .remove(user_id)
                .map(|user_servers| {
                    user_servers
                        .into_values()
                        .map(|state| state.client)
                        .collect()
                })
                .unwrap_or_default()
        };
        for client in clients {
            client.close().await;
        }
    }

    /// List currently connected server ids for a user.
    pub async fn connected_server_ids(
        &self,
        user_id: &str,
    ) -> Vec<String> {
        let servers = self.servers.lock().await;
        servers
            .get(user_id)
            .map(|user_servers| {
                user_servers
                    .keys()
                    .cloned()
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Check whether a specific MCP server is currently connected for a user.
    pub async fn is_connected(&self, user_id: &str, server_id: &str) -> bool {
        self.servers.lock().await
            .get(user_id)
            .and_then(|m| m.get(server_id))
            .is_some()
    }

    /// Call a namespaced tool for a user. The tool name must be `{server_id}__{tool_name}`.
    pub async fn call_tool(
        &self,
        user_id: &str,
        namespaced_tool: &str,
        arguments: Value,
    ) -> Result<Value> {
        let (server_id, tool_name) = namespaced_tool
            .split_once("__")
            .ok_or_else(|| anyhow!("Invalid namespaced MCP tool name: {}", namespaced_tool))?;

        let client = {
            let servers = self.servers.lock().await;
            servers
                .get(user_id)
                .and_then(|user_servers| user_servers.get(server_id))
                .map(|state| state.client.clone())
                .ok_or_else(|| {
                    anyhow!(
                        "MCP server {} is not connected for user {}",
                        server_id,
                        user_id
                    )
                })?
        };

        let tool_name_owned = tool_name.to_string();
        let args_for_closure = arguments.clone();
        let result: CallToolResult = client
            .with_client(move |client| {
                let tool_name = tool_name_owned.clone();
                let arguments = args_for_closure.clone();
                Box::pin(async move { client.call_tool(&tool_name, arguments).await })
            })
            .await?;

        // Convert CallToolResult into a plain JSON value for downstream use.
        let text_parts: Vec<String> = result
            .content
            .iter()
            .filter_map(|c| c.text().map(|s| s.to_string()))
            .collect();

        Ok(json!({
            "is_error": result.is_error(),
            "text": text_parts,
            "content": result.content,
        }))
    }

    /// Return true if the tool name is namespaced and belongs to a connected MCP server.
    pub async fn is_mcp_tool(
        &self,
        user_id: &str,
        namespaced_tool: &str,
    ) -> bool {
        let Some((server_id, _)) = namespaced_tool.split_once("__") else {
            return false;
        };
        let servers = self.servers.lock().await;
        servers
            .get(user_id)
            .and_then(|user_servers| user_servers.get(server_id))
            .is_some()
    }

    /// Seed discovered tools into the mcp_tools table and ensure tool_permissions rows exist.
    async fn seed_tools(
        &self,
        db: &SqlitePool,
        config: &McpServerConfig,
        tools: &[McpTool],
    ) -> Result<()> {
        let mut tx = db.begin().await?;

        for tool in tools {
            let description = tool.description.clone().unwrap_or_default();
            let schema = tool.schema().cloned().unwrap_or_else(|| json!({}));
            let namespaced = format!("{}__{}", config.id, tool.name);

            sqlx::query(
                r#"
                INSERT INTO mcp_tools (user_id, server_id, tool_name, namespaced_name, description, schema)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                ON CONFLICT(user_id, server_id, tool_name) DO UPDATE SET
                    description = excluded.description,
                    schema = excluded.schema,
                    namespaced_name = excluded.namespaced_name,
                    updated_at = datetime('now')
                "#,
            )
            .bind(&config.user_id)
            .bind(&config.id)
            .bind(&tool.name)
            .bind(&namespaced)
            .bind(&description)
            .bind(schema.to_string())
            .execute(&mut *tx)
            .await?;

            // Ensure a permission row exists, defaulting to server default.
            sqlx::query(
                r#"
                INSERT INTO tool_permissions (user_id, tool_name, permission_level)
                VALUES (?1, ?2, ?3)
                ON CONFLICT(user_id, tool_name) DO NOTHING
                "#,
            )
            .bind(&config.user_id)
            .bind(&namespaced)
            .bind(&config.default_permission_level)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;
        Ok(())
    }
}

/// Helper to encrypt a JSON object for storage in mcp_servers.env / headers.
pub fn encrypt_json_blob(
    value: &Value,
    master_key: &[u8; 32],
) -> Result<String> {
    let plain = serde_json::to_string(value)?;
    encrypt_key(&plain, master_key)
}

/// Helper to decrypt a stored JSON blob.
pub fn decrypt_json_blob(
    ciphertext: &str,
    master_key: &[u8; 32],
) -> Result<Value> {
    let plain = decrypt_key(ciphertext, master_key)?;
    Ok(serde_json::from_str(&plain)?)
}
