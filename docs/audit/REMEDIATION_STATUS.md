# Remediation Status

Each finding from `COMPREHENSIVE_AUDIT.md`, its current state, the test that
proves it, and what remains.

Legend: **Fixed** — code changed and regression-tested. **Open** — confirmed,
not yet fixed. **Partial** — the harmful behaviour is removed, a lesser
residual remains.

**Last verified 2026-10-26** — `bunx tsc -b` (app/node/test) exit 0,
`bun test` 635 pass / 0 fail, `npm --prefix api run typecheck` exit 0,
`npm --prefix api test` 58 pass / 0 fail, `bun run lint` 0 errors.

---

## P0-1 — Wallet adjustment mixed NGN and points

**Status: Fixed**

| Item | Detail |
| --- | --- |
| Affected | `api/src/server.ts` `POST /api/admin/users/:id/wallet-adjust` |
| New module | `api/src/walletAdjust.ts` |
| Unit separation | `amountNgn` and `pointsDelta` are independent; neither derives from the other |
| Clamping | Removed; insufficient debit returns `INSUFFICIENT_FUNDS` |
| Ledger accuracy | Ledger `amount_ngn` equals the real balance change |
| Concurrency | `SELECT … FOR UPDATE` + compare-and-set |
| Idempotency | `wallet_ledger.idempotency_key` written; replay returns original result |
| Audit | Written in the same transaction, before `COMMIT`; failure aborts the mutation |
| Rollback | Every failure path rolls back |

**Tests**

* `api/src/walletAdjust.test.ts` — 16 cases (see audit §B P0-1).
* `api/src/server.smoke.ts` — non-admin gets 403; zero and absurd amounts are
  rejected before any database access.

**Evidence:** `npm --prefix api test` → 56 pass / 0 fail.

**Residual risk.** The frontend `wallet:adminAdjust` shim passes an explicit
`points_delta`, so a NGN-only UI action correctly moves no points. Any *future*
caller that wants a points adjustment must pass `points_delta` explicitly; the
API will not infer it.

---

## P0-2 — Fabricated dashboard metrics

**Status: Fixed**

| Item | Detail |
| --- | --- |
| Affected | `api/src/server.ts` `GET /api/admin/reports`; `src/lib/neonClient.tsx` |
| Active users | Counted as `NOT is_suspended AND NOT is_terminated`, not copied from the total |
| Suspended users | Counted from `is_suspended`, no longer hard-coded to `0` |
| Missing metrics | Reported as `null`, never `0` |
| Frontend | No cross-metric fallback; `null` renders as unavailable |

**Tests**

* `api/src/server.smoke.ts` — "admin reports count active and suspended users
  instead of fabricating them" (asserts `activeUsers ≠ totalUsers`, a real
  suspended count, and `null` for an unavailable metric).
* `src/__tests__/adminDashboardShape.test.tsx` — "active is never inferred from
  the total user count"; "a missing active count does not fall back to the
  total".

**Evidence:** 631 frontend + 56 API tests pass.

**Metric definitions** (documented, source of truth = the SQL in `server.ts`):

| Metric | Definition |
| --- | --- |
| `activeUsers` | users where `NOT is_suspended AND NOT is_terminated` |
| `suspendedUsers` | users where `is_suspended` |
| `terminatedUsers` | users where `is_terminated` |
| `adminUsers` | users where `role = 'admin'` |
| `walletBalanceNgn` | `SUM(wallet_balance_ngn)` — total NGN liability, naira |
| `pointsOutstanding` | `SUM(points_balance)` — total points, separate unit |
| `escrowPending` | orders in `('pending','paid','escrow')` |
| `disputedOrders` | orders where `status = 'disputed'` |
| `ledgerEvents24h` | `wallet_ledger` rows in the last 24 hours |
| any `null` | source table missing or count failed — **not** a zero |

---

## P1-1 — Audit failure shown as an empty log

**Status: Fixed (2026-10-26) — both paths**

The **write** path was already fixed: a critical mutation cannot succeed
without its audit record (P0-1, proven by "an audit failure aborts the
mutation").

The **read** path used to disguise an outage as an empty trail at **two**
layers, which is why it stayed open:

| Layer | Before | After |
| --- | --- | --- |
| API `GET /api/admin/audit-logs` | `catch { return c.json({ logs: [] }) }` → **200** | `return fail(c, 503, "Audit log storage is unavailable")`, error logged |
| Shim `admin:getAuditLogs` (`src/lib/neonClient.tsx`) | `.catch(() => ({ logs: [] }))` → `[]` | `setState(null)` — `null` means *unreadable*, never `[]` |
| Page (`src/pages/AdminAuditLogs.tsx`) | `[]` rendered "No audit records match your filters." | three states: `undefined` = loading, `null` = outage notice, array = records |

The page now renders an explicit `role="status"` outage panel stating that this
is an outage, not an empty trail, and the record counter reads "Audit trail
unavailable" instead of "0 records".

**Tests**

* `api/src/server.smoke.ts` — "an unreadable audit trail reports 503
  unavailable, never an empty list" (asserts 503, asserts **no** fabricated
  `logs` array) and "a readable audit trail still returns its records with 200".
* `src/__tests__/adminAuditLogsState.test.tsx` — 4 cases: a failed read resolves
  to `unavailable` rather than `records:0`; a successful read still resolves to
  the records; the page shows the outage copy and **not** the empty copy; a
  genuinely empty trail still shows the empty copy.

**Evidence:** `bun test` → 635 pass / 0 fail; `npm --prefix api test` → 58 pass
/ 0 fail.

---

## P2-3 — Points marketplace route answered 503 forever (migration 008 pending)

