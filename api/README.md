# Cloudie Neon API (migration/shadow runtime)

This is a separate Node.js API service for a gradual Convex-to-Neon migration. It is not yet wired into the customer UI and must not be treated as a production replacement.

## Run locally
1. Use Node.js 20+.
2. Copy `.env.example` to `.env` and configure a **test** Neon branch URL, a random `JWT_SECRET` (32+ bytes), and explicit `CORS_ORIGINS`.
3. Apply `../migrations/004_auth_sessions.sql` to the test branch.
4. `npm install`, `npm run dev`.

Health: `GET /health`. API routes: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/me`, `GET /api/tenants`, `GET /api/admin/users`, `GET /api/wallet/ledger`.

## Deploy
Deploy this folder as a Node web service on Render or another Node host. Set `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGINS`, and `NODE_ENV=production`. Never expose database credentials or the JWT secret as `VITE_*` variables.

## Security status and limitations
- Registration can create only the ordinary `user` role. Never expose role assignment or admin bootstrap to public registration.
- Cookies are HttpOnly and Secure in production; API calls should use same-origin proxying or credentialed CORS with a strict origin allowlist.
- This initial service does not yet implement email verification, password reset, persistent revocable sessions, rate limiting, tenant-site creation, wallet mutations, banking transfers, webhook processing, or Convex data import.
- A signed JWT is stateless until expiration. Production hardening must add persistent session revocation, login/register rate limits, CSRF protection for cookie-authenticated mutations, and monitoring.
- This API uses the new Neon auth columns; existing Convex users are not automatically migrated or able to log in here until credential migration is designed and verified.
- Financial write endpoints are intentionally absent. Do not enable live money movement until ledger-balancing, concurrency and idempotency tests pass.
