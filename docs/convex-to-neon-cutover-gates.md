# Cloudie Convex-to-Neon Migration: Cutover Gates

**Status: partial migration; not production-complete.** This document is the operational source of truth for safe cutover. Passing CI for the migration scaffold does not imply the application has moved off Convex.

## Verified repository state

- PR #8 merged: authenticated Neon read APIs for profile, notifications, orders, and catalog.
- PR #9 merged: API smoke coverage and API documentation. On its latest checked head `08a5c29105bc7d082668231c74207e6213ba8eff`, the GitHub CI workflow completed successfully, Neon API CI completed successfully, and CodeRabbit and Vercel status checks were successful.
- Existing app entry point still wraps the app in `ConvexAuthProvider`; `src/hooks/use-auth.ts` uses Convex Auth and `api.users.currentUser`; `src/pages/Auth.tsx` uses Convex sign-in and the `api.admin.initializeUser` mutation.
- `src/lib/neonApi.ts` and `src/hooks/use-neon-auth.ts` are separate incremental migration scaffolding. They are not wired into the existing route tree.
- API routes currently include health, register/login/logout, current user, tenant list, admin user list, wallet ledger, profile, notifications, orders, and catalog. This is not parity with the full Convex app.
- The API is deployed as a staging service and must be checked live before any production cutover. Do not assume a GitHub build proves the deployed service or database schema is current.

## Session transport decision — production cutover blocked

The current client uses a cross-origin Render API URL, returns a bearer token in the JSON response, and stores it in `sessionStorage`. This is JavaScript-readable and vulnerable to token theft if an XSS flaw exists. Cross-site cookies may also be blocked by browser privacy protections.

Preferred production design:
1. Route browser API traffic through a same-origin HTTPS path (for example, `/api/*`) using a reverse proxy or server-side gateway that forwards to the private API origin. The current static InfinityFree hosting must not be assumed to support such a proxy; verify hosting capabilities or move the frontend to a platform that supports rewrites/proxying.
2. In cookie mode, the API sets an opaque/session JWT cookie with `HttpOnly`, `Secure`, `SameSite=Lax` (or stricter where compatible), limited path and lifetime. Browser requests use `credentials: include`; JavaScript must not read or store session credentials.
3. Stop returning session bearer tokens in JSON for the cookie-only deployment profile. Keep any bearer compatibility mode explicit, temporary, and disabled for production cookie-only deployments.
4. Protect cookie-authenticated state-changing requests with strict Origin validation and a CSRF strategy (Origin checks plus CSRF token where needed). Test logout, expiry, revocation, refresh/re-login, and Safari/private browsing.
5. Verify proxy trust boundaries, forwarded headers, rate limits, CSP, CORS, TLS, and error redaction. Never trust a client-supplied user role.

Do not wire `useNeonAuth` into the current app until the selected hosting/proxy and cookie configuration have been deployed and tested from the actual frontend origin.

## Existing-user credentials — no destructive migration

The Convex identity/password storage format has not been verified as compatible with the API's scrypt hash format. Never copy opaque provider hashes into `app_users.password_hash`, assume they are scrypt, overwrite existing credential records, or run a bulk reset that could lock users out.

Safe migration sequence:
1. Inventory the Convex Auth provider, identity records, account states, email normalization/uniqueness, and password reset behavior in a read-only audit. Keep secrets and hashes out of logs and reports.
2. Create a mapping between Convex user IDs and Neon `app_users` IDs with a stable migration identifier. Detect duplicates and collisions before writing. Do not map by email alone without resolving duplicates and verified ownership.
3. Preserve the current Convex sign-in path during shadow migration. For existing users, either keep Convex as the identity provider while Neon stores a linked identity, or require a verified account-recovery/password-reset flow that sets a fresh scrypt hash after proof of email/account ownership. Do not attempt to verify unknown legacy hashes with scrypt.
4. Make the migration idempotent, resumable, auditable, and reversible. Do not create replacement accounts on collision; do not overwrite a non-null Neon credential; do not remove Convex identities.
5. Test duplicates, suspended/terminated accounts, users without passwords, failed reset, repeated migration, interrupted migration, and successful sign-in before any cohort cutover.
6. Communicate any required reset to users and support recovery before enabling the Neon sign-in route. Cut over by a small cohort with rollback and account reconciliation.

