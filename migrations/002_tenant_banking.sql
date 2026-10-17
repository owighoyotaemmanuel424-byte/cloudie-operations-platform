-- Cloudie Neon migration phase 2: tenant banking and double-entry ledger.
-- Additive only; apply to a temporary Neon branch and test before any production use.
BEGIN;

CREATE TABLE IF NOT EXISTS tenant_users (
  tenant_id TEXT NOT NULL REFERENCES tenant_sites(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  role TEXT NOT NULL DEFAULT 'customer',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, user_id)
);
CREATE INDEX IF NOT EXISTS tenant_users_user_idx ON tenant_users(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tenant_accounts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenant_sites(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  account_number TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_type TEXT NOT NULL DEFAULT 'checking',
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','frozen','closed','pending')),
  balance_minor BIGINT NOT NULL DEFAULT 0,
  available_balance_minor BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, account_number),
  CHECK (available_balance_minor <= balance_minor)
);
CREATE INDEX IF NOT EXISTS tenant_accounts_owner_idx ON tenant_accounts(tenant_id,user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS tenant_accounts_status_idx ON tenant_accounts(tenant_id,status);

CREATE TABLE IF NOT EXISTS banking_beneficiaries (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenant_sites(id) ON DELETE RESTRICT,
  owner_user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  nickname TEXT NOT NULL,
  account_number TEXT NOT NULL,
  account_holder_name TEXT,
  account_type TEXT,
  is_external BOOLEAN NOT NULL DEFAULT FALSE,
  bank_name TEXT,
  routing_number TEXT,
  swift_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS banking_beneficiaries_owner_idx ON banking_beneficiaries(tenant_id,owner_user_id,created_at DESC);

CREATE TABLE IF NOT EXISTS banking_ledger_groups (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenant_sites(id) ON DELETE RESTRICT,
  reference TEXT NOT NULL,
  description TEXT NOT NULL,
  currency CHAR(3) NOT NULL,
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('draft','posted','reversed')),
  idempotency_key TEXT UNIQUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  posted_at TIMESTAMPTZ,
  UNIQUE (tenant_id,reference)
);

CREATE TABLE IF NOT EXISTS banking_ledger_entries (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ledger_group_id TEXT NOT NULL REFERENCES banking_ledger_groups(id) ON DELETE RESTRICT,
  tenant_id TEXT NOT NULL REFERENCES tenant_sites(id) ON DELETE RESTRICT,
  account_id TEXT REFERENCES tenant_accounts(id) ON DELETE RESTRICT,
  ledger_account_code TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('debit','credit')),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency CHAR(3) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS banking_entries_group_idx ON banking_ledger_entries(ledger_group_id);
CREATE INDEX IF NOT EXISTS banking_entries_tenant_created_idx ON banking_ledger_entries(tenant_id,created_at DESC);
CREATE INDEX IF NOT EXISTS banking_entries_account_created_idx ON banking_ledger_entries(account_id,created_at DESC);

CREATE TABLE IF NOT EXISTS banking_deposits (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenant_sites(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  account_id TEXT REFERENCES tenant_accounts(id) ON DELETE RESTRICT,
  reference TEXT NOT NULL UNIQUE,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency CHAR(3) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed','cancelled','reversed')),
  method TEXT NOT NULL,
  description TEXT,
  idempotency_key TEXT UNIQUE,
  reconciled_ledger_group_id TEXT REFERENCES banking_ledger_groups(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS banking_deposits_tenant_created_idx ON banking_deposits(tenant_id,created_at DESC);
CREATE INDEX IF NOT EXISTS banking_deposits_user_created_idx ON banking_deposits(user_id,created_at DESC);

CREATE TABLE IF NOT EXISTS banking_withdrawals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenant_sites(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  account_id TEXT NOT NULL REFERENCES tenant_accounts(id) ON DELETE RESTRICT,
  reference TEXT NOT NULL UNIQUE,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  fee_minor BIGINT NOT NULL DEFAULT 0 CHECK (fee_minor >= 0),
  total_debit_minor BIGINT NOT NULL CHECK (total_debit_minor = amount_minor + fee_minor),
  currency CHAR(3) NOT NULL,
  destination TEXT,
  method TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed','cancelled','reversed')),
  description TEXT,
  idempotency_key TEXT UNIQUE,
  ledger_group_id TEXT REFERENCES banking_ledger_groups(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS banking_withdrawals_tenant_created_idx ON banking_withdrawals(tenant_id,created_at DESC);
CREATE INDEX IF NOT EXISTS banking_withdrawals_user_created_idx ON banking_withdrawals(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS banking_withdrawals_account_created_idx ON banking_withdrawals(account_id,created_at DESC);

CREATE TABLE IF NOT EXISTS banking_transfers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenant_sites(id) ON DELETE RESTRICT,
  sender_user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  source_account_id TEXT NOT NULL REFERENCES tenant_accounts(id) ON DELETE RESTRICT,
  destination_account_id TEXT REFERENCES tenant_accounts(id) ON DELETE RESTRICT,
  reference TEXT NOT NULL UNIQUE,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  fee_minor BIGINT NOT NULL DEFAULT 0 CHECK (fee_minor >= 0),
  total_debit_minor BIGINT NOT NULL CHECK (total_debit_minor = amount_minor + fee_minor),
  currency CHAR(3) NOT NULL,
  transfer_type TEXT NOT NULL DEFAULT 'internal' CHECK (transfer_type IN ('internal','external')),
  destination_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed','cancelled','reversed')),
  idempotency_key TEXT UNIQUE,
  ledger_group_id TEXT REFERENCES banking_ledger_groups(id) ON DELETE RESTRICT,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CHECK (source_account_id <> destination_account_id)
);
CREATE INDEX IF NOT EXISTS banking_transfers_tenant_created_idx ON banking_transfers(tenant_id,created_at DESC);
CREATE INDEX IF NOT EXISTS banking_transfers_sender_created_idx ON banking_transfers(sender_user_id,created_at DESC);

COMMIT;

-- Important application invariant:
-- every posted ledger group must have at least two entries and total debits == total credits
-- for each currency. Enforce this in a single server-side transaction (or a deferred
-- constraint trigger) before allowing production financial writes.
