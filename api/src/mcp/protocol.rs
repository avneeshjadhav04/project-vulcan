use serde::{Deserialize, Serialize};
use serde_json::Value;

/// JSON-RPC request wrapper used for all MCP messages.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub id: u64,
    pub method: String,
    #[serde(default = "serde_json::Value::default")]
    pub params: Value,
}

impl JsonRpcRequest {
    pub fn new(id: u64, method: impl Into<String>, params: Value) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id,
            method: method.into(),
            params,
        }
    }
}

/// JSON-RPC response wrapper.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    pub id: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
}

/// JSON-RPC error object.
#[derive(Debug, Clone, Serialize, Deserialize, thiserror::Error)]
#[error("JSON-RPC error {code}: {message}")]
pub struct JsonRpcError {
    pub code: i32,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

/// MCP implementation information.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Implementation {
    pub name: String,
    pub version: String,
}

/// Capabilities announced by a peer during initialization.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ServerCapabilities {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tools: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resources: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompts: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub logging: Option<Value>,
}

/// Client capability declaration (minimal).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ClientCapabilities {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tools: Option<Value>,
}

/// Request sent by the client during initialization.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InitializeRequest {
    pub protocolVersion: String,
    pub capabilities: ClientCapabilities,
    pub clientInfo: Implementation,
}

/// Result returned by the server during initialization.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InitializeResult {
    pub protocolVersion: String,
    pub capabilities: ServerCapabilities,
    pub serverInfo: Implementation,
}

/// Result of `tools/list`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListToolsResult {
    pub tools: Vec<McpTool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nextCursor: Option<String>,
}

/// An MCP tool definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpTool {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inputSchema: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_schema: Option<Value>,
}

impl McpTool {
    /// Normalizes the tool input schema regardless of whether the server used
    /// camelCase (`inputSchema`) or snake_case (`input_schema`).
    pub fn schema(&self) -> Option<&Value> {
        self.inputSchema.as_ref().or(self.input_schema.as_ref())
    }
}

/// Request body for `tools/call`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CallToolRequest {
    pub name: String,
    pub arguments: Value,
}

/// Result of `tools/call`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CallToolResult {
    pub content: Vec<ToolContent>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub isError: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_error: Option<bool>,
}

impl CallToolResult {
    pub fn is_error(&self) -> bool {
        self.isError.unwrap_or(false) || self.is_error.unwrap_or(false)
    }
}

/// A single content item returned by a tool call.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ToolContent {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "image")]
    Image { data: String, mimeType: String },
    #[serde(rename = "resource")]
    Resource { resource: Value },
    #[serde(other)]
    Unknown,
}

impl ToolContent {
    pub fn text(&self) -> Option<&str> {
        match self {
            ToolContent::Text { text } => Some(text),
            _ => None,
        }
    }
}

/// Result of `prompts/list` or `resources/list` (unused but kept for completeness).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmptyListResult {
    #[serde(default)]
    pub items: Vec<Value>,
}

/// JSON-RPC notification (no id, used for logs and progress; currently ignored).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcNotification {
    pub jsonrpc: String,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}
