-- Decouple memory features into separate toggles
ALTER TABLE users ADD COLUMN summarization_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN cross_chat_memory_enabled INTEGER NOT NULL DEFAULT 0;

-- Create cross-chat memory table
CREATE TABLE IF NOT EXISTS cross_chat_memory (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Migrate existing data: memory_enabled = 1 means both summarization and scratchpad enabled
-- Users who had memory_enabled = 0 will have summarization_enabled = 0
-- cross_chat_memory_enabled defaults to 0 (opt-in)
