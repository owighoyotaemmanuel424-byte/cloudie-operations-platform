# Points Marketplace: source-to-Neon contract matrix

**Status:** Source-level inventory, not runtime verification. **No frontend routing or production behavior is changed by this document.**
**Source ref inspected:** `main` at commit `7bf91bd1ab6550e648a30d0ed6c43a8bb6fd2863` (2026-10-21).
**Target branch:** `migration/marketplace-neon-readonly-assessment`.

## Scope and call graph

The buyer marketplace page `src/pages/marketplace/PointMarketplace.tsx` directly calls:

- `api.pointMarket.listPackages` — browse and filter active packages.
- `api.wallet.getBalance` — display the buyer's current NGN balance during checkout.
- `api.pointMarket.createOrder` — creates a financial order and debits the buyer wallet; **out of scope for read-only migration**.
- `api.pointMarket.getMyOrder` — watches the newly created order; the result is also used to determine whether points were credited.

The page's `CheckoutDialog`/purchase flow also consumes the `PurchaseDialog` presentation contract in `src/features/marketplace/PurchaseDialog.tsx`. That dialog presents review, pending escrow, success, failure, and ambiguous outcomes. These are not interchangeable with generic commerce-order states.

The backend source is `src/convex/pointMarket.ts`; wallet balance is implemented separately in `src/convex/wallet.ts`. This matrix is limited to the buyer browse path and the dependencies that prevent a safe checkout cutover.

## Contract matrix

| Current Convex contract | Inputs and observable behavior | Existing Neon candidate | Assessment / required work |
| --- | --- | --- | --- |
| `pointMarket.listPackages` (query) | Optional `search`, `minPrice`, `maxPrice`, `minPoints`, `maxPoints`, `verifiedOnly`, `sort`. Starts from active `pointPackages`, takes at most 200, joins vendor records, only includes approved vendors, filters by name/business name and numeric bounds, returns package id/name/points/priceMinor/currency/unitPriceMinor/totalSold/vendor id/name/verified flag. Sort modes: `price_asc`, `price_desc`, `points_desc`, `unit_asc`; default is unit price ascending, then total sold descending. | `GET /api/catalog` → `catalog_products` | **Not equivalent.** Generic products have different fields, tenant semantics, categories, and no demonstrated points-package/vendor relationship or verified-vendor filtering. Do not point the UI at this route. Implement a dedicated read-only endpoint only after schema and data reconciliation. |
| `wallet.getBalance` (query) | Authenticated buyer balance in the wallet domain; consumed by the purchase UI for affordability and projected balance. Exact return type and authorization behavior must be checked against `src/convex/wallet.ts` before implementation. | No marketplace-specific wallet-balance route identified in `api/src/server.ts`; existing wallet routes are summary/ledger. | **Unverified parity.** Map exact amount units and insufficient-funds behavior. Do not infer a balance from ledger totals or generic account fields. |
| `pointMarket.getMyOrder` (query) | Input `orderId`; unauthenticated/missing/unauthorized results return `null`. Allows buyer, owning vendor, or admin. Returns order status/timestamps/amount/points, dispute metadata, buyer identity fields, viewer role, package/vendor labels, and overdue flag. | `GET /api/orders` lists the current user's generic commerce orders; `GET /api/orders` is not a single marketplace-order detail route. | **Not equivalent.** Dedicated order-detail contract and authorization tests are required. Avoid exposing buyer email/name to vendor/admin beyond the exact policy approved for this flow. |
| `pointMarket.createOrder` (mutation) | Input `packageId`; authenticated buyer only. Validates active package, approved vendor, NGN currency; inserts order in escrow, debits wallet with idempotency key, cancels order if debit fails, notifies vendor, returns `orderId`. | `POST /api/orders` creates generic commerce orders and order items. | **Financial write — prohibited in this slice.** It has different semantics and no demonstrated escrow, wallet ledger debit, points credit, or vendor payout parity. Keep Convex path unchanged. |

## Data model and semantic gaps

