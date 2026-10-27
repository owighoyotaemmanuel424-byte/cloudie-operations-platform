# Cloudie Comprehensive Audit

**Audited commit:** `c1ea2f9` (branch `main`)
**Audit date:** 2026-10-25
**Auditor scope:** full-stack, security, QA, database, DevOps

This report is generated from code inspection and the repository's own test
suites. Nothing here is inferred from a green CI badge alone. Every "fixed"
claim is backed by a named test in this repository.

---

## A. What was inspected

| Area | Artefact | Result |
| --- | --- | --- |
| Frontend | React 19 + Vite + TS strict, React Router, Tailwind, shadcn/Radix | Builds and typechecks clean |
| Backend | Hono + `pg` on Node (`api/`), 44 routes | Typechecks and tests clean |
| Database | Neon Postgres, 8 SQL migrations in `migrations/` | Schema reviewed table-by-table |
| Auth | `api/src/server.ts` auth middleware, `src/hooks/useSession.tsx`, `src/lib/neonApi.ts` | Reviewed, see §5 |
| CI | `.github/workflows/ci.yml`, `verify.yml`, `scripts/verify.sh` | Reviewed, see §8 |
| Convex | 80 modules in `src/convex/`, aliased to the Neon shim at build time | See migration matrix |

**Current test totals**

| Suite | Command | Result |
| --- | --- | --- |
| Frontend + shared | `bun test` | **635 pass / 0 fail** (36 files) |
| API | `npm --prefix api test` | **58 pass / 0 fail** |
| Frontend types | `bunx tsc -b --noEmit` | exit 0 |
| API types | `npm --prefix api run typecheck` | exit 0 |

*(Totals refreshed 2026-10-26 after the P1-1 and migration-008 fixes; the audit
body above describes commit `c1ea2f9`.)*

---

## B. Findings

### P0-1 — Wallet adjustment moved NGN and points by the same amount

**Severity:** P0 (financial integrity)

**Root cause.** `POST /api/admin/users/:id/wallet-adjust` issued:

```sql
UPDATE app_users
SET wallet_balance_ngn = GREATEST(0, wallet_balance_ngn + $1),
    points_balance     = GREATEST(0, points_balance     + $1)
WHERE id = $2
```

One naira amount drove both a money balance and a points balance. A NGN
adjustment of `-5000` also deducted 5000 points. There is no conversion
operation anywhere in the codebase that makes those two units equivalent.

**Second defect in the same statement.** `GREATEST(0, …)` clamped the resulting
balance to zero while the ledger insert recorded the *full requested* debit:

```sql
INSERT INTO wallet_ledger (user_id, amount_ngn, balance_after_ngn, …)
VALUES ($1, $2, $3, …)   -- $2 = the whole delta, not the real change
```

A user with ₦300 who was debited ₦5,000 ended at ₦0 while the ledger said
`-5000`. Balance and ledger permanently disagreed, and the ledger could never
be reconciled against balances.

**Third defect.** The audit row was written on the shared pool *after* `COMMIT`,
outside the transaction, through a helper that swallowed every error. A
successful financial mutation could be recorded nowhere.

**Fourth defect.** No idempotency key was written even though `wallet_ledger`
has a unique `idempotency_key` column. A retried request double-applied.

**Affected files.** `api/src/server.ts` (route handler).

**Fix implemented.** The route now delegates to a new module,
`api/src/walletAdjust.ts`, which enforces:

1. **Unit separation.** `amountNgn` (money) and `pointsDelta` (points) are
   independent arguments. A NGN-only call leaves `points_balance` untouched;
   a points-only call writes no NGN ledger row.
2. **No clamping.** A debit larger than the balance is rejected with
   `INSUFFICIENT_FUNDS`. The ledger row's `amount_ngn` always equals the real
   `balance_after − balance_before`.
3. **Row locking.** `SELECT … FOR UPDATE` plus a compare-and-set on the balance
   column, so concurrent debits serialize instead of double-spending.
4. **Idempotency.** `idempotency_key` is written to `wallet_ledger` (and
   referenced in the audit details). A replay returns the original result with
   `replayed: true` and applies nothing twice.
5. **Transactional audit.** The audit row is inserted on the same client, in
   the same transaction, *before* `COMMIT`. If it throws, the balance change
   rolls back and the caller gets a 500 — a critical mutation never reports
   success without its audit record.
6. **Rollback on every failure path.** Ledger failure, audit failure and
   concurrent-modification conflict all roll back and report failure.

