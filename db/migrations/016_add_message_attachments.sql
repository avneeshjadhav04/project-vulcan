-- Add attachments column to messages for clean file separation
ALTER TABLE messages ADD COLUMN attachments TEXT;

-- Create index for faster attachment lookups
CREATE INDEX IF NOT EXISTS idx_messages_attachments ON messages(chat_id, attachments);