The Convex browse contract reads `pointPackages` and `vendors`, including `isActive`, `vendorId`, vendor `status`, package `priceMinor`, `currency`, `points`, and `totalSold`. The related order flow uses `pointOrders`, the user points balance and `pointLedger`, wallet debit/ledger behavior, notifications, and vendor payout/escrow lifecycle.

The Neon migrations currently define generic `catalog_products`, `commerce_orders`, and `commerce_order_items`. Similar-sounding product/order tables do not prove equivalent semantics. Before implementing even a read-only endpoint:

1. Verify whether marketplace-specific records exist in Neon at all; the disposable migration-runner branch was created from the production branch and the migration workflow validates schema, not source data parity.
2. Design or identify explicit package/vendor tables and foreign-key/index strategy. Do not repurpose generic commerce tables without a reviewed contract.
3. Decide how to represent NGN minor units, points precision, approved/verified vendor status, active listings, deterministic sort order, and the 200-row cap/pagination.
4. Keep source Convex queries available as the rollback path while comparing sanitized, read-only staging results.

## Read-only endpoint proposal (not implemented)

A future endpoint may be `GET /api/marketplace/packages` with query parameters corresponding to the current filter contract. It must be read-only, authenticated consistently with the current page, validate numeric bounds and sort values, use parameterized SQL, enforce approved-vendor/active-package predicates server-side, and return the exact fields needed by the current UI (or a reviewed adapter).

Do not add `createOrder`, wallet debit/credit, escrow, fulfillment, disputes, payouts, vendor changes, or admin writes in this first slice.

## Required contract tests before staging routing

- Valid default browse, each supported sort mode, case-insensitive search, every min/max bound, verified-only behavior, and combined filters.
- Empty package list; inactive package; unapproved/missing vendor; missing related row; malformed numeric values; unsupported sort value; database unavailable.
- Authentication required; suspended/terminated user behavior; no cross-tenant leakage if marketplace data is tenant-scoped.
- Stable response keys, minor-unit currency handling, deterministic ordering for ties, and correct behavior at the result limit.
- Compare the same sanitized fixture through Convex and the candidate Neon endpoint; document expected differences before accepting them.
- Browser smoke tests for loading, populated, empty, and error states on mobile and desktop, with Convex routing preserved for rollback.

## Evidence and remaining unknowns

- Source inspection confirms the buyer page calls the Convex browse query and the checkout flow calls wallet balance, order creation, and order detail.
- Source inspection confirms `GET /api/catalog` queries `catalog_products` and returns `{ products }`; `POST /api/orders` inserts `commerce_orders`/items. Neither is a drop-in replacement for points marketplace behavior.
- This is a static source review only. No browser test, deployed API target verification, data reconciliation, or live staging endpoint test is claimed.
- Before any deployment or traffic change, verify the deployed API's actual database branch using secret-safe evidence. A successful `/ready` or `SELECT 1` is connectivity evidence only.

## Gate

**Current decision: do not switch marketplace UI or financial writes to Neon.** Finish the dedicated read-only contract and test implementation on staging, prove data parity, and preserve the existing Convex path. Financial-write migration requires a separate review of idempotency, transactional wallet/points ledger integrity, escrow, payout, audit, reconciliation, failure/retry behavior, and rollback.


## Additional source checks: wallet and API boundary

### Wallet balance contract

Inspection of `src/convex/wallet.ts` confirms `wallet.getBalance` returns `null` when unauthenticated, `0` if the authenticated user record is missing, the stored `walletBalanceNgn` when present, or a legacy converted balance derived from points balance and the configured NGN-per-point rate. Values are NGN major units, not minor units. The read can therefore depend on legacy conversion logic; a Neon implementation must not substitute `app_users.wallet_balance_ngn` without a reconciled migration/defaulting policy.

The same file shows wallet debits use idempotency/reference checks, reject conflicting replay, reject non-positive amounts and insufficient balance, update the user balance, and insert a wallet ledger row. This is additional evidence that a future financial-write port needs transactional and ledger-level parity; it is not part of the browse endpoint.

### API route and session boundary

