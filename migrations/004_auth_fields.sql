-- Cloudie Neon migration phase 4: API authentication fields.
-- Apply only to a test branch while validating the new API.
BEGIN;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS app_users_email_auth_idx ON app_users (LOWER(email));

CREATE TABLE IF NOT EXISTS api_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS api_sessions_user_expiry_idx ON api_sessions(user_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS api_sessions_expiry_idx ON api_sessions(expires_at) WHERE revoked_at IS NULL;
COMMIT;