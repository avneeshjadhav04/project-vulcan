DROP TABLE IF EXISTS memory_embeddings;

CREATE TABLE IF NOT EXISTS scratchpad_memory (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
