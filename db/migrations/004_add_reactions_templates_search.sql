-- Add message reactions
CREATE TABLE IF NOT EXISTS message_reactions (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reaction TEXT NOT NULL CHECK (reaction IN ('thumbs_up', 'thumbs_down')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(message_id, user_id, reaction)
);

CREATE INDEX IF NOT EXISTS idx_reactions_message_id ON message_reactions(message_id);

-- Add prompt templates/snippets
CREATE TABLE IF NOT EXISTS prompt_templates (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    shortcut TEXT,
    is_builtin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_templates_user_id ON prompt_templates(user_id);

-- Insert a system user for builtin templates (required by FK constraint)
INSERT OR IGNORE INTO users (id, email, password_hash, role) VALUES
('00000000000000000000000000000000', 'system@builtin.local', '!not_a_real_hash!', 'admin');

-- Insert default templates
INSERT INTO prompt_templates (user_id, title, content, is_builtin) VALUES
('00000000000000000000000000000000', 'Explain Code', 'Explain this code in detail, including what each part does and why it is written this way.', 1),
('00000000000000000000000000000000', 'Refactor', 'Refactor this code to improve readability, performance, and maintainability. Explain your changes.', 1),
('00000000000000000000000000000000', 'Debug', 'Find and fix any bugs in this code. Explain what was wrong and how you fixed it.', 1),
('00000000000000000000000000000000', 'Summarize', 'Provide a concise summary of the key points.', 1),
('00000000000000000000000000000000', 'Write Tests', 'Write comprehensive unit tests for this code. Cover edge cases and error conditions.', 1);

-- Add full-text search index for messages
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    content,
    content_rowid=rowid,
    content=messages
);

-- Populate FTS index
INSERT INTO messages_fts(rowid, content) SELECT rowid, content FROM messages;

-- Triggers to keep FTS index in sync
CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
END;

CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
    INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;
