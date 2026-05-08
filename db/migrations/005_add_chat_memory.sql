-- Add chat memory (conversation summarization) support

-- Track whether user has long-term memory enabled (default: on)
ALTER TABLE users ADD COLUMN memory_enabled INTEGER NOT NULL DEFAULT 1;

-- Store conversation summary for each chat
ALTER TABLE chats ADD COLUMN summary TEXT;

-- Track when summary was last updated
ALTER TABLE chats ADD COLUMN summary_updated_at TEXT;

-- Index for quickly finding chats that might need summarization
CREATE INDEX IF NOT EXISTS idx_chats_summary ON chats(summary);
