-- Data-preservation fields shared with the full legacy PostgreSQL schema.
ALTER TABLE app_users ADD COLUMN referral_code TEXT;
ALTER TABLE app_users ADD COLUMN referred_by TEXT;
ALTER TABLE app_users ADD COLUMN terminated_at TEXT;
ALTER TABLE app_users ADD COLUMN last_active_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS app_users_referral_code_uq ON app_users(referral_code) WHERE referral_code IS NOT NULL;

ALTER TABLE tenant_sites ADD COLUMN timezone TEXT;
ALTER TABLE tenant_sites ADD COLUMN support_email TEXT;
ALTER TABLE tenant_sites ADD COLUMN support_phone TEXT;
ALTER TABLE tenant_sites ADD COLUMN plan TEXT;
ALTER TABLE tenant_sites ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE tenant_sites ADD COLUMN renewal_at TEXT;
ALTER TABLE tenant_sites ADD COLUMN branding TEXT NOT NULL DEFAULT '{}';
ALTER TABLE tenant_sites ADD COLUMN contact_email TEXT;
ALTER TABLE tenant_sites ADD COLUMN contact_phone TEXT;

ALTER TABLE wallet_ledger ADD COLUMN tenant_id TEXT REFERENCES tenant_sites(id) ON DELETE SET NULL;
ALTER TABLE wallet_ledger ADD COLUMN reference_id TEXT;
ALTER TABLE wallet_ledger ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS wallet_ledger_reference_full_idx ON wallet_ledger(reference, reference_id);

ALTER TABLE shipments ADD COLUMN estimated_delivery TEXT;
ALTER TABLE commerce_orders ADD COLUMN idempotency_key TEXT;
ALTER TABLE commerce_orders ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}';
CREATE UNIQUE INDEX IF NOT EXISTS commerce_orders_idempotency_idx ON commerce_orders(idempotency_key);
ALTER TABLE commerce_order_items ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}';
ALTER TABLE user_notifications ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}';
