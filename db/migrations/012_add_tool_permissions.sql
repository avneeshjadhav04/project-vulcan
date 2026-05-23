-- Store AI tool permissions per user (e.g. 'auto', 'ask', 'deny')
CREATE TABLE IF NOT EXISTS tool_permissions (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tool_name TEXT NOT NULL,
    permission_level TEXT NOT NULL CHECK (permission_level IN ('auto', 'ask', 'deny')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, tool_name)
);

CREATE INDEX IF NOT EXISTS idx_tool_permissions_user ON tool_permissions(user_id);
