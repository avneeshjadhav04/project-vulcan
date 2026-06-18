-- Migrate any remaining legacy user.encrypted_nim_key values into the providers table,
-- then drop the legacy column. Users should add providers via Settings -> AI Providers.

INSERT INTO providers (user_id, name, provider_type, base_url, encrypted_api_key)
SELECT
    id,
    'NVIDIA NIM',
    'nvidia',
    'https://integrate.api.nvidia.com/v1',
    encrypted_nim_key
FROM users
WHERE encrypted_nim_key IS NOT NULL
  AND encrypted_nim_key != ''
  AND NOT EXISTS (
      SELECT 1 FROM providers p
      WHERE p.user_id = users.id AND p.provider_type = 'nvidia'
  );

ALTER TABLE users DROP COLUMN encrypted_nim_key;