Inspection of `api/src/server.ts` confirms:
- The API requires `DATABASE_URL` and a `JWT_SECRET` of at least 32 bytes at startup.
- Cookie/bearer auth validates JWT issuer/audience, checks the active `api_sessions` row and expiry/revocation, then reloads the user and rejects suspended or terminated accounts.
- `adminOnly` is a separate role check. A new marketplace endpoint must deliberately choose public-vs-authenticated access and cannot assume authentication from the frontend.
- CORS is restricted to exact configured origins. Cookie-authenticated state changes require origin validation and a double-submit CSRF token.
- `/ready` runs `SELECT 1`; it demonstrates database connectivity only, not that the endpoint points to the intended Neon branch or has marketplace-compatible data.

The inspected server currently contains generic catalog and commerce order routes, not a dedicated points-marketplace package/order contract. No new endpoint was added in this step.

## Status after this pass

- [x] Inspect buyer marketplace page and purchase dialog.
- [x] Inspect `pointMarket.ts` browse/order/vendor contracts at source level.
- [x] Inspect wallet balance/debit semantics.
- [x] Inspect API startup, authentication middleware, CORS/CSRF boundary, and health/readiness semantics.
- [ ] Repository-wide inventory of every buyer/vendor/admin `api.pointMarket.*` call site remains incomplete.
- [ ] Inspect the complete Neon schema/migrations and run tests against a disposable staging database.
- [ ] Verify deployed API database target using secret-safe evidence.
- [ ] Implement a dedicated read-only endpoint and contract tests on a staging-only path.
- [ ] Reconcile source/staging data and run browser smoke tests before any frontend routing change.

This remains static source analysis. No deployed service, database contents, test suite, or browser session was exercised by this pass.


## Implementation update — read-only Neon browse path (2026-10-21)

A staging-only implementation has now been committed on `migration/marketplace-neon-readonly-assessment`:

- `migrations/008_points_marketplace_read_model.sql` adds isolated `point_market_vendors` and `point_market_packages` tables. It is additive and does not modify generic catalog/order tables or wallet/financial data.
- `GET /api/marketplace/packages` is registered in `api/src/server.ts`. It is public/read-only, restricts results to approved vendors, supports search, NGN price bounds, points bounds, verification filter and allowlisted sort orders, and returns the existing buyer browse response field names.
- Five API smoke tests cover invalid filters, invalid sort, empty result set, response mapping and safe database-unavailable behavior.

### Important boundary

This is a **schema and endpoint scaffold**, not marketplace data parity. The new tables are expected to be empty until a separate reviewed reconciliation/import maps Convex vendors and packages. The frontend remains wired to Convex; no buyer UI routing was changed. Purchase creation, wallet debit, escrow, fulfillment, disputes, vendor onboarding, payouts and admin actions remain on their existing paths.

### Verification status

- [x] Changes committed to the isolated migration branch.
- [ ] CI/API typecheck and smoke tests have not yet been observed passing.
- [ ] Migration 008 has not been applied to a disposable Neon branch in this step.
- [ ] No endpoint has been exercised against a live Neon database.
- [ ] No source-to-Neon data reconciliation has been performed.
- [ ] No frontend or production cutover has occurred.

Do not point the live buyer page at this endpoint until CI passes, migration 008 is applied and verified on a disposable branch, and source data reconciliation plus browser tests are complete.


## Migration runner evidence update (2026-10-21)

The dedicated workflow passed on disposable branch `migration-runner-full-clean` (branch ID `br-restless-rice-b531jufw`): [GitHub Actions run 39677864909](https://github.com/emmanuelowighoyota9-cmd/cloudie/actions/runs/39677864909). It verified the branch marker, ran the checksum-aware migration runner, performed the dry-run, and confirmed migration versions 001–008 with checksums. Pull-request CI also passed: [run 39676752844](https://github.com/emmanuelowighoyota9-cmd/cloudie/actions/runs/39676752844).

This confirms the migration runner and additive schema on a disposable database. It does **not** prove marketplace data parity. The source-to-target export, validation, import, normalized count/hash comparison, and browser smoke test remain outstanding. The approved next step is documented in [marketplace-neon-data-reconciliation.md](marketplace-neon-data-reconciliation.md). Production routing and all financial writes remain on Convex.
