# Neon migration status

Last updated: 2026-10-17

## Implemented in repository
- `001_foundation.sql`: users, tenant sites, wallet ledger, settings, migration bookkeeping.
- `002_tenant_banking.sql`: tenant membership, accounts, beneficiaries, deposits, withdrawals, transfers, double-entry ledger records.
- `003_core_services.sql`: subscriptions, shipments/events, documents, KYC, file metadata, catalog, orders/items, notifications.
- `004_auth_fields.sql`: password hash, password-change timestamp, and persistent revocable API sessions.
- `005_financial_integrity.sql`: deferred double-entry balance checks per currency, entry-to-group currency and tenant consistency, and immutability for posted ledger groups; applied and revalidated on the isolated Neon test branch.
- `migrations/tests/005_financial_integrity_test.sql`: rollback-only behavior test for balanced posting, rejection of an unbalanced posting, posted-entry update/insert immutability, and rejection of entries whose currency differs from the ledger-group currency.
- `api/src/server.ts`: initial Hono/Node API with health, registration/login/logout, current-user, tenant listing, admin user listing, and read-only wallet ledger endpoints.
- `api/scripts/migrate.mjs` and `npm run migrate`: ordered SQL migration runner with a PostgreSQL advisory lock, SHA-256 checksums, applied-version tracking, and explicit safety warnings.
- `api/package.json`, `api/tsconfig.json`, `api/.env.example`, `api/README.md`: API runtime configuration and operator instructions.
- `api/scripts/smoke.mjs`: HTTP smoke checks for health and protected endpoints.
- `render.yaml`: Render Blueprint for hosting the separate Node API.
- Root README links the migration status and explicitly retains Convex as production backend.

## Development database validation
The initial schema was applied to a **separate Neon test branch** named `cloudie-neon-migration-test` (`br-ancient-violet-b4ribqi8`). Database inspection confirmed 24 public base tables, including the persistent session table. The authentication columns and `api_sessions` table in migration 004 were also added successfully on that test branch. No SQL was applied to the production branch.

Migrations 001–004 and migration 005's DDL have been applied to the isolated Neon test branch. The test branch was reconfigured to use a draft default for ledger groups and to reject inserts, updates, or deletes on posted ledger groups. The rollback-only SQL behavior test passed, including balanced posting, unbalanced rejection, mismatched group currency, and posted-entry update/insert rejection. The API TypeScript build has passed on the latest code; repository CI is running. This is not a substitute for full application-level transaction and concurrency tests. The API HTTP smoke script has not been run against a deployed service; authentication parity, financial correctness, and data migration remain unverified.

## API scope and safety
- Public registration can create only normal `user` accounts; role assignment is not accepted from the client.
- Passwords use Node scrypt; eight-hour JWT cookies are backed by persistent Neon sessions and logout revocation. Registration creates the user and session in one transaction; login performs scrypt verification for unknown accounts and uses generic failures for disabled accounts.
- Exact Origin allowlist checks are in place for unsafe requests. PostgreSQL TLS decisions are based on the parsed hostname, not arbitrary connection-string text; graceful shutdown waits for in-flight HTTP requests.
- API routes are a shadow scaffold and are **not connected to the existing frontend**.
- There are intentionally no wallet or banking write endpoints yet.
- Existing Convex users are not automatically migrated and cannot log in to this API until credential migration is designed and tested.

## Remaining before production
1. Finish repository CI and run HTTP smoke tests against a deployed staging API.
2. Add distributed rate limiting, email verification/password reset, monitoring, and a full security review.
3. Build tenant and admin management operations with strict authorization and audit logs.
4. Implement atomic financial operations with idempotency, double-entry balancing, concurrency protection, webhook verification, and reconciliation tests.
5. Migrate Convex records through an audited export/import; compare counts and wallet balances.
6. Connect frontend feature-by-feature and run parity tests in staging.
7. Deploy the API against a staging database and rehearse rollback before any production cutover.

InfinityFree can host the static Vite build, but cannot run the server-side Node API required for secure Neon access. The API must be hosted separately. Keep Convex live until parity is demonstrated.
