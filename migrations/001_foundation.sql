-- Cloudie Neon migration phase 1: additive foundation only.
-- Review and apply to a temporary Neon branch first. This is not a complete app migration.
BEGIN;
CREATE TABLE IF NOT EXISTS app_users (
 id TEXT PRIMARY KEY, name TEXT, email TEXT, email_verified_at TIMESTAMPTZ, image TEXT,
 role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user','vendor')),
 wallet_balance_ngn NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (wallet_balance_ngn >= 0),
 points_balance NUMERIC(20,2) NOT NULL DEFAULT 0, referral_code TEXT UNIQUE, referred_by TEXT,
 is_suspended BOOLEAN NOT NULL DEFAULT FALSE, is_terminated BOOLEAN NOT NULL DEFAULT FALSE,
 terminated_at TIMESTAMPTZ, last_active_at TIMESTAMPTZ, organization_name TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_lower_uq ON app_users (LOWER(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS app_users_role_created_idx ON app_users (role,created_at DESC);
CREATE TABLE IF NOT EXISTS tenant_sites (
 id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
 site_name TEXT NOT NULL, display_name TEXT, slug TEXT, subdomain TEXT NOT NULL UNIQUE,
 site_type TEXT NOT NULL CHECK (site_type IN ('bank','investment','logistics','ticketing','business','services')),
 currency CHAR(3), country TEXT, timezone TEXT, support_email TEXT, support_phone TEXT, plan TEXT,
 lifecycle_status TEXT NOT NULL DEFAULT 'active', banking_enabled BOOLEAN NOT NULL DEFAULT FALSE,
 is_active BOOLEAN NOT NULL DEFAULT TRUE, renewal_at TIMESTAMPTZ, branding JSONB NOT NULL DEFAULT '{}'::jsonb,
 contact_email TEXT, contact_phone TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tenant_sites_owner_created_idx ON tenant_sites(owner_user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS tenant_sites_slug_type_idx ON tenant_sites(slug,site_type);
CREATE TABLE IF NOT EXISTS wallet_ledger (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
 amount_ngn NUMERIC(20,2) NOT NULL CHECK (amount_ngn <> 0),
 balance_after_ngn NUMERIC(20,2) NOT NULL CHECK (balance_after_ngn >= 0),
 description TEXT NOT NULL, transaction_type TEXT NOT NULL, reference TEXT, reference_id TEXT,
 idempotency_key TEXT UNIQUE, metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS wallet_ledger_user_created_idx ON wallet_ledger(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS wallet_ledger_type_created_idx ON wallet_ledger(transaction_type,created_at DESC);
CREATE INDEX IF NOT EXISTS wallet_ledger_reference_idx ON wallet_ledger(reference,reference_id);
CREATE TABLE IF NOT EXISTS platform_settings (
 key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_by TEXT REFERENCES app_users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS schema_migrations (
 version TEXT PRIMARY KEY, description TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMIT;