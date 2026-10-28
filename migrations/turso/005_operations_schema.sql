-- SQLite/libSQL port of the legacy operations-complete migration.
-- JSON payloads are stored as JSON text; booleans use INTEGER 0/1.
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS permissions (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (role_id, permission_id)
);

INSERT INTO roles (id, name, description)
VALUES
  ('role_user', 'user', 'Standard customer account'),
  ('role_vendor', 'vendor', 'Marketplace vendor account'),
  ('role_staff', 'staff', 'Operations support staff'),
  ('role_admin', 'admin', 'Platform administrator')
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS service_prices (
  id TEXT PRIMARY KEY,
  service_key TEXT NOT NULL UNIQUE,
  workspace TEXT NOT NULL DEFAULT 'services',
  points_cost BIGINT NOT NULL CHECK (points_cost >= 0),
  price_ngn BIGINT NOT NULL CHECK (price_ngn >= 0),
  price_usd NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (price_usd >= 0),
  is_active INTEGER NOT NULL DEFAULT 1,
  effective_from TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS service_prices_workspace_idx
  ON service_prices (workspace, is_active);

CREATE TABLE IF NOT EXISTS vtu_products (
  id TEXT PRIMARY KEY,
  product_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  service_type TEXT NOT NULL CHECK (service_type IN ('airtime', 'data', 'electricity', 'cable', 'exam', 'other')),
  provider_label TEXT NOT NULL,
  fixed_points BIGINT CHECK (fixed_points IS NULL OR fixed_points >= 0),
  indicative_min_points BIGINT CHECK (indicative_min_points IS NULL OR indicative_min_points >= 0),
  indicative_max_points BIGINT CHECK (indicative_max_points IS NULL OR indicative_max_points >= 0),
  requires_amount INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS vtu_products_service_type_idx
  ON vtu_products (service_type, enabled);

CREATE TABLE IF NOT EXISTS vtu_routes (
  id TEXT PRIMARY KEY,
  product_code TEXT NOT NULL REFERENCES vtu_products(product_code) ON DELETE CASCADE,
  provider_key TEXT NOT NULL,
  provider_service_code TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  supports_verify INTEGER NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 1,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (product_code, provider_key)
);

CREATE INDEX IF NOT EXISTS vtu_routes_product_enabled_idx
  ON vtu_routes (product_code, enabled, priority ASC);

CREATE TABLE IF NOT EXISTS payment_records (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenant_sites(id) ON DELETE SET NULL,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  reference TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL DEFAULT 'paystack',
  channel TEXT NOT NULL DEFAULT 'card',
  currency TEXT NOT NULL DEFAULT 'NGN' CHECK (length(currency) BETWEEN 3 AND 6),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  points_credited BIGINT NOT NULL DEFAULT 0 CHECK (points_credited >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'cancelled', 'refunded')),
  provider_reference TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS payment_records_user_created_idx
  ON payment_records (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS payment_records_status_created_idx
  ON payment_records (status, created_at DESC);

CREATE TABLE IF NOT EXISTS crypto_deposit_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  asset TEXT NOT NULL,
  network TEXT NOT NULL,
  amount_usd NUMERIC(14, 2) NOT NULL CHECK (amount_usd > 0),
  amount_ngn BIGINT NOT NULL CHECK (amount_ngn > 0),
  points_requested BIGINT NOT NULL CHECK (points_requested > 0),
  tx_hash TEXT NOT NULL,
  sender_wallet TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_note TEXT,
  reviewed_by_user_id TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS crypto_deposit_requests_user_created_idx
  ON crypto_deposit_requests (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS crypto_deposit_requests_status_created_idx
  ON crypto_deposit_requests (status, created_at DESC);

CREATE TABLE IF NOT EXISTS provider_configs (
  id TEXT PRIMARY KEY,
  provider_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'vtu',
  base_url TEXT NOT NULL DEFAULT '',
  is_enabled INTEGER NOT NULL DEFAULT 0,
  has_credentials INTEGER NOT NULL DEFAULT 0,
  sealed_credentials TEXT,
  config TEXT NOT NULL DEFAULT '{}',
  last_tested_at TEXT,
  last_test_ok INTEGER,
  updated_by_user_id TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS service_orders (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenant_sites(id) ON DELETE SET NULL,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  service_type TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled', 'failed')),
  points_charged BIGINT NOT NULL DEFAULT 0 CHECK (points_charged >= 0),
  amount_ngn BIGINT NOT NULL DEFAULT 0 CHECK (amount_ngn >= 0),
  payload TEXT NOT NULL DEFAULT '{}',
  result TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS service_orders_user_created_idx
  ON service_orders (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS service_orders_status_created_idx
  ON service_orders (status, created_at DESC);

CREATE TABLE IF NOT EXISTS background_jobs (
  id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  dedupe_key TEXT UNIQUE,
  payload TEXT NOT NULL DEFAULT '{}',
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts >= 1),
  last_error TEXT,
  run_after TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS background_jobs_ready_idx
  ON background_jobs (status, run_after ASC)
  WHERE status = 'queued';
