-- Allow 'tool' role in messages and add tool metadata columns
-- SQLite does not support ALTER COLUMN or DROP CONSTRAINT, so we rebuild the table

PRAGMA foreign_keys = OFF;

CREATE TABLE messages_new (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool', 'system')),
    content TEXT NOT NULL,
    tokens_used INTEGER,
    provider_id TEXT,
    model_id TEXT,
    tool_call_id TEXT,
    tool_name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO messages_new (id, chat_id, role, content, tokens_used, provider_id, model_id, created_at)
    SELECT id, chat_id, role, content, tokens_used, provider_id, model_id, created_at FROM messages;

DROP TABLE messages;
ALTER TABLE messages_new RENAME TO messages;

CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);

-- Rebuild FTS triggers against new table
DROP TRIGGER IF EXISTS messages_ai;
CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;

DROP TRIGGER IF EXISTS messages_ad;
CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
END;

DROP TRIGGER IF EXISTS messages_au;
CREATE TRIGGER messages_au AFTER UPDATE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
    INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;

PRAGMA foreign_keys = ON;