**Regression tests.** `api/src/walletAdjust.test.ts` (16 cases): valid credit,
valid debit, points-only adjustment, explicit dual adjustment, insufficient
funds, insufficient points, ledger-vs-actual-change equality, unknown user,
concurrent debits (exactly one wins), retried idempotent request, ledger
failure rollback, audit failure aborting the mutation, and audit detail
contents. Route-level authorization and input rejection are covered in
`api/src/server.smoke.ts`.

**Evidence.** `npm --prefix api test` → 56 pass / 0 fail.

---

### P0-2 — Admin dashboard fabricated metrics

**Severity:** P0 (administrative decision integrity)

**Root cause.** `GET /api/admin/reports` returned:

```ts
activeUsers: totalUsers,   // every user reported as active
suspendedUsers: 0,         // hard-coded, regardless of reality
```

and the frontend shim filled any other missing metric with `0`. A real
suspended count of 11 was displayed as 0; a genuine empty table was
indistinguishable from a failed query. An administrator monitoring abuse
could not see suspended accounts at all.

**Affected files.** `api/src/server.ts`, `src/lib/neonClient.tsx`.

**Fix implemented.**

*Backend.* `/api/admin/reports` now counts each metric from its own predicate:

- `active` = `COUNT(*) FILTER (WHERE NOT is_suspended AND NOT is_terminated)`
- `suspended` = `COUNT(*) FILTER (WHERE is_suspended)`
- plus terminated, admins, 7-day signups, wallet liability, points outstanding,
  vendors by status, tenants, shipments by status, orders and escrow,
  KYC by status, documents, payments by status, and 24h ledger events.

Each optional metric is independently guarded: if its source table is missing
the API returns **`null`**, never `0`. Only the users table itself being
unreachable produces a `503`, because the platform cannot report without it.

*Frontend.* `buildAdminDashboard` no longer falls back from one metric to
another (`activeUsers ?? totalUsers` is gone). It maps `null` to an
unavailable state so a card renders "—" instead of a fabricated zero.

**NGN/points separation.** Wallet liability is reported as `walletBalanceNgn`
and points as `pointsOutstanding`. They are never summed or substituted for one
another.