No production credential import or user lockout-risking cutover is authorized until the identity inventory, ownership proof, recovery flow, and rollback tests are verified.

## Screen/domain migration inventory

All items below remain Convex-dependent until their imports/hooks/mutations are replaced and the flow is covered by tests. This is a migration audit checklist, not a claim that each screen has been individually exhaustively enumerated.

- **Identity and routing:** `src/main.tsx` provider tree; `src/hooks/use-auth.ts`; `src/pages/Auth.tsx`; `src/pages/AdminLogin.tsx`; `RequireAuth`, `RequireAdmin`, and user initialization.
- **Customer data:** dashboard, personal/profile, wallet/ledger, transactions, notifications, orders, catalog, marketplace, services, VTU, referrals, support, settings, vendor flows.
- **Operations:** tenant/site setup and banking, shipments/tracking/updates, documents/templates, admin users, vendors, catalog, orders, notifications, transactions, audit logs, KYC, pricing, provider configuration, appearance/settings, and other admin screens.
- **Realtime and writes:** support messaging/status, wallet actions, deposits/withdrawals/credits/debits, order placement, VTU fulfillment, shipment updates, document mutations, and administrative configuration.

For each group, identify all Convex queries/mutations and authorization assumptions; add an explicit Neon API contract and schema migration; implement server-side ownership/tenant/admin authorization; migrate the UI hooks; add component/integration/E2E tests; verify staged data parity; then remove only that group's Convex dependency after rollback is proven. Keep Convex active for untouched domains.

## Financial-write safety gate

Financial write endpoints are intentionally absent and must stay absent until every gate below has implementation evidence and tests:
- server-side role, tenant, ownership, and transaction-level authorization;
- atomic database transactions and consistent ledger invariants;
- concurrency protection and deterministic idempotency keys;
- duplicate/replay handling and safe retry semantics;
- reconciliation against external provider/bank statements and exception handling;
- immutable audit trail with actor, reason, correlation ID, and timestamps;
- adversarial tests for races, replay, partial failures, rollback, currency/tenant mismatch, and unauthorized access;
- reviewed operational controls, alerts, and recovery runbook.

Migration 005 provides ledger integrity constraints for posted groups; it is necessary but not sufficient. Do not enable live money movement to make a test pass.

## Required verification before declaring complete

- [ ] Run root unit/integration tests, Convex validation, TypeScript, ESLint, and production build on the final candidate commit.
- [ ] Run API build/typecheck and the smoke script against staging after deploying the same candidate.
- [ ] Add E2E tests for registration, login, existing-user recovery/migration, session persistence, logout/revocation, role/tenant access, and each migrated data domain.
- [ ] Run browser E2E against the deployed frontend origin, including cookie/CORS/CSRF behavior and deep links.
- [ ] Verify staging database migration state and non-destructive data reconciliation.
- [ ] Audit every route and screen for remaining Convex queries/mutations and record the remaining list.
- [ ] Verify financial-write routes remain unavailable and all financial gates are satisfied before any future enablement.
- [ ] Update deployment/rollback instructions and confirm all required CI, Vercel, and staging checks are terminal and green.

## Current blockers and next action

The full migration cannot safely be completed by wiring the current Neon hook into the app: the existing identity/password format is unverified, the static frontend's same-origin proxy capability is not established, and the Neon API lacks feature parity for most screens and writes. Those are concrete security and data-integrity constraints, not permission to make a speculative cutover.

Next: verify whether the chosen hosting can proxy `/api/*` same-origin; otherwise select/deploy a proxy-capable frontend host. In parallel, perform a read-only Convex identity/data inventory and implement the first end-to-end-tested, read-only customer group (profile, notifications, orders, catalog) against staged Neon data. Keep existing Convex authentication and all financial writes unchanged until that cohort passes its migration and rollback gates.
