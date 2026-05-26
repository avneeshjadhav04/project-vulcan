-- Vector memory embeddings table
CREATE TABLE IF NOT EXISTS memory_embeddings (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chat_id TEXT REFERENCES chats(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    embedding BLOB NOT NULL, -- Serialized Vec<f32> as bytes
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_memory_embeddings_user ON memory_embeddings(user_id);
CREATE INDEX IF NOT EXISTS idx_memory_embeddings_chat ON memory_embeddings(chat_id);
