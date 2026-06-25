-- Extend terminal_sessions for tabbed persistent sessions.

ALTER TABLE terminal_sessions ADD COLUMN tab_id TEXT;
ALTER TABLE terminal_sessions ADD COLUMN cwd TEXT;

-- The original CHECK constraint only allowed running/success/error/killed.
-- SQLite does not support ALTERing a CHECK constraint directly, so we recreate
-- the table with the timeout status included.
CREATE TABLE terminal_sessions_new (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    tab_id TEXT,
    command TEXT NOT NULL,
    cwd TEXT,
    status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'error', 'killed', 'timeout')),
    stdout TEXT,
    stderr TEXT,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at TEXT
);

INSERT INTO terminal_sessions_new
    (id, user_id, tab_id, command, cwd, status, stdout, stderr, started_at, ended_at)
SELECT
    id, user_id, NULL, command, NULL, status, stdout, stderr, started_at, ended_at
FROM terminal_sessions;

DROP TABLE terminal_sessions;
ALTER TABLE terminal_sessions_new RENAME TO terminal_sessions;

CREATE INDEX IF NOT EXISTS idx_terminal_sessions_user_id ON terminal_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_terminal_sessions_started_at ON terminal_sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_terminal_sessions_user_tab ON terminal_sessions(user_id, tab_id);
