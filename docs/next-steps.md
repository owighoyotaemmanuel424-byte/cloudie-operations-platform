# Cloudie — next steps and evidence handoff

Current state: Convex remains the live backend. Neon is not authoritative. Do not run migrations on production branch `br-winter-snow-b5spd77h`, do not use a pooled connection, and do not set `DATABASE_URL` or `VITE_NEON_API_URL` until the owner records a cutover decision in `docs/cutover-decision.md`.

## A. Neon diagnostic

On a laptop or CI-capable shell, first check out the latest main branch. Set `TEST_DATABASE_URL` in that same shell to the direct (non-pooled) connection string for the already-created `test-migrations` branch. Do not paste the URL into chat or commit it.

```bash
git checkout main
git pull --ff-only origin main

# In this shell, TEST_DATABASE_URL must already be exported with the direct
# connection string for branch br-nameless-morning-b5o1qitn / database neondb.
PROJECT_ID=lively-sky-99526507 \
PROD_BRANCH=br-winter-snow-b5spd77h \
TEST_BRANCH_EXISTING=test-migrations \
./scripts/neon-diagnose.sh 2>&1 | tee /tmp/neon-diagnose.log
```

Existing-branch mode skips branch creation. The script knows the recorded test branch ID, but its URL cannot be cryptographically tied to that ID by PostgreSQL alone: confirm the direct endpoint belongs to `test-migrations` in Neon Console before running.

**Expected success:** `=== migrations/XXX.sql ===` for each of the seven files, twice, no `ERROR:` lines, bookkeeping/table inventory output, and `DIAGNOSTIC COMPLETE`.

**On failure:** copy the first `=== migrations/XXX.sql ===` heading followed by the PostgreSQL `LINE N:` and `ERROR:` block (about five lines), plus the exit code. Do not edit SQL based only on static suspicion.

**Paste back:** full diagnostic output and exit code, with secrets redacted.

## B. STATUS.md reconciliation

Open `/tmp/neon-diagnose.log` and inspect the `schema_migrations` query result. If it lists zero rows, and only if both complete diagnostic passes succeeded, update `migrations/STATUS.md` with a dated, branch-specific factual record, for example:

> As of YYYY-MM-DD, `schema_migrations` on `neondb` in disposable branch `test-migrations` contains 0 rows. The seven SQL files apply cleanly on that disposable branch (see the committed diagnostic output).

Do not use that wording unless the log proves it. Do not infer production state from the test branch. Commit the diagnostic log only after reviewing it for secrets, and commit the reconciled status plus safe evidence.

**Paste back:** the `schema_migrations` result, both-pass success/failure evidence, and the status diff/commit URL.

## C. CI verification

Run lockfile regeneration first, then verify against the resulting main commit:

```bash
gh workflow run regen-lock.yml --ref main
# wait for the new commit on main:
gh run list --workflow=regen-lock.yml --limit=1

gh workflow run verify.yml --ref main
gh run list --workflow=verify.yml --limit=1
gh run view <run-id> --log > /tmp/verify.log
```

**Expected success:** `lockfile-check` passes; `root` passes with frozen install, TypeScript build check, `bun test`, and manual-script typecheck green; `api` passes typecheck and tests (previously observed API suite had at least 21 tests, but that older run is not current evidence).

**Paste back:** both workflow run URLs/IDs, tested commit SHA, and the tail of `/tmp/verify.log` including both root and API job results. A dispatch request alone is not a pass.

## D. Live Convex check

Use a non-production Convex deployment, separate buyer and approved vendor test accounts, and an active package visible to the buyer:

```bash
CONVEX_URL=https://<dev>.convex.cloud \
BUYER_AUTH_TOKEN=<buyer-jwt> \
VENDOR_AUTH_TOKEN=<vendor-jwt> \
TEST_PACKAGE_ID=<id> \
bun run verify:convex
```

The script should verify buyer authentication, `escrow` after `createOrder`, vendor-authorized `fulfillOrder`, `credited` after fulfillment, and insufficient-funds rejection containing `Insufficient NGN wallet balance`. It pauses for operator confirmation after the test buyer's wallet is safely lowered below the package price. Never use production credentials or paste tokens.

**Paste back:** full output and exit code, with tokens/secrets redacted.

## E. Browser check

Follow `docs/marketplace-e2e.md` on a non-production deployment, with separate buyer and vendor sessions, at 375×667 and 1440×900.

**Critical assertion:** while the buyer's purchase dialog remains open, vendor fulfillment in the other session must cause the dialog to transition from `pending` to `success` without a page reload. This demonstrates Convex reactivity. Also verify balances, receipt, insufficient-funds behavior, and responsive layout per the protocol.

**Paste back:** completed PASS/FAIL/BLOCKED checklist, deployment URL, timestamps, screenshots/video for both sizes, redacted order reference, starting/final NGN and points balances, and any console/network error.

## F. Cutover decision

Fill in the owner decision block in `docs/cutover-decision.md` after reviewing the migration, CI, Convex, and browser evidence. Choose the intended option and record the rationale/rollback gates. Do not set `DATABASE_URL` or `VITE_NEON_API_URL` in any environment until the decision is recorded. Commit the decision.

**Paste back:** selected option, completed decision block, and commit URL. Do not choose a strategy on the owner's behalf.
