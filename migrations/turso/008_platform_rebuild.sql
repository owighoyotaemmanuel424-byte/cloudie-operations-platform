-- 008_platform_rebuild.sql
-- Persistent storage for the rebuilt Cloudie platform (phase 2).
--
-- Additive and non-destructive: legacy tables (shipments, user_documents,
-- commerce_orders, user_notifications, wallet_ledger) are left untouched so no
-- existing production data is dropped or rewritten. The rebuilt platform writes
-- to purpose-built tables with the exact shapes its workspaces need.

-- ── Identity additions ──────────────────────────────────────────────────────
-- referral_code and referred_by already exist from 007; only `phone` is new here.
ALTER TABLE app_users ADD COLUMN phone TEXT;

-- ── Points ledger: double-entry, append-only, idempotent ────────────────────
-- A "group" is one business transaction. It starts as `draft`, receives two or
-- more signed entries that must sum to zero, then is posted. Posted groups and
-- their entries are immutable. Refunds are new reversing groups.
CREATE TABLE IF NOT EXISTS points_ledger_groups (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  workspace TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('credit','debit','refund','bonus')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted')),
  description TEXT NOT NULL,
  reference TEXT,
  idempotency_key TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS points_groups_user_created_idx
  ON points_ledger_groups(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS points_ledger_entries (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES points_ledger_groups(id) ON DELETE RESTRICT,
  account_id TEXT NOT NULL,
  points INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS points_entries_group_idx ON points_ledger_entries(group_id);
CREATE INDEX IF NOT EXISTS points_entries_account_idx ON points_ledger_entries(account_id);

CREATE TRIGGER IF NOT EXISTS points_groups_require_draft_insert
BEFORE INSERT ON points_ledger_groups
WHEN NEW.status = 'posted'
BEGIN SELECT RAISE(ABORT, 'Create points groups as draft and post after validation'); END;

CREATE TRIGGER IF NOT EXISTS points_groups_validate_posted
BEFORE UPDATE OF status ON points_ledger_groups
WHEN NEW.status = 'posted'
BEGIN
  SELECT CASE WHEN (SELECT COUNT(*) FROM points_ledger_entries WHERE group_id = NEW.id) < 2
    THEN RAISE(ABORT, 'Points group needs at least two entries') END;
  SELECT CASE WHEN (SELECT COALESCE(SUM(points), 0) FROM points_ledger_entries WHERE group_id = NEW.id) <> 0
    THEN RAISE(ABORT, 'Points group is not balanced') END;
END;

CREATE TRIGGER IF NOT EXISTS points_entries_block_posted_insert
BEFORE INSERT ON points_ledger_entries
WHEN (SELECT status FROM points_ledger_groups WHERE id = NEW.group_id) = 'posted'
BEGIN SELECT RAISE(ABORT, 'Posted points entries are immutable'); END;

CREATE TRIGGER IF NOT EXISTS points_entries_block_posted_update
BEFORE UPDATE ON points_ledger_entries
WHEN (SELECT status FROM points_ledger_groups WHERE id = OLD.group_id) = 'posted'
BEGIN SELECT RAISE(ABORT, 'Posted points entries are immutable'); END;

CREATE TRIGGER IF NOT EXISTS points_entries_block_posted_delete
BEFORE DELETE ON points_ledger_entries
WHEN (SELECT status FROM points_ledger_groups WHERE id = OLD.group_id) = 'posted'
BEGIN SELECT RAISE(ABORT, 'Posted points entries are immutable'); END;

CREATE TRIGGER IF NOT EXISTS points_groups_block_posted_update
BEFORE UPDATE ON points_ledger_groups
WHEN OLD.status = 'posted' AND (NEW.status <> 'posted' OR NEW.reference IS NOT OLD.reference)
BEGIN SELECT RAISE(ABORT, 'Posted points groups are immutable'); END;

CREATE TRIGGER IF NOT EXISTS points_groups_block_posted_delete
BEFORE DELETE ON points_ledger_groups
WHEN OLD.status = 'posted'
BEGIN SELECT RAISE(ABORT, 'Posted points groups are immutable'); END;

-- ── Top-up deposits (pending until settled; never auto-credited) ────────────
CREATE TABLE IF NOT EXISTS platform_point_packs (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  points INTEGER NOT NULL CHECK (points > 0),
  price_ngn INTEGER NOT NULL CHECK (price_ngn >= 0),
  bonus INTEGER NOT NULL DEFAULT 0,
  crypto TEXT NOT NULL DEFAULT 'USDT'
);
INSERT OR IGNORE INTO platform_point_packs (id, label, points, price_ngn, bonus, crypto) VALUES
  ('pack-1', 'Depot', 1000, 12000, 0, 'USDT'),
  ('pack-2', 'Waybill', 2500, 28000, 150, 'USDT'),
  ('pack-3', 'Consignment', 6000, 64000, 600, 'BTC'),
  ('pack-4', 'Fleet', 15000, 150000, 2250, 'ETH');

CREATE TABLE IF NOT EXISTS platform_deposits (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  pack_id TEXT NOT NULL,
  label TEXT NOT NULL,
  points INTEGER NOT NULL CHECK (points > 0),
  bonus INTEGER NOT NULL DEFAULT 0,
  crypto TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','settled','cancelled')),
  settled_by TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS platform_deposits_user_idx ON platform_deposits(user_id, created_at DESC);

-- ── Shipments (rebuilt workspace shape) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_shipments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  code TEXT NOT NULL UNIQUE,
  public_token TEXT NOT NULL UNIQUE,
  service TEXT NOT NULL CHECK (service IN ('express','economy','freight')),
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  recipient_phone TEXT,
  contents TEXT,
  weight_kg REAL NOT NULL CHECK (weight_kg > 0),
  declared_value REAL NOT NULL DEFAULT 0,
  cost_points INTEGER NOT NULL CHECK (cost_points >= 0),
  status TEXT NOT NULL DEFAULT 'registered'
    CHECK (status IN ('registered','in_transit','customs','out_for_delivery','delivered','on_hold')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS platform_shipments_user_created_idx
  ON platform_shipments(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS platform_shipment_events (
  id TEXT PRIMARY KEY,
  shipment_id TEXT NOT NULL REFERENCES platform_shipments(id) ON DELETE RESTRICT,
  status TEXT NOT NULL,
  label TEXT NOT NULL,
  location TEXT,
  note TEXT,
  at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS platform_shipment_events_shipment_idx
  ON platform_shipment_events(shipment_id, at DESC);

-- ── Travel documents ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_documents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  public_token TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('flight','hotel','invoice','customs','receipt')),
  title TEXT NOT NULL,
  passenger TEXT,
  reference TEXT,
  lines TEXT NOT NULL DEFAULT '[]',
  total REAL,
  currency TEXT NOT NULL DEFAULT 'NGN',
  points_charged INTEGER NOT NULL CHECK (points_charged >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS platform_documents_user_created_idx
  ON platform_documents(user_id, created_at DESC);

-- ── Marketplace listings, orders and order chat ────────────────────────────
CREATE TABLE IF NOT EXISTS platform_listings (
  id TEXT PRIMARY KEY,
  vendor TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  points INTEGER NOT NULL CHECK (points > 0),
  tag TEXT,
  rating REAL NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO platform_listings (id, vendor, title, detail, points, tag, rating) VALUES
  ('lst-1', 'Lekki Freight Co.', 'Lagos → Accra freight slot', '40ft shared container, 3-day clearance window', 2400, 'Freight', 4.8),
  ('lst-2', 'Kano Print House', 'Waybill booklet · 200 pages', 'Carbonless 3-ply, branded with your logo', 640, 'Print', 4.6),
  ('lst-3', 'AeroDesk', 'Same-day courier retainer', '25 pickups inside Lagos mainland', 1500, 'Courier', 4.9),
  ('lst-4', 'Studio Mono', 'Campaign artwork pack', 'Five email headers, two social kits', 380, 'Design', 4.7);

CREATE TABLE IF NOT EXISTS platform_orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  listing_id TEXT NOT NULL REFERENCES platform_listings(id) ON DELETE RESTRICT,
  vendor TEXT NOT NULL,
  title TEXT NOT NULL,
  points INTEGER NOT NULL CHECK (points > 0),
  status TEXT NOT NULL DEFAULT 'vendor_contacted'
    CHECK (status IN ('vendor_contacted','in_progress','delivered')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS platform_orders_user_idx ON platform_orders(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS platform_order_messages (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES platform_orders(id) ON DELETE RESTRICT,
  sender TEXT NOT NULL CHECK (sender IN ('customer','vendor')),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS platform_order_messages_order_idx
  ON platform_order_messages(order_id, created_at);

-- ── Email campaigns ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_campaigns (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  template TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  recipients TEXT NOT NULL DEFAULT '[]',
  points_charged INTEGER NOT NULL CHECK (points_charged >= 0),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed')),
  opens INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS platform_campaigns_user_idx
  ON platform_campaigns(user_id, created_at DESC);

-- ── Tenant portal configuration and portal users ───────────────────────────
-- `plan` already exists from 007; the rebuilt portal needs the rest.
ALTER TABLE tenant_sites ADD COLUMN status TEXT;
ALTER TABLE tenant_sites ADD COLUMN kyc_required INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tenant_sites ADD COLUMN kyc_level TEXT NOT NULL DEFAULT 'basic';
ALTER TABLE tenant_sites ADD COLUMN investment_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tenant_sites ADD COLUMN renewal_points INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tenant_sites ADD COLUMN renews_at TEXT;

UPDATE tenant_sites SET plan = COALESCE(plan, 'starter');
UPDATE tenant_sites SET status = COALESCE(status, CASE WHEN is_active = 1 THEN 'live' ELSE 'suspended' END);

CREATE TABLE IF NOT EXISTS tenant_portal_users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenant_sites(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('owner','staff','viewer')),
  invited_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS tenant_portal_users_tenant_email_idx
  ON tenant_portal_users(tenant_id, email);
CREATE INDEX IF NOT EXISTS tenant_portal_users_user_email_idx
  ON tenant_portal_users(email);

-- ── Platform notifications (rebuilt workspace shape) ───────────────────────
CREATE TABLE IF NOT EXISTS platform_notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  workspace TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0 CHECK (read IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS platform_notifications_user_idx
  ON platform_notifications(user_id, created_at DESC);

-- ── Password reset tokens (hashed at rest) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS password_reset_user_idx ON password_reset_tokens(user_id, expires_at);
