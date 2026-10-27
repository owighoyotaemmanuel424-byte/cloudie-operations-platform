# Security Review

Source-level review of the Cloudie platform at commit `c1ea2f9`.
**No penetration test was performed.** This is a code review, not an
assessment against a live target. No destructive or adversarial testing was run
against production.

---

## Confirmed controls (verified in source)

| Control | Implementation | Verified by |
| --- | --- | --- |
| Password hashing | scrypt, 16-byte random salt, `timingSafeEqual` comparison | `api/src/server.ts`; smoke tests |
| JWT validation | HS256; issuer `cloudie-neon-api`; audience `cloudie-web`; requires `sub` **and** `jti` | `auth` middleware |
| Server-side session state | every request checks `api_sessions` for an existing, unrevoked, unexpired row | `auth` middleware; smoke test "rejects revoked or expired server-side sessions" |
| Account-state enforcement | suspended or terminated users are rejected at `auth` | `auth` middleware |
| Server-side authorization | `adminOnly` on every `/api/admin/*` route; role read from the database, never from the client | 403 smoke tests (users **and** wallet-adjust) |
| CSRF | double-submit (`cloudie_csrf` cookie vs `X-CSRF-Token`), `timingSafeEqual`, unsafe methods only, skipped for Bearer clients | 5 CSRF smoke tests |
| CORS | exact-match allow-list from `CORS_ORIGINS`; **no suffix matching**, so unrelated tenants on a shared host cannot spoof an origin | `isAllowedOrigin` |
| Security headers | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Cache-Control: no-store` | middleware |
| Admin bootstrap | disabled unless a ≥32-byte token is configured; timing-safe compare; `pg_advisory_xact_lock` serializes concurrent attempts; rejects when an admin already exists; writes an audit row | smoke tests |
| No account oracle | unknown email and wrong password return the identical error | smoke test |
| SQL injection | every query uses `$n` parameters; no string-interpolated SQL found in `server.ts` | full-file review |
| Secrets | none committed; `.env*` git-ignored; `JWT_SECRET` and `DATABASE_URL` required at boot | repo inspection |
| Logout revocation | sets `api_sessions.revoked_at = NOW()` — a stolen token dies with the session | `logout` handler |
| Financial mutation safety | `wallet-adjust` locks the row, validates, is idempotent, and cannot succeed without its audit row | `walletAdjust.test.ts` |

---

## Confirmed findings

### S1 — Access token stored in `sessionStorage` (P1, open)

**Finding.** `src/lib/neonApi.ts` keeps the bearer token in
`window.sessionStorage`. Any XSS can read it and impersonate the user until it
expires (8 hours).

**Why it is not fixed here.** The API already sets an HttpOnly `cloudie_session`
cookie *and* the frontend keeps a bearer token — both are sent today. Removing
the client-side token without proving every request carries a valid cookie
would break authentication, which the brief explicitly forbids ("Do not make a
partial cookie migration that breaks authentication").

**Recommended path (owner decision required):**

1. Confirm the frontend and API are same-origin (or that the cookie is
   delivered and accepted cross-site with `Secure` + `SameSite=None`).
2. Remove `TOKEN_KEY` from `sessionStorage`; stop sending `Authorization`.
3. Rely on the HttpOnly cookie + CSRF header (already implemented and tested).
4. Verify: login, refresh, logout, expiry, and every admin route — with the
   bearer path disabled.
5. Add a regression test asserting no `Authorization` header is set.

**Exposure meanwhile:** limited — `sessionStorage` is per-tab and clears on
close; the CSRF header is still required for unsafe cookie-authenticated
requests.

### S2 — In-memory rate limiting (P2, open)

`checkRateLimit` uses a module-level `Map`. It resets on restart and is
per-instance, so with N instances the effective limit is N×. It genuinely
mitigates single-instance credential spraying but is not a durable control.
Move the buckets to a shared store (Postgres or a cache) for real protection.

### S3 — Audit-log read path degrades to an empty list (P1, open)

`GET /api/admin/audit-logs` returns `{ logs: [] }` when the query fails, so an
outage looks like "no privileged activity". The **write** path is fixed (a
critical mutation cannot succeed without its audit row), but the read path
should return a typed `unavailable` state. An administrator could be misled
during an audit-store outage.

### S4 — No password reset or email verification (P1, open)

There is no reset-token table and no mail integration. Users who forget a
password have no self-service recovery. Requires an email provider and a
migration. Availability of a reset endpoint must include rate limiting and
non-enumerable responses.

---

## Areas reviewed with no issue found

* **IDOR / tenant isolation:** user-scoped queries filter on `user_id` from the
  session, never from the request body; `/api/tenants` scopes non-admins to
  tenants they own or belong to.
* **Open redirect:** login `returnTo` is a path, validated before redirect.
* **Error disclosure:** handlers return stable, user-safe messages; SQL errors
  are not echoed. Bootstrap and login failures do not leak account state.
* **Webhook replay:** no webhook endpoint is exposed on the Neon API yet (the
  payment-provider webhooks remain Convex-side); nothing to exploit here today.
* **Privilege escalation:** role changes go through `PATCH /api/admin/users/:id`
  guarded by `adminOnly`; the role value is a server-side enum.
* **Unbounded queries:** every list endpoint applies `LIMIT` (capped at 100).

---

## Limitations of this review

* No dynamic testing, fuzzing, or penetration test was performed.
* Dependency CVE scanning (`npm audit` against a production-resolved tree) was
  not run in this environment.
* The deployed production commit and the Neon branch used by each environment
  could not be verified — that requires Render and Neon dashboard access.
* Convex-side financial code paths (payments, VTU, escrow) were reviewed for
  *presence and design intent*, not exhaustively audited line by line.
