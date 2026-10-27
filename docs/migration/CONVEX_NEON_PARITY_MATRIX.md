# Convex → Neon Parity Matrix

**Generated:** 2026-10-25, from the repository at commit `c1ea2f9`.
**Command:** `node scripts/trace-convex-usage.mjs` → wrote
`docs/neon-migration-trace.md`.

These counts are regenerated from the current code, not carried over from an
earlier audit.

| Quantity | Value |
| --- | --- |
| Convex functions referenced by frontend code | **432** |
| …of those, living in modules with **no** matching Neon API route | **256** |
| Convex modules total | **53** |
| Modules with at least one matching Neon API route | **10** |
| Modules with no matching route | **43** |
| Neon API routes | **67** |

> A module counts as "having a route" when at least one of its functions maps to
> an existing `/api/...` path. That is **not** parity: a module can have one
> read route and twenty unmigrated mutations. Treat the 10/53 figure as an
> upper bound on progress, not a completion percentage.

---

## Architecture reality

The frontend is written against the Convex API surface (`api.<module>.<fn>`).
At build time `vite.config.ts` aliases `convex/react` to
`src/lib/neonClient.tsx`, a shim that resolves each Convex-style function name
to a Neon HTTP call. So:

* **Convex is the contract.** Pages import from `convex/react` and never call
  the Neon API directly (except through the shim).
* **Neon is the implementation.** `api/src/server.ts` serves the real data.
* **Convex backend code still ships.** The 53 modules in `src/convex/` remain
  in the tree and are covered by tests. Nothing has been deleted.

This means "migration status" is best read as: *does the shim have a real Neon
endpoint behind it, or does it fabricate/return empty?*

---

## Status of the migrated core (implemented, tested)

These domains have real Neon endpoints, are exercised by the shim, and have
tests:

| Domain | Neon routes | Shim behaviour | Tests |
| --- | --- | --- | --- |
| Auth (register/login/logout/me/csrf) | `POST /api/auth/*`, `GET /api/me` | Real; three-state session | `api/src/server.smoke.ts`, nav tests |
| Sessions & revocation | `api_sessions` table, `revoked_at` | Real | smoke tests |
| Admin bootstrap | `POST /api/auth/bootstrap-admin` | Real; advisory-locked | smoke tests |
| Admin users (list/detail/update/suspend/role) | `GET/PATCH /api/admin/users[/:id]` | Real | smoke tests |
| Admin wallet adjustment | `POST /api/admin/users/:id/wallet-adjust` | Real; P0-fixed | `api/src/walletAdjust.test.ts` |
| Admin reports / dashboard | `GET /api/admin/reports` | Real; P0-fixed | smoke + dashboard shape tests |
| Admin audit logs | `GET /api/admin/audit-logs` | Real (read path degrades to empty) | smoke tests |
| Admin catalog | `GET/POST/PATCH/DELETE /api/admin/catalog` | Real | smoke tests |
| Admin settings | `GET/POST /api/admin/settings` | Real | smoke tests |
| Shipments (list/detail/create/update) | `GET/POST/PATCH /api/shipments[/:id]` | Real | — |
| Tracking | `GET /api/tracking/:trackingNumber` | Real | — |
| Wallet summary & ledger | `GET /api/wallet/summary`, `/api/wallet/ledger` | Real (read-only) | — |
| Orders | `GET/POST /api/orders` | Real (generic commerce) | — |
| Marketplace packages (read) | `GET /api/marketplace/packages` | Real; 503 when tables absent | smoke tests |
| Documents (list) | `GET /api/documents` | Real (read-only) | — |
| Notifications | `GET/PATCH/POST /api/notifications/*` | Real | smoke tests |
| Profile | `GET/PATCH /api/profile` | Real | smoke tests |
| Public config | `GET /api/public-config` | Real | `src/__tests__/neonQueryStability.test.tsx` |
| Tenants | `GET/POST /api/tenants` | Real | — |
| Health / readiness | `GET /health`, `/ready` | Real liveness + schema-aware readiness | — |

---

## Not migrated (financial writes still Convex-authoritative)

The following remain on Convex **by design**. The repository's own cutover
decision (`docs/cutover-decision.md`,
`docs/marketplace-neon-contract-matrix.md`) prohibits migrating financial
writes until idempotency, transactional ledger integrity, authorization,
reconciliation, race and rollback tests pass against a disposable branch.

| Domain | Convex module(s) | Neon equivalent | Status |
| --- | --- | --- | --- |
| Point purchase orders (escrow) | `pointMarket` | none | **Not migrated** — financial write |
| Marketplace purchase / escrow / fulfillment | `marketplace` | generic `POST /api/orders` only | **Not migrated** — different semantics, no escrow parity |
| Wallet credit / debit / refund | `wallet` | admin adjust only (P0-fixed) | **Not migrated** — user-facing money movement |
| VTU purchase, routing, webhook | `vtu*` | none | **Not migrated** — provider money movement |
| Banking (accounts, transfers, deposits, withdrawals) | `bankingCustomer`, `bankingTenant` | schema only (migration 002/005) | **Not migrated** — ledger groups exist, no API |
| Paystack / payment provider webhooks | `paystackInternal`, `providers/*` | none | **Not migrated** — needs signed webhook handling |
| Referral rewards | `referrals` | none | **Not migrated** |
| Document rendering + point charging | `docTemplates` | none | **Not migrated** — charges points |
| KYC review | `adminApi` | tables exist (`kyc_records`), no review API | **Partially migrated** |
| Disputes / risk cases | `adminApi` | none | **Not migrated** |

---

## Migration acceptance gate (unchanged, still binding)

For each feature before cutover:

1. Verify the current Convex implementation.
2. Implement the Neon equivalent with server-side auth + ownership checks.
3. Add contract and authorization tests.
4. Test on a **disposable** Neon branch (never production).
5. Reconcile row counts, relationships and financial totals.
6. Verify frontend integration through the shim.
7. Verify failure handling.
8. Document rollback.
9. Obtain explicit production cutover approval.

**A module is not migrated because one route exists for it.** 43 of 53 modules
have no route at all, and 256 referenced functions have no Neon endpoint.

---

## Recommended next slice (not performed in this audit)

Migrate **read-only** surfaces first — they carry no financial risk:

1. KYC review (tables already exist).
2. Disputes / risk cases (advisory only; the risk engine currently reports a
   clean scan rather than fabricating alerts).
3. Notifications deep-read and settings.

Financial writes require a dedicated, separately reviewed slice with
idempotency and reconciliation proven on a disposable branch.
