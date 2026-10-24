# Points marketplace data reconciliation: Convex → Neon

**Status: protocol only. No source records have been exported or imported.**  
**Scope:** read-only browse data for `vendors` and `pointPackages` only.  
**Target:** disposable Neon branch `migration-runner-full-clean` (`br-restless-rice-b531jufw`) until explicit staging approval. Never use the production branch for first import tests.

## Source contract verified in `src/convex/schema.ts`

### `vendors`
- `_id` — preserve exactly as the Neon `id` text value.
- `userId` — source owner reference; only populate `owner_user_id` if an independently verified mapping to `app_users.id` exists.
- `businessName` — required display name.
- `status` — one of `pending`, `approved`, `suspended`, `rejected`.
- `createdAt` — Unix epoch milliseconds; convert to `timestamptz`.
- Optional vendor contact, payout, document, description, and review fields are intentionally outside the read-only browse import. Do not copy payout details or identity documents into the browse model.

### `pointPackages`
- `_id` — preserve exactly as Neon `id`.
- `vendorId` — must match an exported vendor `_id`.
- `name`, `points`, `priceMinor`, `currency`, `isActive`, `totalSold`, `createdAt`.
- `priceMinor` is already minor currency units; do not multiply by 100 again.
- `createdAt` is Unix epoch milliseconds; convert to `timestamptz`.
- Only NGN packages are supported by migration 008. Non-NGN, invalid, or relationship-orphaned rows must be reported and excluded from the first read-only import, not silently coerced.

## Export requirements

1. Use Convex's supported data export mechanism from the correct production deployment. Do not use a frontend scrape as a source of truth.
2. Export only the `vendors` and `pointPackages` tables for this slice, as JSONL documents with each source document's `_id` and fields. Keep the export private; do not commit exports or paste them into chat.
3. Record the Convex deployment/environment, export timestamp, source table counts, and a SHA-256 hash for each export file in a private run log. Never include contact data, payout details, or documents in that log.
4. Treat this export as a point-in-time snapshot. If listings change during the comparison window, export again or document the delta; do not assume a stale snapshot is current.

## Pre-import validation (must fail closed)

Before any insert, validate all of the following:
- IDs are present and unique within each source table.
- Required fields have the expected types and valid ranges: positive finite integer points, nonnegative integer `priceMinor`, nonnegative integer `totalSold`, valid status, and a supported currency.
- Every package `vendorId` resolves to exactly one exported vendor.
- No source values are silently rounded, defaulted, or reinterpreted except the explicit millisecond-to-timestamp conversion.
- Counts of approved vendors, active packages, inactive packages, non-NGN packages, invalid records, and orphan references are written to the private run report.
- The report includes expected imported counts and exclusion reasons, but no sensitive source fields.

## Import policy

- First run must be a dry run with no writes and a reviewed report.
- First real import target must be the disposable branch ID above. Confirm the connection target through a branch-specific marker before opening a write transaction; never trust a URL string alone.
- Use a single transaction for the import. Insert vendors before packages. Use parameterized statements and conflict handling only where the source-ID and field ownership policy is explicit.
- Preserve source IDs exactly. Do not map the point marketplace into generic `catalog_products` or `commerce_orders`.
- Never import `pointOrders`, wallet balances, wallet ledger entries, points balances, `pointLedger`, escrow, disputes, payouts, payment credentials, or admin records as part of this read-only slice.
- Never overwrite an existing Neon row with source data without first comparing its current values and recording the difference. Repeated runs must be idempotent and must report changed rows separately from inserted rows.
- Keep `owner_user_id` null unless the source `userId` is proven to correspond to a Neon `app_users.id`. Do not create fake user rows to satisfy the foreign key.
- A dry run, successful schema migration, or successful SQL query is not evidence of data parity.

## Post-import checks

On the disposable branch, compare source and target counts and normalized hashes for the in-scope fields. Verify:
- All imported packages have a matching vendor.
- No package with `isActive = false` is returned by the browse endpoint.
- No package belonging to a non-approved vendor is returned.
- NGN minor-unit prices and points values are unchanged.
- Default and each supported sort are stable, including ties.
- Search, each min/max filter, `verifiedOnly`, empty results, and database-unavailable behavior match the Convex contract.
- The endpoint's response shape matches the current `PointMarketplace.tsx` consumer.
- The same sanitized fixture produces equivalent results in Convex and Neon, with documented differences.

Only after these checks should a separate staging branch be seeded and a human run the browser protocol. Production UI routing remains on Convex until staging parity and rollback are approved.

## Evidence currently available

- Migration runner workflow passed on 2026-10-21: [run 39677864909](https://github.com/emmanuelowighoyota9-cmd/cloudie/actions/runs/39677864909). It verified the disposable branch marker, ran the checksum-aware migration runner, ran the dry-run, and confirmed versions 001–008 were recorded.
- Pull-request CI passed on 2026-10-21: [run 39676752844](https://github.com/emmanuelowighoyota9-cmd/cloudie/actions/runs/39676752844).
- The schema/runner evidence does **not** prove that Convex marketplace records have been exported, imported, or reconciled. No marketplace source data has been imported by this protocol.
- No production branch writes or frontend cutover are authorized by this document.


## Implemented local export validator

The repository now includes `api/scripts/validate-marketplace-export.mjs`, a validation-only tool with no database connection and no write path, plus automated tests in `api/scripts/validate-marketplace-export.test.mjs`.

Run it locally against private export files (keep both files outside the repository):

```sh
node api/scripts/validate-marketplace-export.mjs \
  --vendors /private/path/vendors.jsonl \
  --packages /private/path/pointPackages.jsonl
```

The command checks JSONL syntax, duplicate IDs, required fields, integer ranges, timestamps, supported vendor statuses, package-to-vendor references, and reports source-file SHA-256 hashes and aggregate counts only. It never prints source record values or opens a database connection. A non-NGN package causes a nonzero exit (2) so the read-model exclusion decision cannot be missed. Invalid data fails closed with exit 1. The API test command now includes validator regression tests.

**This is not an importer.** No data has been loaded into Neon; do not treat a successful validator run as parity or cutover evidence.
