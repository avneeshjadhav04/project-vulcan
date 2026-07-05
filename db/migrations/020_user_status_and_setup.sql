-- Add active flag to users and promote the oldest existing real user to admin if none exists.
-- This ensures existing deployments are not locked out when they upgrade.

ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;

-- If there are users but no admin, make the oldest real user the master admin.
UPDATE users
SET role = 'admin'
WHERE role != 'admin'
  AND email != 'system@builtin.local'
  AND created_at = (
    SELECT MIN(created_at) FROM users WHERE role != 'admin' AND email != 'system@builtin.local'
  )
  AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin' AND email != 'system@builtin.local');
