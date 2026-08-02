-- Decouple browser sessions from chats: chat_id is now nullable so that
-- standalone (user-created) sessions can exist without an associated chat,
-- and AI-borrowed sessions revert to standalone (chat_id = NULL) on release.
-- On chat deletion the session row survives with chat_id cleared.

CREATE TABLE browser_sessions_new (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    chat_id TEXT REFERENCES chats(id) ON DELETE SET NULL,
    session_id TEXT NOT NULL,
    current_url TEXT,
    title TEXT,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'closed', 'crashed', 'timeout')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_activity TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at TEXT
);

INSERT INTO browser_sessions_new (id, user_id, chat_id, session_id, current_url, title, status, created_at, last_activity, closed_at)
SELECT id, user_id, chat_id, session_id, current_url, title, status, created_at, last_activity, closed_at
FROM browser_sessions;

DROP TABLE browser_sessions;
ALTER TABLE browser_sessions_new RENAME TO browser_sessions;

CREATE INDEX IF NOT EXISTS idx_browser_sessions_user_id
    ON browser_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_browser_sessions_user_session
    ON browser_sessions(user_id, session_id);