**Regression tests.** `api/src/server.smoke.ts` — "admin reports count active
and suspended users instead of fabricating them" asserts `activeUsers !==
totalUsers`, asserts a real suspended count, and asserts an unavailable metric
is `null`.
`src/__tests__/adminDashboardShape.test.tsx` — "active is never inferred from
the total user count" and "a missing active count does not fall back to the
total".

**Evidence.** 631 frontend + 56 API tests pass.

---

### P1-1 — Audit-log failure surfaced as an empty log

**Severity:** P1

**Root cause.** `GET /api/admin/audit-logs` wrapped its query in
`try { … } catch { return c.json({ logs: [] }) }`. A database outage and a
genuinely empty audit trail were identical to the administrator: an empty log
page. An admin could conclude "no privileged actions happened" during a period
when audit writes were failing.

**Status. Fixed (2026-10-26).** The read path returned `{ logs: [] }` with a 200,
and the frontend shim swallowed the rejection into `[]` as well, so an outage
reached the administrator as "No audit records match your filters."

The API now answers `503 "Audit log storage is unavailable"`, the shim maps a
failed read to `null` (never `[]`), and the page renders a three-state view:
`undefined` loading, `null` outage, array = records.

**Regression coverage.** Write path: audit-write failure aborts the mutation
(`api/src/walletAdjust.test.ts`). Read path: "an unreadable audit trail reports
503 unavailable, never an empty list" and "a readable audit trail still returns
its records with 200" (`api/src/server.smoke.ts`), plus the four cases in
`src/__tests__/adminAuditLogsState.test.tsx`.

---

### P1-2 — Bearer token in `sessionStorage`

**Severity:** P1 (session security)

**Evidence.** `src/lib/neonApi.ts` stores the access token in
`window.sessionStorage` under `TOKEN_KEY` and mirrors the user object beside it.

**Risk.** Any XSS can read the token from `sessionStorage`. An HttpOnly cookie
would not be readable from script. The token is scoped to `sessionStorage`
(not `localStorage`), so it clears when the tab closes, which limits but does
not remove the exposure.

**Current mitigation.** The API also sets an HttpOnly `cloudie_session` cookie
with `SameSite=Lax`, `Secure` in production, and enforces double-submit CSRF
(`X-CSRF-Token` vs the `cloudie_csrf` cookie, compared with `timingSafeEqual`).
The frontend sends both the bearer token and the CSRF header.

**Status.** A full cookie-only migration is **not** implemented here. Doing so
half-way would break authentication (the explicit prohibition in the brief).
This is documented as remaining work with a recommended path in
`docs/security/SECURITY_REVIEW.md`.

---

### P1-3 — No password reset or email verification

**Severity:** P1 (feature completeness)

**Evidence.** No route in `api/src/server.ts` implements password reset or
email verification. `app_users` carries `password_hash` and
`password_changed_at`; there is no reset-token table.

**Status.** Not implemented. Requires an email provider and a token table.
Documented as remaining work; not a defect in existing behaviour.

---

### P2-1 — In-memory rate limiter does not survive restart or scale-out

**Severity:** P2

**Evidence.** `checkRateLimit` in `api/src/server.ts` uses a module-level
`Map<string, {count, resetAt}>`. On Render, a new instance (or a restart) resets
every bucket. With more than one instance the limit multiplies by the instance
count.

**Impact.** Auth rate limiting (`/api/auth/login`, `/api/auth/bootstrap-admin`)
is best-effort. It is real protection against a single-instance credential
spray, but not a durable control.

**Recommended fix.** Move buckets to Postgres or a shared cache, or adopt the
`@convex-dev/rate-limiter` component pattern against Neon. Tracked as
remaining work.

---

### P2-2 — `GET /api/admin/audit-logs` and other list endpoints allow only small limits

**Severity:** P3 (cosmetic)

`parseLimit` caps at 100 rows with no cursor pagination. For audit review this
is a usability limitation, not a correctness one. No unbounded query was found:
every list endpoint applies `LIMIT`.

---

## C. Security review summary

| Control | State | Evidence |
| --- | --- | --- |
| Password hashing | scrypt, 16-byte salt, `timingSafeEqual` | `api/src/server.ts` `hashPassword`/`verifyPassword` |
| JWT validation | issuer `cloudie-neon-api`, audience `cloudie-web`, `sub` + `jti`, HS256 | `jwtVerify` in `auth` middleware |
| Server-side session check | `api_sessions` row must exist, unrevoked, unexpired | `auth` middleware |
| Suspension enforcement | suspended/terminated users rejected at `auth` | `auth` middleware |
| Admin authorization | `adminOnly` middleware, server-side, on every admin route | all `/api/admin/*` routes |
| CSRF | double-submit, `timingSafeEqual`, unsafe methods only | middleware + smoke tests |
| CORS | exact-match allow-list from `CORS_ORIGINS`, no suffix trust | `isAllowedOrigin` |
| Security headers | `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `no-store` | middleware |
| Bootstrap | disabled unless ≥32-byte token set; timing-safe compare; `pg_advisory_xact_lock` prevents races; rejects when an admin exists; audited | `/api/auth/bootstrap-admin` + smoke tests |
| Login oracle | unknown email and wrong password return identical errors | smoke test |
| SQL injection | every query uses `$n` parameters; no string-built SQL found | full `server.ts` review |
| Secrets | none committed; `.env` excluded; JWT secret required ≥32 bytes at boot | repo inspection |

**Verified 2026-10-26:** `npm --prefix api audit --omit=dev` → **0
vulnerabilities**, so the Render backend that owns auth and money is clean.
`bun audit` reports 39 advisories (1 critical, 12 high) but `bun audit fix`
resolves **0 of 39** — every fix is blocked by a published version range. Each
cluster was traced to its importers and none is reachable from the browser
bundle or the API; the full reachability table and the reasoning for not
forcing major bumps are in `docs/audit/REMEDIATION_STATUS.md`. No penetration
test was performed.

---

## D. Deployment and configuration

* `render.yaml` defines the API service. Production environment variables are
  managed in Render's dashboard, not in the repository.
* `DATABASE_URL` and `JWT_SECRET` are required at boot and the process refuses
  to start without them — a missing secret fails loudly rather than silently.
* `/health` is liveness (no DB dependency, so a DB outage does not kill the
  instance). `/ready` performs a real DB round-trip **and** a schema check, so a
  wrong-but-connectable database reports not-ready.
* Frontend hosting (Freebuff/Cloudie) serves the Vite build; public env vars
  carry no server secrets.

**Not verified from this environment:** which commit is currently deployed, and
which Neon branch each environment points to. Both require access to the Render
and Neon dashboards. Exact steps are in
`docs/operations/PRODUCTION_RUNBOOK.md`.
