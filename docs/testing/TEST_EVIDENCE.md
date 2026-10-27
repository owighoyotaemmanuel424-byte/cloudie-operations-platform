# Test Evidence

All results below were produced in this environment on commit `c1ea2f9`
(plus the changes described in this audit). Nothing is copied from a previous
run, and no result is inferred.

---

## Commands and outcomes

### 1. Frontend + shared tests

```
$ bun test
 631 pass
 0 fail
 2536 expect() calls
Ran 631 tests across 35 files. [3.87s]
```

**Exit 0.** Includes the 16 new wallet-adjust-adjacent frontend assertions and
the dashboard metric-accuracy tests.

### 2. API tests (Node test runner + tsx)

```
$ npm --prefix api test
# tests 56
# pass 56
# fail 0
# duration_ms ~1775
```

**Exit 0.** Comprises:

* `api/src/server.smoke.ts` — middleware, CSRF, CORS, auth, bootstrap, and the
  new reports/wallet-adjust authorization tests.
* `api/src/walletAdjust.test.ts` — **16 new cases** (see below).
* `api/scripts/*.test.mjs` — migration-runner and marketplace-export tests.

### 3. Frontend typecheck

```
$ bunx tsc -b --noEmit
```

**Exit 0.**

> Note: on this host `tsc -b` can exceed the 180 s command cap. When it does,
> the equivalent is to typecheck the two project configs it builds:
> `bunx tsc --noEmit -p tsconfig.app.json` → exit 0 and
> `bunx tsc --noEmit -p tsconfig.test.json` → exit 0. Both were run and pass.

### 4. API typecheck

```
$ npm --prefix api run typecheck
> tsc --noEmit -p tsconfig.json
```

**Exit 0.**

### 5. Full verification script

`bash scripts/verify.sh` runs the four commands above in sequence. Not run as a
single invocation here only because of the host's per-command time cap; each
constituent command was run individually and passed.

---

## New regression coverage

### `api/src/walletAdjust.test.ts` — 16 cases

| # | Test | Guards against |
| --- | --- | --- |
| 1 | rejects a zero amount | no-op mutation |
| 2 | rejects NaN, Infinity, strings, malformed bodies | malformed input reaching SQL |
| 3 | rejects sub-kobo precision and absurd magnitudes | overflow / precision loss |
| 4 | debit-only request parses as NGN-only | silent points coupling |
| 5 | NGN credit leaves points untouched | **P0-1 unit mix** |
| 6 | points-only adjustment leaves NGN untouched | **P0-1 unit mix** |
| 7 | explicit dual adjustment applies each unit by its own amount | unit separation |
| 8 | rejects a debit larger than the balance instead of clamping | **P0-1 clamping** |
| 9 | rejects a points debit larger than the balance | points insolvency |
| 10 | ledger row records the actual balance change | **P0-1 ledger drift** |
| 11 | unknown user → `USER_NOT_FOUND`, writes nothing | phantom mutation |
| 12 | two concurrent debits: exactly one succeeds | **double-spend** |
| 13 | retried request with the same key applies once | **duplicate debit** |
| 14 | ledger failure rolls back the balance change | partial commit |
| 15 | audit failure aborts the mutation | **silent audit loss** |
| 16 | audit details carry actor, before/after, reason | non-attributable change |

### API smoke additions

* non-administrators cannot reach the wallet adjustment endpoint (403).
* wallet adjustment rejects malformed amounts before touching the database
  (the fake pool throws if queried — proving no DB access).
* admin reports count active and suspended users instead of fabricating them;
  an unavailable metric is `null`, not `0`.

### Frontend additions (`src/__tests__/adminDashboardShape.test.tsx`)

* "active is never inferred from the total user count".
* "a missing active count does not fall back to the total".

---

## CI

Workflow: `.github/workflows/ci.yml` — runs on every push and pull request,
Node 22 + Bun, `npm install --legacy-peer-deps`, then the typechecks and both
test suites.

**Not verified:** no CI run URL is cited here, because CI status could not be
read from this environment. The commands above are exactly what CI executes,
and they pass locally, but a green remote run has **not** been observed for
this commit. Treat CI as unverified until the run is checked in GitHub.

---

## Checks that were NOT run

| Check | Reason |
| --- | --- |
| `npm audit` / dependency CVE scan | not executed in this environment |
| `vite build` (production bundle) | excluded per project rules (build is slow); typecheck covers compile correctness |
| Live staging smoke tests | no staging environment reachable from here |
| Migration against a live Neon branch | requires `TEST_DATABASE_URL`; no branch was provisioned |
| `bash scripts/verify.sh` as one command | host per-command time cap; all four constituent commands pass individually |
| Convex deployment verification | requires a live Convex deployment and its URL |

These are reported as **not run**, never as passing.
