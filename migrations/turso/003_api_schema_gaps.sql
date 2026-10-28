-- Close API schema gaps found during the PostgreSQL-to-libSQL route conversion.
ALTER TABLE app_users ADD COLUMN image TEXT;
ALTER TABLE app_users ADD COLUMN email_verified_at TEXT;

ALTER TABLE user_notifications ADD COLUMN category TEXT NOT NULL DEFAULT 'general';
ALTER TABLE user_notifications ADD COLUMN body TEXT NOT NULL DEFAULT '';
ALTER TABLE user_notifications ADD COLUMN action_url TEXT;

ALTER TABLE user_documents ADD COLUMN data TEXT;
ALTER TABLE user_documents ADD COLUMN points_cost NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE user_documents ADD COLUMN price_ngn NUMERIC NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS app_users_created_idx ON app_users(created_at DESC);
CREATE INDEX IF NOT EXISTS wallet_ledger_reference_idx ON wallet_ledger(reference);
