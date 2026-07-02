use std::sync::Arc;

use anyhow::{anyhow, bail, Context, Result};
use serde_json::{json, Value};
use tokio::sync::{Mutex, RwLock};

use super::protocol::*;
use super::transport::McpTransport;

/// Shared atomic request id counter.
type RequestId = Arc<Mutex<u64>>;

/// An active MCP client session.
pub struct McpClient {
    transport: Box<dyn McpTransport>,
    request_id: RequestId,
    server_info: Option<Implementation>,
    capabilities: ServerCapabilities,
}

impl McpClient {
    pub fn new(transport: Box<dyn McpTransport>) -> Self {
        Self {
            transport,
            request_id: Arc::new(Mutex::new(1)),
            server_info: None,
            capabilities: ServerCapabilities::default(),
        }
    }

    /// Perform the MCP initialize handshake and return server info.
    pub async fn initialize(&mut self,
        client_name: &str,
        client_version: &str,
    ) -> Result<InitializeResult> {
        let init_request = InitializeRequest {
            protocol_version: "2024-11-05".to_string(),
            capabilities: ClientCapabilities::default(),
            client_info: Implementation {
                name: client_name.to_string(),
                version: client_version.to_string(),
            },
        };

        let response = self
            .call("initialize", serde_json::to_value(init_request)?)
            .await?;

        let result: InitializeResult = serde_json::from_value(
            response
                .get("result")
                .cloned()
                .unwrap_or_else(|| json!({})),
        )
        .context("Invalid initialize result from MCP server")?;

        self.server_info = Some(result.server_info.clone());
        self.capabilities = result.capabilities.clone();

        // Send initialized notification.
        let _ = self.notify("notifications/initialized", json!({})).await;

        Ok(result)
    }

    /// List tools exposed by the server.
    pub async fn list_tools(&mut self) -> Result<Vec<McpTool>> {
        if self.server_info.is_none() {
            bail!("MCP client not initialized");
        }
        if self.capabilities.tools.is_none() {
            return Ok(Vec::new());
        }

        let response = self.call("tools/list", json!({})).await?;
        let result: ListToolsResult = serde_json::from_value(
            response
                .get("result")
                .cloned()
                .unwrap_or_else(|| json!({"tools": []})),
        )
        .context("Invalid tools/list result")?;

        Ok(result.tools)
    }

    /// Call a tool on the server.
    pub async fn call_tool(
        &mut self,
        tool_name: &str,
        arguments: Value,
    ) -> Result<CallToolResult> {
        if self.server_info.is_none() {
            bail!("MCP client not initialized");
        }

        let request = CallToolRequest {
            name: tool_name.to_string(),
            arguments,
        };

        let response = self
            .call("tools/call", serde_json::to_value(request)?)
            .await?;

        let result: CallToolResult = serde_json::from_value(
            response
                .get("result")
                .cloned()
                .unwrap_or_else(|| json!({"content": []})),
        )
        .context("Invalid tools/call result")?;

        Ok(result)
    }

    /// Send a JSON-RPC notification (no response expected).
    async fn notify(
        &mut self,
        method: &str,
        params: Value,
    ) -> Result<()> {
        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: 0,
            method: method.to_string(),
            params,
        };
        let _ = self.transport.request(serde_json::to_value(request)?).await?;
        Ok(())
    }

    /// Send a JSON-RPC request and return the response.
    async fn call(
        &mut self,
        method: &str,
        params: Value,
    ) -> Result<Value> {
        let id = {
            let mut counter = self.request_id.lock().await;
            let id = *counter;
            *counter += 1;
            id
        };

        let request = JsonRpcRequest::new(id, method, params);
        let raw = self
            .transport
            .request(serde_json::to_value(request)?)
            .await?;

        // If the response is a notification or otherwise missing id, handle gracefully.
        if raw.get("id").is_none() {
            bail!("MCP server returned response without id: {}", raw);
        }

        if let Some(err) = raw.get("error") {
            let err: JsonRpcError = serde_json::from_value(err.clone())
                .unwrap_or_else(|_| JsonRpcError {
                    code: -32603,
                    message: "Unknown MCP error".to_string(),
                    data: None,
                });
            bail!(err);
        }

        Ok(raw)
    }

    /// Close the underlying transport.
    pub async fn close(mut self) {
        let _ = self.transport.close().await;
    }

    /// Return server info, if initialized.
    pub fn server_info(&self) -> Option<&Implementation> {
        self.server_info.as_ref()
    }

    /// Return current transport status string.
    pub fn status(&self) -> String {
        self.transport.status()
    }
}

/// A handle to a running MCP client that can be shared and restarted.
#[derive(Clone)]
pub struct McpClientHandle {
    inner: Arc<RwLock<Option<McpClient>>>,
}

impl McpClientHandle {
    pub fn new(client: McpClient) -> Self {
        Self {
            inner: Arc::new(RwLock::new(Some(client))),
        }
    }

    pub async fn with_client<F, R>(
        &self,
        f: F,
    ) -> Result<R>
    where
        F: for<'a> FnOnce(&'a mut McpClient) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<R>> + Send + 'a>> + Send,
    {
        let mut guard = self.inner.write().await;
        let client = guard
            .as_mut()
            .ok_or_else(|| anyhow!("MCP client is not connected"))?;
        f(client).await
    }

    pub async fn close(&self) {
        let mut guard = self.inner.write().await;
        if let Some(client) = guard.take() {
            client.close().await;
        }
    }

    pub async fn is_connected(&self) -> bool {
        self.inner.read().await.is_some()
    }
}
