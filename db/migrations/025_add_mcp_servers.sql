-- MCP server configurations per user.
-- Vulcan acts as an MCP host/client. Each user can configure arbitrary
-- MCP servers (stdio or SSE) which expose tools to the LLM.
CREATE TABLE IF NOT EXISTS mcp_servers (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    auto_start INTEGER NOT NULL DEFAULT 1,
    transport TEXT NOT NULL CHECK(transport IN ('stdio', 'sse')),
    command TEXT,              -- stdio: executable path or command name
    args TEXT,                 -- JSON array of arguments
    url TEXT,                  -- sse: endpoint URL
    env TEXT,                  -- encrypted JSON object of environment variables
    headers TEXT,              -- encrypted JSON object of HTTP headers (SSE)
    default_permission_level TEXT NOT NULL DEFAULT 'ask' CHECK(default_permission_level IN ('auto','ask','deny')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_mcp_servers_user ON mcp_servers(user_id);

-- Track which MCP tools have been discovered for each user so permissions can be
-- managed individually. Rows are seeded dynamically when a server connects.
CREATE TABLE IF NOT EXISTS mcp_tools (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
    tool_name TEXT NOT NULL,   -- original tool name from the MCP server
    namespaced_name TEXT NOT NULL, -- "{server_id}__{tool_name}"
    description TEXT,
    schema TEXT,               -- JSON schema for tool input
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, server_id, tool_name)
);

CREATE INDEX IF NOT EXISTS idx_mcp_tools_user ON mcp_tools(user_id);
CREATE INDEX IF NOT EXISTS idx_mcp_tools_server ON mcp_tools(server_id);
CREATE INDEX IF NOT EXISTS idx_mcp_tools_namespaced ON mcp_tools(namespaced_name);
