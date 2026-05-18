CREATE TABLE IF NOT EXISTS providers (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    provider_type TEXT NOT NULL DEFAULT 'custom',
    base_url TEXT NOT NULL,
    encrypted_api_key TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_providers_user_id ON providers(user_id);

-- Add provider_id to chats
ALTER TABLE chats ADD COLUMN provider_id TEXT REFERENCES providers(id) ON DELETE SET NULL;

-- Track which provider/model generated each message
ALTER TABLE messages ADD COLUMN provider_id TEXT;
ALTER TABLE messages ADD COLUMN model_id TEXT;

CREATE INDEX IF NOT EXISTS idx_chats_provider_id ON chats(provider_id);
CREATE INDEX IF NOT EXISTS idx_messages_provider_model ON messages(provider_id, model_id);
