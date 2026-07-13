-- Browser automation sessions (audit/history; live state is in-memory).
CREATE TABLE IF NOT EXISTS browser_sessions (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    chat_id TEXT REFERENCES chats(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL,
    current_url TEXT,
    title TEXT,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'closed', 'crashed', 'timeout')),
    created_at TEXT NOT NULL DEFAULT datetime('now'),
    last_activity TEXT NOT NULL DEFAULT datetime('now'),
    closed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_browser_sessions_user_id
    ON browser_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_browser_sessions_user_session
    ON browser_sessions(user_id, session_id);

-- Screenshots captured during browser automation, persisted as BLOBs.
-- Cascade-deleted with the chat so orphaned images don't accumulate.
CREATE TABLE IF NOT EXISTS browser_screenshots (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    chat_id TEXT REFERENCES chats(id) ON DELETE CASCADE,
    message_id TEXT,
    session_id TEXT NOT NULL,
    image BLOB NOT NULL,
    mime_type TEXT NOT NULL DEFAULT 'image/jpeg',
    width INTEGER,
    height INTEGER,
    page_url TEXT,
    captured_at TEXT NOT NULL DEFAULT datetime('now')
);

CREATE INDEX IF NOT EXISTS idx_browser_screenshots_chat_id
    ON browser_screenshots(chat_id);
CREATE INDEX IF NOT EXISTS idx_browser_screenshots_session_id
    ON browser_screenshots(session_id);