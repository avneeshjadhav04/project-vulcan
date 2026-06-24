-- Remove the unused prompt_templates feature and the placeholder system user
-- that was created solely to satisfy its foreign-key constraint. This fixes
-- the first-time signup detection, which counted the fake system user as an
-- existing account.

DROP TABLE IF EXISTS prompt_templates;

DELETE FROM users WHERE email = 'system@builtin.local';
