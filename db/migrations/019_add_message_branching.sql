-- Add is_active column to messages for conversation branching/tree support.
-- Only one sibling per parent_id group is active (is_active = 1) at a time.
-- Inactive variants (is_active = 0) are preserved for navigation via < > buttons.
ALTER TABLE messages ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;

-- Backfill parent_id for existing linear conversations:
-- Chain messages by created_at within each chat so each message points to
-- the message that precedes it (tree parent). Tool messages chain to the
-- assistant message that spawned them (detected by created_at proximity).
UPDATE messages SET parent_id = (
  SELECT m2.id FROM messages m2
  WHERE m2.chat_id = messages.chat_id
    AND m2.created_at < messages.created_at
  ORDER BY m2.created_at DESC
  LIMIT 1
) WHERE parent_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_messages_parent_id ON messages(parent_id);
CREATE INDEX IF NOT EXISTS idx_messages_chat_active ON messages(chat_id, is_active);