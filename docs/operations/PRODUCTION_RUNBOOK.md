# Production Runbook

For an authorized operator. Contains no secrets, tokens or customer data.

**Services**

| Service | Where | Command |
| --- | --- | --- |
| API (Hono + pg) | Render | `node dist/server.js` (`api/` `npm start`) |
| Frontend | Static host (Cloudie/Freebuff) | `vite build` → `dist/` |
| Database | Neon PostgreSQL | — |

---

## 1. Clean environment setup

```bash
git clone <repo> && cd cloudie
bun install                 # frontend deps (bun is the package manager)
npm --prefix api install    # API deps
```

Required environment variables (set them in Render's dashboard, **not** in the
repository):

| Variable | Purpose | Failure mode if missing |
| --- | --- | --- |
| `DATABASE_URL` | Neon connection string | process refuses to boot |
| `JWT_SECRET` | HS256 signing key, **≥32 bytes** | process refuses to boot |
| `CORS_ORIGINS` | comma-separated exact origins | only default origins allowed |
| `CLOUDIE_ADMIN_BOOTSTRAP_TOKEN` | one-time admin bootstrap, ≥32 bytes | bootstrap disabled (503) |
| `NODE_ENV` | `production` enables `Secure` cookies | cookies not flagged secure |
| `PG_POOL_MAX` | pool size (default 10) | — |

**Remove `CLOUDIE_ADMIN_BOOTSTRAP_TOKEN` once the administrator exists.** The
endpoint then returns 503 permanently. Confirm an admin can still log in
*before* removing it.

## 2. Configure secrets safely

* Store in Render's environment settings, never in git.
* `.env` / `.env.local` are for local development only and are git-ignored.
* Never paste a token into a commit, a log, a screenshot or a chat.
* To rotate `JWT_SECRET`: all sessions become invalid; users must log in again.
  That is the intended revocation mechanism.

## 3. Initialize a disposable database

```bash
export TEST_DATABASE_URL="<branch url>"
export NEON_TEST_BRANCH_NAME=test-migrations
export NEON_TEST_BRANCH_ID="<branch id>"
bash scripts/neon-diagnose.sh
```

The script refuses the production branch ID, rejects pooled-connection
indicators, requires database `neondb`, and re-runs all migrations to test
idempotency.

## 4. Run migrations

```bash
npm run migrate:dry-run
npm run migrate
```

Checksum-verified, advisory-locked, repeatable. All migrations in `migrations/`
(001–008) are **additive** — none drop or rewrite existing data.

## 5. Run all tests

```bash
bunx tsc -b --noEmit           # frontend types
bun test                       # frontend + shared (631 tests)
npm --prefix api run typecheck # API types
npm --prefix api test          # API (56 tests)
```

Or: `bash scripts/verify.sh` (runs all four). CI (`.github/workflows/ci.yml`)
runs the same checks on every push and PR.

## 6. Deploy staging

Deploy the API to a staging Render service pointed at a staging Neon branch.
Deploy the frontend to a staging host with staging API origins in
`CORS_ORIGINS`.

## 7. Verify critical flows

1. Register → login → refresh → logout.
2. Ordinary user hits `/api/admin/users` → **403**.
3. Admin dashboard loads; suspended count is non-zero if any exist; no card
   shows a fabricated zero.
4. A wallet adjustment of a negative amount larger than the balance is
   **rejected**, not clamped.
5. Replaying the same `idempotency_key` applies once.
6. `/ready` is green; `/health` stays green even during a DB outage.

## 8. Reconcile financial data

```bash
npm --prefix api run reconcile
```

Check `relationshipChecks` is all zeros and confirm:
`SUM(wallet_balance_ngn)` equals the ledger's net, and points outstanding
equals credits − debits. Any drift blocks sign-off.

## 9. Approve production cutover

Written owner approval, per domain, after staging verification and clean
reconciliation. See `docs/migration/CUTOVER_RUNBOOK.md`.

## 10. Verify production

* `/health` → `{"ok":true}` (liveness, no DB dependency).
* `/ready` → healthy **with** the schema check passing (a connectable but empty
  database must report not-ready).
* Deploy traceability: confirm the deployed commit matches the intended SHA in
  the host's dashboard. **This audit could not verify the deployed commit** —
  it requires dashboard access.
* Confirm which Neon branch each environment uses in the Neon dashboard. **Not
  verifiable from this audit.**

## 11. Roll back

* **Frontend:** redeploy the previous build; the host keeps prior versions.
* **API:** redeploy the previous commit on Render.
* **Database:** migrations are additive; a rollback is normally a code revert,
  not a schema reversal. If a schema reversal is unavoidable, restore from the
  pre-migration snapshot and replay rows written in the window — never discard
  financial rows silently.

## Health endpoints — what they actually prove

| Endpoint | Proves | Does **not** prove |
| --- | --- | --- |
| `GET /health` | process is up | nothing about the database |
| `GET /ready` | DB round-trip **and** required tables exist | application correctness, provider health |

## Troubleshooting

| Symptom | Likely cause | Action |
| --- | --- | --- |
| Process exits at boot | missing `DATABASE_URL` or short `JWT_SECRET` | fix env vars |
| `/ready` not ready, `/health` ok | wrong/empty database | check `DATABASE_URL`; run migrations |
| Every login fails, DB reachable | migrations not applied | `npm run migrate` |
| 403 on all POSTs from the browser | CSRF cookie/header mismatch | confirm `GET /api/auth/csrf` runs; check `CORS_ORIGINS` |
| 401 for a valid session | session expired (8h) or revoked | log in again |
| Bootstrap returns 503 | token unset or <32 bytes | intended once an admin exists |
