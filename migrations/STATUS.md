# Legacy PostgreSQL/Neon Source Inventory & Turso Cutover

## 1. Legacy PostgreSQL/Neon source migrations (`migrations/`)

The Neon migration status below is historical source-database evidence, not evidence that Turso has been provisioned or imported. Turso target migrations are maintained separately in `migrations/turso/` and must be applied to a new test database before the import script can run. Never point the migration runner at production until a private backup, schema coverage, and end-to-end parity checks are complete.

## 2. SQL Migrations (`migrations/`)

All migrations are ordered, transactional, and verified via SHA-256 checksums in `schema_migrations` using `api/scripts/migrate.mjs` (protected by a PostgreSQL session advisory lock).

**Applied to the connected Neon database (`neondb`) on 2026-10-19:** all seven migrations below are recorded in `schema_migrations` with their SHA-256 checksums; re-running `npm run migrate` is a verified no-op (0 applied, 7 up-to-date). The 005 ledger-integrity behavior test (`migrations/tests/005_financial_integrity_test.sql`) passes against this database, and the API was exercised end-to-end against it via `api/scripts/e2e-live.ts`.

1. `001_foundation.sql` — Core identity (`app_users`), tenant hierarchy (`tenant_sites`), wallet ledger (`wallet_ledger`), `platform_settings`, and `schema_migrations` bookkeeping.
2. `002_tenant_banking.sql` — Double-entry tenant banking (`tenant_users`, `tenant_accounts`, `banking_beneficiaries`, `banking_ledger_groups`, `banking_ledger_entries`, `banking_deposits`, `banking_withdrawals`, `banking_transfers`).
3. `003_core_services.sql` — Service subscriptions, logistics (`shipments`, `shipment_events`), documents (`user_documents`), `kyc_records`, `storage_files`, marketplace (`catalog_products`, `commerce_orders`, `commerce_order_items`), and `user_notifications`.
4. `004_auth_fields.sql` — API authentication fields (`password_hash`, `password_changed_at` on `app_users`) and session storage (`api_sessions`).
5. `005_financial_integrity.sql` — Deferred constraint triggers (`cloudie_assert_ledger_group_balanced`) and immutability triggers (`cloudie_prevent_posted_ledger_entry_mutation`) enforcing balanced, append-only posted ledger groups.
6. `006_operations_complete.sql` — RBAC (`roles`, `permissions`, `role_permissions`), `service_prices`, VTU catalog & routing (`vtu_products`, `vtu_routes`), `payment_records`, `crypto_deposit_requests`, `provider_configs`, `service_orders`, and `background_jobs`. Foreign keys reference the actual tables (`app_users`, `tenant_sites`); an earlier revision referenced nonexistent `users`/`tenants` tables and could not apply.
7. `007_admin_audit_logs.sql` — Administrative audit trail (`admin_audit_logs`) used by `recordAuditLog()` and `GET /api/admin/audit-logs` in `api/src/server.ts`. This table was previously referenced by the API but never created by any migration, so audit writes failed silently.

> The migration runner also normalizes legacy bookkeeping tables: databases created before the runner adopted a `filename` column (migration 001 itself creates `schema_migrations` with a `description` column instead) get the `filename` column added additively, with a backfill — no data is dropped or rewritten.

### Running Migrations

```bash
# Dry-run verification (validates order and SHA-256 checksums)
npm run migrate:dry-run

# Apply pending migrations to DATABASE_URL (or TEST_DATABASE_URL)
DATABASE_URL="postgresql://..." npm run migrate

# Verify Convex -> Neon record counts and relational integrity
DATABASE_URL="postgresql://..." npm --prefix api run reconcile

# Run a migration behavior test (self-rolling-back; safe against a shared DB)
node api/scripts/run-migration-test.mjs migrations/tests/005_financial_integrity_test.sql

# Live end-to-end API verification against DATABASE_URL (cleans up its own rows)
cd api && node --import tsx scripts/e2e-live.ts
```

---

## 3. Legacy API route inventory (`api/src/server.ts`)

This is the complete, hand-verified route list as of 2026-10-19 (there are 65 registered handlers including redirects; the distinct paths are below). Financial-write endpoints (`POST /api/admin/users/:id/wallet-adjust` excepted as an admin-only tool) such as VTU purchase, payment verification, deposits, withdrawals, and transfers are intentionally absent until the financial-write gate in `docs/convex-to-neon-cutover-gates.md` is satisfied.

| Area | Routes |
| --- | --- |
| Health | `GET /health`, `GET /ready`, `GET /api/health`, `GET /api/ready` |
| Auth | `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/csrf`, `GET /api/me` |
| Profile | `GET /api/profile`, `PATCH /api/profile` |
| Public config | `GET /api/public-config` |
| Wallet | `GET /api/wallet/summary`, `GET /api/wallet/ledger` |
| Shipments & tracking | `GET /api/shipments`, `GET /api/shipments/:id`, `POST /api/shipments`, `PATCH /api/shipments/:id`, `GET /api/tracking/:trackingNumber` |
| Marketplace | `GET /api/catalog`, `GET /api/orders`, `POST /api/orders` |
| Notifications | `GET /api/notifications`, `POST /api/notifications/:id/read`, `PATCH /api/notifications/:id/read`, `POST /api/notifications/read-all` |
| Documents | `GET /api/documents` |
| Tenants | `GET /api/tenants`, `POST /api/tenants` |
| Admin | `GET /api/admin/users`, `PATCH /api/admin/users/:id`, `POST /api/admin/users/:id/wallet-adjust`, `GET /api/admin/transactions`, `GET /api/admin/audit-logs`, `GET /api/admin/shipments`, `GET|POST /api/admin/settings`, `GET /api/admin/reports`, `POST /api/admin/catalog`, `PATCH /api/admin/catalog/:id`, `DELETE /api/admin/catalog/:id` |

All authenticated routes require a session (Bearer token or `cloudie_session` cookie); admin routes additionally require `role = 'admin'`. Cookie-authenticated state-changing requests are protected by Origin validation and a double-submit CSRF token. See `docs/neon-migration-trace.md` for the remaining Convex functions (373 referenced, 37 modules with no API coverage) that still need endpoints before any cutover.
