-- Store OAuth2 integration credentials (Google, Todoist, etc.)
CREATE TABLE IF NOT EXISTS integration_credentials (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('google', 'todoist')),
    encrypted_access_token TEXT NOT NULL,
    encrypted_refresh_token TEXT,
    expires_at TEXT,
    scopes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_integration_creds_user ON integration_credentials(user_id);
