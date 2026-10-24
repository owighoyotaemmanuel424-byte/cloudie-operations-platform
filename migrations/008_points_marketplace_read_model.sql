-- Dedicated points marketplace read model.
-- Additive only: existing catalog, commerce orders, wallets, and production data are untouched.
-- Convex IDs are retained as TEXT identifiers during the reconciliation period.

CREATE TABLE IF NOT EXISTS point_market_vendors (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  business_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','suspended')),
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS point_market_vendors_owner_idx
  ON point_market_vendors(owner_user_id);
CREATE INDEX IF NOT EXISTS point_market_vendors_status_idx
  ON point_market_vendors(status);

CREATE TABLE IF NOT EXISTS point_market_packages (
  id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL REFERENCES point_market_vendors(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  points BIGINT NOT NULL CHECK (points > 0),
  price_minor BIGINT NOT NULL CHECK (price_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  total_sold BIGINT NOT NULL DEFAULT 0 CHECK (total_sold >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS point_market_packages_active_idx
  ON point_market_packages(is_active, created_at DESC);
CREATE INDEX IF NOT EXISTS point_market_packages_vendor_idx
  ON point_market_packages(vendor_id);
