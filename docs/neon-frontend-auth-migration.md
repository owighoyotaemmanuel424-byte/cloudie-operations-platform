# Neon frontend authentication migration

## Current implementation

- `api/src/server.ts` returns the 8-hour JWT in the JSON body for registration and login as well as setting the HttpOnly cookie.
- `src/lib/neonApi.ts` is the typed fetch client for registration, login, current-user checks, logout, tenants, admin users, and wallet ledger.
- `src/hooks/use-neon-auth.ts` provides React state around the client.
- Existing `use-auth`, Convex auth providers, page-level Convex queries, and admin gates remain unchanged intentionally. This keeps the existing application working while data services are migrated in controlled steps.

## Required frontend configuration

Set the Vite build variable:

```dotenv
VITE_NEON_API_URL=https://cloudie-operations-api-stage.onrender.com
```

For a production deployment, use the production API URL instead. Vite variables are public and must never contain database credentials, JWT signing secrets, or provider API keys.

Configure the API `CORS_ORIGINS` environment variable with the exact frontend origin, without a trailing slash, for example `https://cloudie.wuaze.com`.

## Authentication transport and security

The browser frontend is hosted on a different site from the Render API. Cross-site cookies can be blocked by browser privacy protections, especially Safari. The client therefore uses a short-lived API JWT returned in the login/register JSON and stores it in `sessionStorage`, then sends it as a Bearer token. It is scoped to the browser tab session, but JavaScript-accessible tokens can be exposed by an XSS vulnerability. Keep strict CSP/XSS protections and avoid injecting untrusted HTML. For stronger long-term production security, put the API behind a same-origin reverse proxy or a custom API hostname under the frontend's registrable domain and use an HttpOnly cookie session.

The API must continue to enforce authorization server-side. A frontend role check is for navigation only, never a security boundary. Registration can create only the ordinary `user` role.

## Staged rollout checklist

1. Build and test this client in CI.
2. Set `VITE_NEON_API_URL` in the frontend build environment.
3. Exercise registration/login/current-user/logout against staging from the actual deployed frontend origin.
4. Migrate auth pages and route guards only after compatibility testing. Existing app pages still consume Convex data and must not be treated as fully Neon-backed.
5. Port each data domain to explicit API endpoints and database-backed UI before removing Convex. Never migrate financial write actions without idempotency, authorization, audit logs, and transaction tests.
6. Rotate any JWT secret or session tokens that were exposed in chat or logs.

## API coverage in the current staging scaffold

Implemented: health, registration, login, logout, current user, tenant listing, admin user listing, wallet ledger listing.

Not yet implemented: password reset for the Neon identity system, user/profile mutation, tenant write operations, wallet deposits/withdrawals/credits/debits, order/VTU/shipment/document writes, admin configuration writes, and realtime messaging. Those features remain on their existing backend until their APIs and migration tests exist.
