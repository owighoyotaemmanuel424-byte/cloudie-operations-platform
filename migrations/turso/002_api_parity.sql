-- Cloudie API parity schema for Turso/libSQL.
-- SQLite-compatible schema; apply only after 001_foundation.sql.
ALTER TABLE app_users ADD COLUMN organization_name TEXT;
ALTER TABLE app_users ADD COLUMN password_changed_at TEXT;
ALTER TABLE platform_settings ADD COLUMN updated_by TEXT REFERENCES app_users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS tenant_sites (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  site_name TEXT NOT NULL,
  display_name TEXT,
  slug TEXT UNIQUE,
  subdomain TEXT NOT NULL UNIQUE,
  site_type TEXT NOT NULL CHECK (site_type IN ('bank','investment','logistics','ticketing','business','services')),
  currency TEXT DEFAULT 'NGN',
  country TEXT DEFAULT 'NG',
  banking_enabled INTEGER NOT NULL DEFAULT 0 CHECK (banking_enabled IN (0,1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS tenant_sites_owner_created_idx ON tenant_sites(owner_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tenant_users (
  tenant_id TEXT NOT NULL REFERENCES tenant_sites(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, user_id)
);
CREATE INDEX IF NOT EXISTS tenant_users_user_idx ON tenant_users(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS shipments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  tracking_number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','picked_up','in_transit','out_for_delivery','delivered','failed','cancelled')),
  sender_name TEXT NOT NULL, sender_phone TEXT NOT NULL, sender_email TEXT NOT NULL,
  sender_address TEXT NOT NULL, sender_city TEXT NOT NULL, sender_state TEXT NOT NULL,
  sender_country TEXT NOT NULL, sender_postal_code TEXT NOT NULL,
  recipient_name TEXT NOT NULL, recipient_phone TEXT NOT NULL, recipient_email TEXT NOT NULL,
  recipient_address TEXT NOT NULL, recipient_city TEXT NOT NULL, recipient_state TEXT NOT NULL,
  recipient_country TEXT NOT NULL, recipient_postal_code TEXT NOT NULL,
  package_description TEXT NOT NULL, weight REAL NOT NULL CHECK (weight > 0),
  dimensions TEXT, service_type TEXT NOT NULL DEFAULT 'express', notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS shipments_user_created_idx ON shipments(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS shipments_status_created_idx ON shipments(status, created_at DESC);

CREATE TABLE IF NOT EXISTS shipment_events (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  shipment_id TEXT NOT NULL REFERENCES shipments(id) ON DELETE RESTRICT,
  status TEXT NOT NULL, location TEXT, description TEXT NOT NULL,
  metadata TEXT, occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS shipment_events_shipment_time_idx ON shipment_events(shipment_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS user_documents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  document_type TEXT NOT NULL CHECK (document_type IN ('flight','hotel','invoice','customs')),
  title TEXT NOT NULL, file_url TEXT, metadata TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS user_documents_user_created_idx ON user_documents(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS catalog_products (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenant_sites(id) ON DELETE RESTRICT,
  sku TEXT, name TEXT NOT NULL, description TEXT,
  category TEXT NOT NULL, provider TEXT, provider_product_id TEXT,
  price_minor INTEGER NOT NULL CHECK (price_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'NGN', metadata TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS catalog_products_sku_unique_idx ON catalog_products(sku) WHERE sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS catalog_products_active_category_idx ON catalog_products(is_active, category);
CREATE INDEX IF NOT EXISTS catalog_products_tenant_updated_idx ON catalog_products(tenant_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS commerce_orders (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenant_sites(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','escrow','completed','refunded','disputed','cancelled')),
  currency TEXT NOT NULL DEFAULT 'NGN',
  subtotal_minor INTEGER NOT NULL CHECK (subtotal_minor >= 0),
  fee_minor INTEGER NOT NULL DEFAULT 0 CHECK (fee_minor >= 0),
  total_minor INTEGER NOT NULL CHECK (total_minor = subtotal_minor + fee_minor),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS commerce_orders_user_created_idx ON commerce_orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS commerce_orders_tenant_status_idx ON commerce_orders(tenant_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS commerce_order_items (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  order_id TEXT NOT NULL REFERENCES commerce_orders(id) ON DELETE RESTRICT,
  product_id TEXT REFERENCES catalog_products(id) ON DELETE RESTRICT,
  product_name_snapshot TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
  line_total_minor INTEGER NOT NULL CHECK (line_total_minor = quantity * unit_price_minor)
);
CREATE INDEX IF NOT EXISTS commerce_order_items_order_idx ON commerce_order_items(order_id);

CREATE TABLE IF NOT EXISTS user_notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  tenant_id TEXT REFERENCES tenant_sites(id) ON DELETE RESTRICT,
  title TEXT NOT NULL, message TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'info',
  data TEXT, read_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON user_notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_unread_idx ON user_notifications(user_id, created_at DESC) WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  actor_user_id TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  target_user_id TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  tenant_id TEXT REFERENCES tenant_sites(id) ON DELETE SET NULL,
  action TEXT NOT NULL, target_type TEXT, target_id TEXT, details TEXT, ip_address TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS admin_audit_logs_created_idx ON admin_audit_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS banking_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES app_users(id) ON DELETE RESTRICT,
  tenant_id TEXT REFERENCES tenant_sites(id) ON DELETE RESTRICT,
  transaction_type TEXT NOT NULL, amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'NGN', status TEXT NOT NULL DEFAULT 'pending',
  reference TEXT UNIQUE, metadata TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS banking_transactions_created_idx ON banking_transactions(created_at DESC);

-- Enforce the critical posted-ledger immutability invariant in SQLite. A posted group
-- must be balanced before it can be marked posted; entry mutations are blocked thereafter.
CREATE TABLE IF NOT EXISTS banking_ledger_groups (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenant_sites(id) ON DELETE RESTRICT,
  currency TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','reversed')),
  reference TEXT UNIQUE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS banking_ledger_entries (
  id TEXT PRIMARY KEY, ledger_group_id TEXT NOT NULL REFERENCES banking_ledger_groups(id) ON DELETE RESTRICT,
  tenant_id TEXT NOT NULL REFERENCES tenant_sites(id) ON DELETE RESTRICT,
  account_id TEXT, currency TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('debit','credit')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS banking_entries_group_idx ON banking_ledger_entries(ledger_group_id);
CREATE TRIGGER IF NOT EXISTS banking_ledger_groups_validate_posted
BEFORE UPDATE OF status ON banking_ledger_groups
WHEN NEW.status = 'posted'
BEGIN
  SELECT CASE WHEN (SELECT COUNT(*) FROM banking_ledger_entries WHERE ledger_group_id = NEW.id) < 2
    THEN RAISE(ABORT, 'Posted ledger group must contain at least two entries') END;
  SELECT CASE WHEN EXISTS (
    SELECT currency FROM banking_ledger_entries WHERE ledger_group_id = NEW.id
    GROUP BY currency
    HAVING SUM(CASE WHEN direction = 'debit' THEN amount_minor ELSE 0 END)
       <> SUM(CASE WHEN direction = 'credit' THEN amount_minor ELSE 0 END)
  ) THEN RAISE(ABORT, 'Posted ledger group is not balanced per currency') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM banking_ledger_entries WHERE ledger_group_id = NEW.id
    AND (currency <> NEW.currency OR tenant_id <> NEW.tenant_id)
  ) THEN RAISE(ABORT, 'Ledger entries must match group currency and tenant') END;
END;
CREATE TRIGGER IF NOT EXISTS banking_ledger_entries_block_posted_insert
BEFORE INSERT ON banking_ledger_entries
WHEN (SELECT status FROM banking_ledger_groups WHERE id = NEW.ledger_group_id) = 'posted'
BEGIN SELECT RAISE(ABORT, 'Posted ledger entries are immutable'); END;
CREATE TRIGGER IF NOT EXISTS banking_ledger_entries_block_posted_update
BEFORE UPDATE ON banking_ledger_entries
WHEN (SELECT status FROM banking_ledger_groups WHERE id = OLD.ledger_group_id) = 'posted'
BEGIN SELECT RAISE(ABORT, 'Posted ledger entries are immutable'); END;
CREATE TRIGGER IF NOT EXISTS banking_ledger_entries_block_posted_delete
BEFORE DELETE ON banking_ledger_entries
WHEN (SELECT status FROM banking_ledger_groups WHERE id = OLD.ledger_group_id) = 'posted'
BEGIN SELECT RAISE(ABORT, 'Posted ledger entries are immutable'); END;
CREATE TRIGGER IF NOT EXISTS banking_ledger_groups_block_posted_update
BEFORE UPDATE ON banking_ledger_groups
WHEN OLD.status = 'posted'
BEGIN SELECT RAISE(ABORT, 'Posted ledger groups are immutable'); END;
CREATE TRIGGER IF NOT EXISTS banking_ledger_groups_block_posted_delete
BEFORE DELETE ON banking_ledger_groups
WHEN OLD.status = 'posted'
BEGIN SELECT RAISE(ABORT, 'Posted ledger groups are immutable'); END;