**Status: Fixed (2026-10-26)**

`npm run migrate:dry-run` reported `Applied: 7, Pending: 1` —
`008_points_marketplace_read_model.sql` had never been applied. Boot-time
provisioning only fires when a **required** table is missing, and `/ready`'s
required list deliberately excludes migration 008, so a healthy production
database would never converge on its own.

Consequence: `GET /api/marketplace/packages` queries `point_market_packages` /
`point_market_vendors`, which did not exist, so the route caught the error and
returned `503 "Marketplace data is not available yet"` on every call. It is a
registered production endpoint (documented in
`docs/migration/CONVEX_NEON_PARITY_MATRIX.md`), so production was serving a
permanently failing route.

**Fix.** Applied through the repository's own audited runner (`npm run migrate`):
advisory-locked, checksum-verified, one transaction per migration. 008 is
additive only (`CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` on
two new tables) — no existing catalog, order, wallet or user data was read or
rewritten.

**Evidence.** `[migrate] Complete. Applied: 1, Already up-to-date: 7` —
followed by a dry-run reporting zero pending.

**Exposure note.** The frontend does not yet call this endpoint (marketplace
listing still reads Convex), so no user-facing screen was broken by the missing
table; the route was dead-on-arrival for the coming cutover.

---

## Dependency advisory review (2026-10-26)

**Status: Reviewed — no in-range fix exists; nothing reachable in production is
exposed**

`bun audit` reports 39 advisories (1 critical, 12 high, 22 moderate, 4 low).
`bun audit fix` reports **`Fixed 0 of 39`** — every remediation is blocked by a
published version range, so there is no safe in-range bump to make.

`npm --prefix api audit --omit=dev` → **0 vulnerabilities**. The Render backend
that owns auth, sessions and money is clean.

Reachability of the remaining clusters:

| Package | Advisories | Reached by production code? |
| --- | --- | --- |
| `@auth/core@0.37.4` | critical (homoglyph `@`), high, moderate | No. Only `@convex-dev/auth` imports it; `@convex-dev/auth/react` is aliased to `src/lib/neonClient.tsx` in `vite.config.ts`, so it is not in the browser bundle. Production auth is the Neon API's own scrypt + JWT. |
| `nodemailer@6.10.1` | high, moderate, low | No. Only `src/convex/email.ts` (Convex Node runtime). Zero imports outside `src/convex/`. |
| `undici@5.29.0`, `@fastify/busboy@2.1.1` | high, moderate | No. Transitive via `@vly-ai/integrations → ai → @ai-sdk/provider-utils`; only `src/convex/cloudieClassifierAction.ts` and `vite.config.ts` import that package — no React component does. |
| `zod@3.25.76` | high | No. `grep 'from "zod"' src` returns **nothing**; the direct `zod@^4.1.13` resolves to 4.6.7, outside the `<4.6.6` range. |
| `happy-dom@20.14.6` | high | No. Dev/test only (`@happy-dom/global-registrator`). |

**Deliberately not done.** Forcing major bumps (`@auth/core` → 0.41.3,
`nodemailer` → 10.x, `undici` → 6.x via an override) would break the declared
peer range of `@convex-dev/auth@0.0.90` and the SMTP client used by
`src/convex/email.ts`, on code paths that cannot be integration-tested from this
repository. Trading unverifiable breakage in live Convex code for advisories
that production traffic never reaches is the wrong trade. These become routine
once the Convex retirement lands — track them there.

**Follow-up:** re-run `bun audit` after Convex removal; the critical and the
nodemailer cluster should drop out with it.

---

## P1-2 — Bearer token in `sessionStorage`

**Status: Open (documented, not migrated)**

A partial cookie migration would break authentication, which the brief
prohibits. Current mitigations (HttpOnly session cookie, double-submit CSRF,
`SameSite=Lax`, `Secure` in production) are in place and tested. The recommended
migration path is documented in `docs/security/SECURITY_REVIEW.md`.

---

## P1-3 — No password reset or email verification

**Status: Open (not implemented)**

Requires an email provider and a reset-token table. No regression risk to
existing flows.

---

## P2-1 — In-memory rate limiter

**Status: Open**

Real protection within a single instance; does not survive restart or
scale-out. Recommended: move buckets to a shared store.

---

## Auth/session persistence (navigation invariants)

**Status: Verified present, no fix required**

| Invariant | State | Evidence |
| --- | --- | --- |
| Three-state session (`loading`/`authed`/`anon`) | Present | `src/hooks/useSession.tsx` |
| Skeleton while loading, never a redirect | Present | `RequireAuth`, `AppShell`; nav test "holds a skeleton while the session is unresolved instead of redirecting" |
| Single guard (shell does not redirect independently) | Present | `AppShell.tsx` comment + `RequireAuth.tsx` |
| Stable session key (no route-keyed refetch) | Present | `useSession.tsx` one request per page load, shared via `inFlightSession` |
| 5xx/network error does not end the session | Present | `readSession()` falls back to cached user on non-401 |
| Slow first read cannot overturn a concurrent sign-in | Present | functional `setState` guard in `useSession.tsx` |
| Drawer close/logout on close | Absent (correct) | nav test "keeps the session across drawer open/close and two workspace changes" |
| CSRF header on logout | Present | nav test "the logout request carries the Neon CSRF header" |
| Logout revokes server-side session | Present | `api_sessions.revoked_at = NOW()` in `/api/auth/logout` |

The `window.location.reload()` calls in `src/main.tsx` are guarded stale-chunk
recovery for lazy-loaded routes; they do not clear tokens and are not in nav
logic.
