# Cloudie Turso API

The Hono API is exposed as a Vercel Node.js catch-all function at `api/[...path].ts`. The API now uses `@libsql/client` through `api/src/db.ts`; it no longer requires a PostgreSQL driver or `DATABASE_URL`. Local development can still run the same Hono app as a Node server.

## Vercel configuration

Set these server-side environment variables in Vercel Preview and Production:

- `TURSO_DATABASE_URL` — the libSQL database URL, such as `libsql://<database>-<org>.turso.io`.
- `TURSO_AUTH_TOKEN` — database access token.
- `JWT_SECRET` — random secret with at least 32 bytes.
- `CORS_ORIGINS` — comma-separated exact browser origins.
- `FRONTEND_URL` — canonical frontend origin.

Do not prefix database credentials or JWT secrets with `VITE_`. Deploy the repository root on Vercel; `vercel.json` builds the Vite frontend and Vercel routes `/api/*` to the catch-all function. `GET /api/turso-health` is a read-only connectivity probe.

## One-time data migration from PostgreSQL/Neon

The application runtime does not use PostgreSQL. The `pg` dependency remains only for the one-time import utility.

1. Create the complete Turso schema with `npm run migrate:turso` against a **new, empty test database**.
2. Set `SOURCE_DATABASE_URL` to the legacy PostgreSQL/Neon source, and `TURSO_DATABASE_URL` plus `TURSO_AUTH_TOKEN` to the Turso target.
3. Run a read-only schema/count plan first:
   ```bash
   npm run migrate:postgres-to-turso
   ```
4. If the plan reports full column coverage and expected row counts, create a private local backup and run the resumable import:
   ```bash
   npm run migrate:postgres-to-turso:apply -- --backup=/secure/private/cloudie-postgres-export-2026-10-28.json
   ```

The apply command refuses to run without an explicit backup path. It creates the backup file with restrictive permissions, checks all shared source columns exist in Turso, imports parent tables before child tables, and never deletes source rows or clears target tables. Keep the backup outside the repository and never commit it. If a table/column is missing, the script fails closed; add and apply a reviewed Turso migration before retrying. It does not migrate Convex-only records or prove feature parity by itself.

## Local development

1. Use Node.js 20+.
2. Set `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, a random `JWT_SECRET` (32+ bytes), and explicit `CORS_ORIGINS`.
3. Apply the ordered Turso migrations to a **test** database first:
   ```bash
   npm run migrate:turso:dry-run
   npm run migrate:turso
   ```
4. Run the API locally with `npm --prefix api run dev`.
5. Verify with `npm --prefix api run typecheck` and `npm --prefix api test`.

## API routes currently implemented

- Health: `GET /health`, `GET /ready`, `GET /api/health`.
- Public configuration: `GET /api/public-config`.
- Authentication/session: `GET /api/auth/csrf`, `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/me`.
- Profile: `GET/PATCH /api/profile`.
- Wallet reads: `GET /api/wallet/summary`, `GET /api/wallet/ledger`.
- Shipments/tracking: `GET/POST /api/shipments`, `GET/PATCH /api/shipments/:id`, `GET /api/tracking/:trackingNumber`.
- Catalog/orders: `GET /api/catalog`, `GET/POST /api/orders`.
- Notifications/documents: `GET /api/notifications`, `POST/PATCH /api/notifications/:id/read`, `POST /api/notifications/read-all`, `GET /api/documents`.
- Tenant portals: `GET/POST /api/tenants`.
- Admin: user management, wallet adjustment, transactions/audit logs, shipment and catalog management, settings, reports, and analytics routes.

## Migration safety and known remaining work

- The frontend still imports Convex authentication and Convex data hooks. It has **not** completed the customer-facing cutover to this API.
- `migrations/turso/001` through `007` create the Turso target schema for identity, tenant, wallet, support, logistics, marketplace, banking, KYC/storage, provider configuration, payments, jobs, and audit data. The migration runner and local libSQL schema application are covered by CI, but no live Turso database or source-data import has been verified.
- SQLite uses immediate triggers rather than PostgreSQL deferred constraint triggers; ledger invariant parity must be tested against adversarial cases before enabling banking/financial writes.
- No live Turso migration, Convex data export/import, production Vercel deployment, or end-to-end customer workflow has been verified by this repository edit alone.
- Do not delete the legacy Convex data or switch real customer traffic until frontend feature parity, authentication/session migration, provider workflows, tenant isolation, idempotency, ledger balancing, and staging verification are complete.
- Public registration only creates the ordinary user role. Admin assignment must remain a controlled operator action.
- Cookie-authenticated state changes use origin validation and a CSRF double-submit token. Keep the frontend/API on HTTPS and configure only exact trusted origins.
