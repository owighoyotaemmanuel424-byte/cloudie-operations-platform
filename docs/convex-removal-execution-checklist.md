# Convex removal migration — execution checklist

Target: static Vite/React frontend on InfinityFree, Node API on Render, PostgreSQL on Neon. Convex must not be removed from production builds until every route in this matrix has an equivalent implementation and tests.

## Current verified state
- [x] Dedicated migration branch created: `migration/remove-convex-neon-render`.
- [x] Existing Neon API scaffold and Render Blueprint located.
- [x] Existing frontend Neon API client and experimental auth hook located.
- [ ] Frontend still mounts `ConvexAuthProvider` and creates a `ConvexReactClient`.
- [ ] Main auth hook, auth pages, admin gates, and feature pages still import Convex functions.
- [ ] API has only partial auth/read endpoints; it is not a feature-complete backend.
- [ ] Existing Convex data has not been imported into Neon.
- [ ] InfinityFree deployment has not been updated to a Convex-free build.

## Current implementation checkpoint (2026-10-17)
- API changes are committed to this migration branch; no production cutover has occurred.
- The Neon API CI workflow passed for the previous checkpoint; the latest wallet-summary changes are awaiting their own CI run.
- Shipment creation/update and financial writes remain intentionally unavailable in the new API until authorization, transaction integrity, and idempotency tests exist.
- CI/build/test execution must be confirmed before treating this slice as verified.

## Required migration slices
1. **Foundation and auth:** schema parity, registration/login/logout, session refresh, password reset/email verification, controlled initial admin bootstrap, role checks, tenant membership, CSRF/rate limiting, and tests.
2. **Platform configuration and identity:** profile, preferences, platform settings, branding, support, notifications, files/assets, audit logs.
3. **Financial integrity:** wallet accounts, immutable balanced ledger, idempotent deposits/withdrawals, payment provider webhooks, reconciliation, concurrency tests. Keep live money movement disabled until verified.
4. **Business modules:** tenants/banking, shipments/tracking, marketplace/orders/vendors, VTU catalog/purchases/history, referrals/points, documents/templates, email/campaigns, support.
5. **Frontend adapter migration:** replace every `useQuery`, `useMutation`, `useAction`, Convex auth hook, generated API import, upload/storage path, and realtime subscription with tested API calls or explicit polling/SSE where needed.
6. **Data migration:** export from the source system, transform into Neon, preserve IDs/relationships and ledger history, reconcile counts and balances, rehearse rollback.
7. **Cutover and removal:** switch environment configuration only after staging acceptance; build and smoke-test the InfinityFree artifact; remove Convex packages, generated files, deployment config, and environment variables; verify no Convex imports remain.
8. **Deployment:** deploy API to Render with production Neon URL and secrets configured in the dashboard; apply reviewed migrations; verify health/auth/authorization; build static files and upload to InfinityFree.

## Safety gates
- Never put database URLs, JWT secrets, provider credentials, or admin bootstrap secrets in `VITE_*` variables.
- Do not trust client-provided role, tenant, balance, price, or transaction status.
- Do not seed production money balances from unverified client data.
- Do not cut over or delete the source backend before data reconciliation and a tested rollback plan.
- A successful static build is not proof that the API or business features work.
