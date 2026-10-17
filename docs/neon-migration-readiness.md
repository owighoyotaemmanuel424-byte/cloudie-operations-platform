# Neon migration readiness — Cloudie Operations Platform

## Current architecture (verified from the repository)

- Frontend: Vite + React; production output is `dist/`.
- Backend: Convex. The application imports `convex`, `@convex-dev/auth`, uses `src/convex/schema.ts`, and has Convex functions across auth, wallet, payments, banking, shipments, marketplace, documents, email, and VTU.
- Database: the Neon project `cloudie` (`weathered-pond-36240742`) has a production branch and a `neondb` database, but no application tables were found during inspection.
- Hosting: InfinityFree can serve the built static frontend, but it cannot run a persistent Node.js backend. Keeping Convex is currently required for the app to function there.

## Important safety decision

Do not point the live frontend at Neon or remove Convex yet. Creating a PostgreSQL database does not migrate Convex functions, auth, scheduled jobs, file storage, or business logic. An empty database plus a changed environment variable would break authentication and application workflows.

## Recommended migration sequence

### Phase 0 — Preserve the working deployment

1. Keep the current Convex production deployment and its secrets intact.
2. Keep the existing `VITE_CONVEX_URL` configuration for the deployed frontend.
3. Never put database credentials, provider API keys, or deployment keys in `VITE_*` variables or static files.

### Phase 1 — Provision and verify Neon

1. Authenticate the Neon CLI with `neon login` if the CLI requests it.
2. Use project `weathered-pond-36240742`, organization `org-blue-pond-15060024`, production branch `production`, database `neondb`.
3. Retrieve the connection string through the Neon CLI or Neon Console. Store it only as a server-side secret such as `DATABASE_URL`; do not commit it.
4. Run read-only checks first: confirm the database name, PostgreSQL version, and whether application tables exist.
5. Do not run destructive SQL against production during initial setup.

### Phase 2 — Build the replacement backend before switching traffic

The repository is not a Prisma/Next.js application today. A real migration requires an explicit backend implementation and data model, not just installing Prisma. Inventory and migrate each Convex area in a controlled order:

1. Identity and authorization: users, sessions, roles, admin access, account suspension.
2. Core customer data: tenants, subscriptions, catalog, files, support, notifications.
3. Financial integrity: wallets, ledger entries, deposits, withdrawals, transfers, idempotency, payment verification and webhook replay protection.
4. VTU and provider integrations: catalog sync, purchases, reconciliation, refunds, provider credentials.
5. Logistics: shipments, tracking events, locations, routes.
6. Documents and email: uploads, templates, generated artifacts, delivery queue and retries.
7. Scheduled jobs, rate limits, audit logs, and operational health checks.

Use SQL migrations checked into version control. Use foreign keys, unique constraints, database transactions, and idempotency keys for money-moving operations. Never copy secret values into migration files or logs.

### Phase 3 — Validate parity

- Add automated tests for authorization, tenant isolation, and each migrated business workflow.
- Test wallet and banking flows with a test environment and synthetic data only.
- Verify payment signatures server-side and ensure webhook retries cannot double-credit balances.
- Compare record counts and sampled records before any data cutover.
- Run a staging deployment and smoke tests before switching production traffic.

### Phase 4 — Cut over and retire Convex only after verification

- Take a verified backup/export and define a rollback window.
- Migrate data with reconciliation reports.
- Switch the frontend only when the new backend exposes all required APIs and the tests pass.
- Keep the Convex deployment available during the rollback window. Remove it only after production verification and explicit approval.

## Deployment constraint

For `cloudie.wuaze.com` on InfinityFree, keep the frontend static and use a remotely hosted backend. If the goal is to replace Convex with a custom Node.js API backed by Neon, deploy that API on a Node-capable host; InfinityFree cannot host the required Node server. The static frontend can then call that API, subject to CORS and authentication configuration.

## Current status

- [x] Repository architecture inspected.
- [x] Neon project and production branch identified.
- [x] Database inspected; no application tables found.
- [ ] Neon connection tested from the application runtime.
- [ ] Replacement API implemented.
- [ ] Convex functions and data migrated.
- [ ] Automated tests and production cutover completed.
