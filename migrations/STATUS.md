# Neon migration status

Last updated: 2026-10-17

## Implemented in repository
- `001_foundation.sql`: user identity records, tenant sites, wallet ledger, settings, migration bookkeeping.
- `002_tenant_banking.sql`: tenant membership, accounts, beneficiaries, deposits, withdrawals, transfers, and ledger groups/entries.
- `003_core_services.sql`: service subscriptions, shipments/events, user documents, KYC, file metadata, catalog, orders/items, notifications.
- `002_tenant_banking.md`: banking invariants and operational cautions.
- `README.md`: migration safety and hosting constraints.

## Development database validation
The migrations' DDL has been applied to a **separate Neon test branch** named `cloudie-neon-migration-test` (`br-ancient-violet-b4ribqi8`) for the Cloudie project. The database inspection returned 23 public base tables, including the banking and core service tables.

This is schema smoke validation only. It is not yet proof of application compatibility, authentication parity, financial correctness, or data migration. No SQL was applied to the production `production` branch.

## Not yet migrated
- Convex query/mutation/action logic and frontend data hooks.
- Authentication/session flows and authorization enforcement.
- Atomic balance updates, transaction processing, webhook signature/replay checks, and ledger balancing enforcement.
- Existing Convex data export/import and record-count/reconciliation checks.
- Automated integration tests and production API deployment.

## Required next work
1. Add a server-side API runtime and database access layer. Keep Neon credentials server-side; never expose them through `VITE_*`.
2. Implement authentication and tenant/admin authorization before exposing any data endpoint.
3. Implement all financial writes in transactions with idempotency and double-entry balance enforcement.
4. Add automated tests for permissions, duplicate requests, concurrent debits, rollback, and reconciliation.
5. Migrate data and compare counts and balances in a shadow run before planning cutover.
6. Keep Convex live until parity is demonstrated and rollback has been rehearsed.

InfinityFree can host the static Vite build, but not the server-side Node API required for secure Neon access. The API must be hosted separately.
