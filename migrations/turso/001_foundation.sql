CREATE TABLE IF NOT EXISTS app_users (
  id TEXT PRIMARY KEY,
  name TEXT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user', 'vendor')),
  password_hash TEXT,
  is_suspended INTEGER NOT NULL DEFAULT 0,
  is_terminated INTEGER NOT NULL DEFAULT 0,
  wallet_balance_ngn NUMERIC NOT NULL DEFAULT 0,
  points_balance INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS api_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS api_sessions_user_idx ON api_sessions(user_id, expires_at);
CREATE INDEX IF NOT EXISTS app_users_email_idx ON app_users(email);

CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS wallet_ledger (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES app_users(id),
  amount_ngn NUMERIC NOT NULL,
  balance_after_ngn NUMERIC NOT NULL,
  description TEXT NOT NULL,
  transaction_type TEXT NOT NULL,
  reference TEXT,
  idempotency_key TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS wallet_ledger_user_idx ON wallet_ledger(user_id, created_at DESC);
