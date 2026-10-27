# Cutover Runbook

**Scope:** moving a domain from Convex to Neon in production.
**Status:** no cutover is scheduled. This runbook is the procedure to follow
when one is approved.

The binding rule from `docs/cutover-decision.md` stands: **financial writes do
not migrate until idempotency, transactional ledger integrity, authorization,
reconciliation, race and rollback tests pass on a disposable branch.**

---

## 0. Preconditions

- [ ] The domain has a completed entry in `CONVEX_NEON_PARITY_MATRIX.md`.
- [ ] Contract + authorization tests exist and pass.
- [ ] A disposable Neon branch exists (never the production branch).
- [ ] Rollback is documented for this specific domain.
- [ ] An owner has approved the cutover in writing.

## 1. Create a disposable test branch

Use Neon's branching to clone production-shaped data. **Do not point the
migrator at the production branch** — `scripts/neon-diagnose.sh` refuses the
known production branch ID for exactly this reason.

```bash
export TEST_DATABASE_URL="<branch connection string>"
export NEON_TEST_BRANCH_NAME=test-migrations
export NEON_TEST_BRANCH_ID="<branch id>"
bash scripts/neon-diagnose.sh
```

The script runs each SQL file individually with `psql -X -v ON_ERROR_STOP=1`,
then **re-runs the whole set** to prove idempotency, and inspects
`schema_migrations` and the public tables.

## 2. Run migrations

```bash
npm run migrate:dry-run     # shows what would run
npm run migrate             # applies, records checksums, takes an advisory lock
```

Migrations are checksum-verified and repeatable. Never hand-edit `bun.lock`.

## 3. Reconcile data

```bash
npm --prefix api run reconcile
```

Verify for the domain in question:

* row counts (source vs Neon),
* referential integrity (no orphaned wallets, shipment events, order items),
* financial totals: `SUM(wallet_balance_ngn)` vs ledger, points outstanding vs
  credits − debits,
* `unbalancedPostedGroups` is `0`.

Any mismatch blocks the cutover.

## 4. Deploy staging and verify

Point the staging frontend at the staging API. Verify, in order:

1. Auth: register, login, refresh, logout, expiry, CSRF rejection.
2. Role enforcement: an ordinary user is rejected by every admin route.
3. The domain's happy path end to end.
4. Failure paths: insufficient funds, duplicate idempotency key, provider
   outage — each must fail loudly, never as a fake success.
5. Currency rules: NGN renders via `fmtNaira`, points via `fmtPoints`, never
   mixed in one text node.
6. Dashboard: no metric shows a fabricated zero; unavailable shows "—".

## 5. Dual-read window (read-only domains only)

For read-only domains a compatibility window is safe: serve reads from Neon,
compare against Convex, and reconcile differences. **Do not dual-write.**
Dual writes need an explicit outbox/reconciliation strategy
(`docs/cutover-decision.md`); without one they silently corrupt financial
history.

## 6. Approval gate

Cutover proceeds only when every box is checked:

- [ ] Acceptance criteria for the domain are all met.
- [ ] Staging smoke tests pass (record the run).
- [ ] Reconciliation is clean on the disposable branch.
- [ ] Rollback has been rehearsed, not just written.
- [ ] Production owner approves explicitly.

## 7. Production cutover

1. Run migrations against production during a low-traffic window.
2. Verify `/ready` reports healthy **with** the schema check.
3. Flip the frontend to the Neon endpoint for this domain only.
4. Watch error rates, ledger totals and audit writes.

## 8. Rollback

Because Convex code is never deleted before parity is verified, rollback is a
configuration change, not a restore:

1. Point the frontend back to the Convex path for the domain (the shim entry in
   `src/lib/neonClient.tsx`).
2. If production migrations were applied and are additive-only (all of 001–008
   are), they can stay in place — they do not affect Convex.
3. If a migration must be reversed, restore from the pre-migration snapshot;
   **no migration in this repo is destructive**, so a restore is a last resort.
4. Reconcile any rows written to Neon during the window and decide, per domain,
   whether to replay or discard them. Never discard financial rows silently.

**Never** force-push, rewrite shared history, or reset the production branch to
undo a migration.
