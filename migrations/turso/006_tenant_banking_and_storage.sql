-- Additional tenant banking, KYC, storage, and subscription tables from the legacy schema.
ALTER TABLE banking_ledger_groups ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE banking_ledger_groups ADD COLUMN idempotency_key TEXT;
ALTER TABLE banking_ledger_groups ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}';
ALTER TABLE banking_ledger_groups ADD COLUMN posted_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS banking_ledger_groups_idempotency_idx ON banking_ledger_groups(idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS banking_ledger_groups_tenant_reference_idx ON banking_ledger_groups(tenant_id, reference);

ALTER TABLE banking_ledger_entries ADD COLUMN ledger_account_code TEXT NOT NULL DEFAULT 'unspecified';
ALTER TABLE banking_ledger_entries ADD COLUMN description TEXT;

CREATE TABLE IF NOT EXISTS tenant_accounts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenant_sites(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  account_number TEXT NOT NULL, account_name TEXT NOT NULL,
  account_type TEXT NOT NULL DEFAULT 'checking', currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','frozen','closed','pending')),
  balance_minor INTEGER NOT NULL DEFAULT 0,
  available_balance_minor INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, account_number),
  CHECK (available_balance_minor <= balance_minor)
);
CREATE INDEX IF NOT EXISTS tenant_accounts_owner_idx ON tenant_accounts(tenant_id,user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS tenant_accounts_status_idx ON tenant_accounts(tenant_id,status);

CREATE TABLE IF NOT EXISTS banking_beneficiaries (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenant_sites(id) ON DELETE RESTRICT,
  owner_user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  nickname TEXT NOT NULL, account_number TEXT NOT NULL, account_holder_name TEXT,
  account_type TEXT, is_external INTEGER NOT NULL DEFAULT 0,
  bank_name TEXT, routing_number TEXT, swift_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS banking_beneficiaries_owner_idx ON banking_beneficiaries(tenant_id,owner_user_id,created_at DESC);

CREATE TABLE IF NOT EXISTS banking_deposits (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenant_sites(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  account_id TEXT REFERENCES tenant_accounts(id) ON DELETE RESTRICT,
  reference TEXT NOT NULL UNIQUE, amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed','cancelled','reversed')),
  method TEXT NOT NULL, description TEXT, idempotency_key TEXT UNIQUE,
  reconciled_ledger_group_id TEXT REFERENCES banking_ledger_groups(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TEXT
);
CREATE INDEX IF NOT EXISTS banking_deposits_tenant_created_idx ON banking_deposits(tenant_id,created_at DESC);
CREATE INDEX IF NOT EXISTS banking_deposits_user_created_idx ON banking_deposits(user_id,created_at DESC);

CREATE TABLE IF NOT EXISTS banking_withdrawals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenant_sites(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  account_id TEXT NOT NULL REFERENCES tenant_accounts(id) ON DELETE RESTRICT,
  reference TEXT NOT NULL UNIQUE, amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  fee_minor INTEGER NOT NULL DEFAULT 0 CHECK (fee_minor >= 0),
  total_debit_minor INTEGER NOT NULL CHECK (total_debit_minor = amount_minor + fee_minor),
  currency TEXT NOT NULL, destination TEXT, method TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed','cancelled','reversed')),
  description TEXT, idempotency_key TEXT UNIQUE,
  ledger_group_id TEXT REFERENCES banking_ledger_groups(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TEXT
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
  reference TEXT NOT NULL UNIQUE, amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  fee_minor INTEGER NOT NULL DEFAULT 0 CHECK (fee_minor >= 0),
  total_debit_minor INTEGER NOT NULL CHECK (total_debit_minor = amount_minor + fee_minor),
  currency TEXT NOT NULL, transfer_type TEXT NOT NULL DEFAULT 'internal' CHECK (transfer_type IN ('internal','external')),
  destination_details TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed','cancelled','reversed')),
  idempotency_key TEXT UNIQUE,
  ledger_group_id TEXT REFERENCES banking_ledger_groups(id) ON DELETE RESTRICT,
  description TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TEXT,
  CHECK (source_account_id <> destination_account_id)
);
CREATE INDEX IF NOT EXISTS banking_transfers_tenant_created_idx ON banking_transfers(tenant_id,created_at DESC);
CREATE INDEX IF NOT EXISTS banking_transfers_sender_created_idx ON banking_transfers(sender_user_id,created_at DESC);

CREATE TABLE IF NOT EXISTS service_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  service_key TEXT NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','paused','cancelled','provisioning')),
  resource_id TEXT, resource_label TEXT, plan_label TEXT, usage_label TEXT,
  renewal_at TEXT, metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS service_subscriptions_user_updated_idx ON service_subscriptions(user_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS service_subscriptions_user_status_idx ON service_subscriptions(user_id,status,updated_at DESC);

CREATE TABLE IF NOT EXISTS kyc_records (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenant_sites(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('submitted','under_review','approved','rejected','resubmission_required')),
  full_name TEXT NOT NULL, date_of_birth TEXT, document_storage_key TEXT, document_name TEXT,
  resubmission_count INTEGER NOT NULL DEFAULT 0 CHECK (resubmission_count >= 0),
  rejection_reason TEXT, notes TEXT, reviewed_by TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  reviewed_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS kyc_tenant_created_idx ON kyc_records(tenant_id,created_at DESC);
CREATE INDEX IF NOT EXISTS kyc_user_created_idx ON kyc_records(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS kyc_status_created_idx ON kyc_records(status,created_at DESC);

CREATE TABLE IF NOT EXISTS storage_files (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  storage_provider TEXT NOT NULL, storage_key TEXT NOT NULL, original_name TEXT NOT NULL,
  mime_type TEXT, size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','tenant','public')),
  tenant_id TEXT REFERENCES tenant_sites(id) ON DELETE RESTRICT,
  metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(storage_provider,storage_key)
);
CREATE INDEX IF NOT EXISTS storage_files_owner_created_idx ON storage_files(owner_user_id,created_at DESC);
