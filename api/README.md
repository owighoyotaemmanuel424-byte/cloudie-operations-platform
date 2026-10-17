# Cloudie Neon API (migration/shadow runtime)

This is a separate Node.js API service for a gradual Convex-to-Neon migration. It is not yet wired into the customer UI and must not be treated as a production replacement.

## Local development
1. Use Node.js 20+.
2. Copy `.env.example` to `.env`; use a **test** Neon branch URL, a random `JWT_SECRET` (32+ bytes), and explicit `CORS_ORIGINS`.
3. Apply `../migrations/001_foundation.sql`, `002_tenant_banking.sql`, `003_core_services.sql`, `004_auth_fields.sql`, and `005_financial_integrity.sql` to the test branch.
4. Run `npm install`, `npm run build`, then `npm start` (or `npm run dev`).
5. Run smoke checks with `API_BASE_URL=http://localhost:8787 node scripts/smoke.mjs`. The smoke script verifies database health, unauthenticated access rejection for protected routes, and rejection of invalid registration input.

## API routes

- Health: `GET /health` and `GET /api/health`.
- Authentication: `GET /api/auth/csrf`, `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`.
- Session and customer reads: `GET /api/me`, `GET /api/profile`, `GET /api/tenants`, `GET /api/notifications`, `GET /api/orders`, `GET /api/catalog`.
- Admin read: `GET /api/admin/users` (administrator only).
- Wallet history: `GET /api/wallet/ledger` (the signed-in user's own entries only).

The notifications, orders, and catalog list endpoints accept a bounded `limit` query parameter (maximum 100). `GET /api/tenants` uses its fixed server-side limit. Catalog tenant filtering requires the current user to own or belong to that tenant, unless the user is an administrator.

## Deployment
A Render Blueprint is provided in the repository root at `render.yaml`. Review it before deployment, then set `DATABASE_URL` to the Neon **test** branch first and verify the health endpoint. Set `CORS_ORIGINS` to the exact frontend origin. Never expose database credentials or JWT secrets as `VITE_*` variables.

## Security and parity status
- Public registration creates only the ordinary `user` role. It does not accept a role, tenant, wallet balance, or admin flag from the client.
- Passwords use Node scrypt with random salts; the session cookie is HttpOnly, SameSite=Lax, Secure in production, and expires after eight hours. Session IDs are persisted in Neon, checked on authenticated requests, and revoked on logout. The separate frontend migration client currently stores a bearer token in sessionStorage; prefer a same-origin proxy with HttpOnly cookies before switching the production UI.
- Unsafe requests reject untrusted origins. Cookie-authenticated state changes additionally require a matching `cloudie_csrf` cookie and `X-CSRF-Token` header; `GET /api/auth/csrf` issues a token cookie without returning its value in JSON. Bearer-token clients remain supported during the incremental migration. Cookie-only browser sessions require a same-origin gateway and the frontend must copy the readable CSRF cookie into the header. Keep the frontend and API on HTTPS.
- This initial service does not yet implement email verification, password reset, distributed rate limiting, tenant-site creation, wallet mutations, banking transfers, provider webhooks, or Convex data import.
- Existing Convex users are not automatically migrated and cannot use the new API until credential migration is designed and verified.
- Admin creation must be a controlled operator action; never add admin assignment to public registration.
- Financial write endpoints are intentionally absent. Migration 005 enforces deferred per-currency balance, entry-to-group currency matching, tenant matching, and posted-ledger immutability. Do not enable live money movement until ledger balancing, concurrency, idempotency, reconciliation, and authorization tests pass.
- Production launch requires dependency installation/build, smoke tests against the staging service, security review, and staged data migration. Repository changes alone do not mean the API has been deployed or that the customer UI has been migrated.
