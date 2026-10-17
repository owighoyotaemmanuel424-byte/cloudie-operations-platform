-- Cloudie Neon migration phase 4: API authentication fields.
-- Apply only to a test branch while validating the new API.
BEGIN;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS app_users_email_auth_idx ON app_users (LOWER(email));
COMMIT;