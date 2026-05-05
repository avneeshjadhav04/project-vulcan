-- Add files table for file uploads
CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    storage_path TEXT NOT NULL,
    extracted_text TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_files_chat_id ON files(chat_id);
CREATE INDEX IF NOT EXISTS idx_files_message_id ON files(message_id);

-- Add chat organization columns
ALTER TABLE chats ADD COLUMN folder TEXT DEFAULT 'default';
ALTER TABLE chats ADD COLUMN tags TEXT DEFAULT '[]';
ALTER TABLE chats ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chats ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0;

-- Add parent_message_id for conversation branching
ALTER TABLE messages ADD COLUMN parent_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL;
ALTER TABLE messages ADD COLUMN branch_id TEXT;

CREATE INDEX IF NOT EXISTS idx_messages_parent_id ON messages(parent_message_id);
CREATE INDEX IF NOT EXISTS idx_chats_folder ON chats(folder);
CREATE INDEX IF NOT EXISTS idx_chats_is_archived ON chats(is_archived);
