# Points Marketplace: Convex-to-Neon Read-Only Migration Assessment

**Status:** Initial assessment; implementation not authorized by this document.  
**Target:** `migration/marketplace-neon-readonly-assessment`  
**Production impact:** None. This document does not change application code, database data, secrets, or deployment configuration.

## Decision

Do not replace the points marketplace's Convex calls with the existing generic Neon catalog route yet. The points marketplace has domain-specific purchase and financial behavior; a generic catalog endpoint is not evidence of compatible data semantics or authorization.

The current marketplace page references `api.pointMarket.listPackages`. The purchase flow is associated with `api.pointMarket.createOrder`. The existing Neon API's `GET /api/catalog` and generic commerce schema must be assessed against these domain contracts before any frontend switch.

## Scope for the first implementation slice

Start with a read-only inventory and contract mapping. Do not implement purchase, wallet, escrow, fulfillment, dispute, payout, or vendor-write paths in this slice.

### Inventory to complete

- [ ] Enumerate all `api.pointMarket.*` functions referenced by buyer, vendor, and admin UI, including indirect hooks/components.
- [ ] Read each Convex function implementation and record inputs, outputs, validation, auth checks, query filters, ordering, pagination, and error behavior.
- [ ] Inspect the complete Neon API route registration and handlers; identify which routes are deployed and which are only scaffolding.
- [ ] Map each read-only marketplace query to its required source tables, relationships, status semantics, and indexes.
- [ ] Verify tenant isolation and role-based authorization on the server; frontend hiding is not authorization.
- [ ] Identify data that exists only in Convex and define a separately reviewed, reconciled migration plan. Do not assume Neon has the records.
- [ ] Add contract tests for response shape, unauthenticated access, unauthorized roles, cross-tenant access, empty results, and failure behavior.
- [ ] Document the staging-only verification and rollback procedure before routing any screen to Neon.

## Read-only acceptance criteria

A read-only endpoint is eligible for a staging experiment only when all of the following are demonstrated:

1. Its schema and meaning match the current Convex query contract, or the UI has an explicitly reviewed adapter.
2. Authorization and tenant filtering are enforced by the server on every request.
3. Automated tests cover authorized and denied requests, tenant boundaries, empty data, malformed input, and database failures.
4. Staging data has been reconciled against the source of truth; no production records are copied or modified as part of this assessment.
5. Browser smoke tests confirm loading, empty, error, and populated states on mobile and desktop.
6. The existing Convex path remains available for rollback until parity is demonstrated.

## Financial safety boundaries

- Never test with production wallet balances or real purchases.
- Do not redirect `createOrder` or any wallet/escrow/payout mutation to Neon as part of a read-only slice.
- Do not treat generic commerce orders as equivalent to points marketplace orders without a field-by-field contract review.
- Require idempotency, transactional ledger integrity, authorization, auditability, reconciliation, and explicit failure/retry semantics before any financial write migration.
- Keep Convex and current production traffic unchanged until a separate cutover decision is reviewed and approved.

## Deployment and session constraints

The frontend and API have been reported on different origins. Before relying on cookie-based authentication from the browser, verify the actual production/staging origins and Safari behavior. Do not put session credentials in local storage as a workaround. Any same-origin proxy or token/session redesign is a separate security-reviewed task.

The deployed API's actual `DATABASE_URL` target must be verified without printing or exposing credentials. A healthy `/ready` response alone proves connectivity, not schema readiness, correct branch selection, or application parity.

## Evidence already available

- The disposable Neon migration-runner workflow reported success for migrations `001`–`007`.
- The runner's subsequent dry-run reported `Applied: 0, Already up-to-date: 7`.
- These results validate schema migration behavior on the disposable branch only. They do not prove production data migration, API deployment configuration, frontend compatibility, or financial workflow parity.

## Immediate next action

Complete the source inventory and produce a route-by-route contract matrix before writing runtime code. The first runtime change, if approved later, should be a read-only staging-only endpoint plus tests—not a production cutover or a financial mutation.
