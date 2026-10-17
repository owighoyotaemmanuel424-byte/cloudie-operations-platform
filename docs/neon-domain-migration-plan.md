# Neon domain migration plan

## Baseline

The Neon API is a parallel migration service. Existing customer and admin pages still use Convex. Do not remove Convex providers, generated API bindings, or route guards until each domain has an equivalent Neon API and has passed migration tests.

## Phase 1 — Identity and sessions

- [x] Typed browser client for register, login, current-user, logout, tenant reads, admin-user reads, and wallet-ledger reads.
- [x] Server-side session records and revocation.
- [x] Public registration can create only the ordinary user role.
- [ ] Decide and implement the password-reset/credential migration strategy before switching existing users.
- [ ] Prefer a same-origin API proxy and HttpOnly cookie before treating the browser-token flow as the production security baseline.
- [ ] Add rate limiting for login and registration using a shared store, not process-local counters.
- [ ] Run browser-origin smoke tests against the deployed frontend and staging API.

Exit criteria: existing sign-in, sign-up, password reset, logout, and protected-route behavior are all covered by tests and verified against staging.

## Phase 2 — Customer read models

Implement explicit, paginated API routes for profile, tenant membership, catalog, orders, wallet summary, wallet ledger, notifications, and support conversations. Every query must derive the customer identity from the validated session; never trust a client-supplied user ID for customer-scoped data.

For each domain:
1. Map the existing Convex schema and queries.
2. Add a migration or compatibility view where needed.
3. Add API validation and ownership checks.
4. Add integration tests for authorized, unauthorized, missing, and pagination cases.
5. Add a frontend adapter and loading/error/empty states.
6. Verify the domain in staging before switching the page.

## Phase 3 — Admin operations

- Enforce admin role on the server for every admin route.
- Add audit records for sensitive changes, recording actor, target, action, reason, request ID, and timestamp.
- Add pagination, filtering, and bounded result sizes.
- Require explicit confirmation and a reason for account status and configuration changes.
- Do not allow the public registration endpoint to assign admin or vendor roles.

Exit criteria: role-based API tests prove ordinary users cannot access admin data or perform admin mutations.

## Phase 4 — Financial integrity

Wallet operations must not be exposed as simple balance updates. Build them only after the actual schema and invariants are confirmed.

Required controls:
- Integer minor-unit amounts; reject zero, negative, non-finite, and out-of-range values.
- Database transaction with row-level locking or an equivalent concurrency-safe update.
- Idempotency key with a unique database constraint and replay-safe response.
- Immutable ledger entries and balanced ledger groups; corrections use compensating entries.
- Server-side authorization, explicit actor/target distinction, reason, and audit trail.
- No overdrafts unless the product's approved rules explicitly permit them.
- Tests for concurrent debits, retries, duplicate keys, insufficient balance, rollback, and unauthorized callers.
- Reconciliation and alerting before production financial use.

Never credit or debit a real account from a test endpoint, browser-only check, or manual SQL shortcut. Keep write routes disabled until the transaction and schema tests pass.

## Phase 5 — Provider-backed services and operations

Migrate catalog, VTU/service purchases, shipments, document workflows, settings, webhooks, and messaging one domain at a time. Provider secrets remain server-side. Use signed webhook verification, replay protection, durable jobs, retries, and idempotency for provider operations.

## Phase 6 — Cutover and retirement

- Run a read-only shadow comparison between Convex and Neon for agreed data sets.
- Back up data and document rollback steps.
- Switch one feature flag/domain at a time.
- Monitor errors, latency, authorization failures, and reconciliation.
- Remove old Convex paths only after production verification and a rollback window.
- Keep a documented recovery path for accounts and password resets.

## Deployment checklist

- [ ] Neon migration files applied to the intended environment and reviewed.
- [ ] API build and frontend build pass in CI.
- [ ] Staging smoke checks pass from the real frontend origin.
- [ ] CORS contains only exact trusted origins.
- [ ] Secrets exist only in server-side environment variables.
- [ ] Backups, monitoring, rate limiting, and rollback are verified.
- [ ] No financial writes enabled until all financial integrity criteria are met.
