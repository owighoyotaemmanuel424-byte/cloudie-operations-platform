# CI and live-verification handoff

This handoff distinguishes repository configuration from runs that must be executed by a maintainer. A committed workflow is not evidence that a workflow ran or passed.

## 1. Regenerate the lockfile

Run from a checkout with GitHub CLI authenticated and repository write access:

```bash
git checkout main
git pull --ff-only origin main
gh workflow view regen-lock.yml
gh workflow run regen-lock.yml --ref main
gh run list --workflow=regen-lock.yml --branch main --limit 5
```

Open the newest run URL and wait for a terminal conclusion. Capture the run URL, conclusion, and full log for the “Commit lockfile if changed” step. Confirm whether it created a commit and that the commit is on `main`:

```bash
git fetch origin main
git log -5 --oneline origin/main
git show --stat --oneline origin/main
git diff origin/main^ origin/main -- bun.lock
```

If the workflow reports that the lockfile is already up to date, confirm the log says so and no lockfile commit was expected. Never edit `bun.lock` by hand.

### Push permission / branch protection caveat

`regen-lock.yml` has `permissions: contents: write` and checks out with `${{ secrets.GITHUB_TOKEN }}`. Its push trigger watches `package.json` and `bunfig.toml` on `main`; the `package.json` filter is present. The workflow's token cannot bypass repository rules by itself. Check **Settings → Rules → Rulesets** and **Settings → Branches** for protection/rules requiring pull requests, status checks, or restricting pushes. If direct pushes by `GITHUB_TOKEN` are blocked, the lockfile commit will fail at `git push`; inspect the run log. Use an approved fine-grained PAT stored as a repository secret with contents write permission and permitted branch access, or adjust the rule intentionally. Do not describe this as a silent success: require the terminal run result and push-step log.

## 2. Run the verification workflow after regeneration

Only after the lockfile commit has landed (or the regen run confirmed no change), run:

```bash
gh workflow run verify.yml --ref main
gh run list --workflow=verify.yml --branch main --limit 10
```

Open the run for the exact commit being verified. Capture the run URL and terminal conclusion, then inspect **both** `root` and `api` jobs and their complete relevant logs. The required root steps are frozen install, `bunx tsc -b --noEmit`, `bun test`, and `bunx tsc -p tsconfig.scripts.json`. The API job must run `npm --prefix api ci`, `npm --prefix api run typecheck`, and `npm --prefix api test`.

The current `verify.yml` triggers on push to `main`, pull requests targeting `main`, and manual dispatch. Its `lockfile-check` job performs one frozen install, inspects output for the lockfile-drift message, and exposes `drift`; `root` depends on that job and is gated by `if: needs.lockfile-check.outputs.drift == 'false'`. The script typecheck config includes `scripts/**/*.ts`. The API test script is `node --import tsx --test src/server.smoke.ts`, using Node's built-in test runner, not Vitest.

### Expected two-run behavior

A push that changes `package.json` can start `regen-lock.yml` and `verify.yml` in parallel. The first verification run may fail at `lockfile-check` because the old lockfile is stale. The regen workflow should then commit the new lockfile, which triggers a second verification run. Treat the second run on the regenerated commit as the decisive result; retain both URLs for audit. If regeneration cannot push, the second run will not be triggered by a lockfile commit.

## 3. Run the local committed-tree checks

From a clean checkout of the exact commit under review:

```bash
git checkout main
git pull --ff-only origin main
git status --short
bun install --frozen-lockfile
bunx tsc -b --noEmit
bun test
bunx tsc -p tsconfig.scripts.json
npm --prefix api ci
npm --prefix api run typecheck
npm --prefix api test
```

Record the commit SHA, command, exit status, and full output for each command. Do not claim success for commands not executed. A successful local run supplements but does not replace the GitHub Actions run evidence.

## 4. Optional live Convex marketplace verification

The live check is manual and must use a non-production test setup. Do not paste tokens into issues, commits, or logs.

```bash
export CONVEX_URL='https://<your-deployment>.convex.cloud'
export BUYER_AUTH_TOKEN='<buyer-token>'
export VENDOR_AUTH_TOKEN='<approved-vendor-token>'
export TEST_PACKAGE_ID='<test-package-id>'
bun run verify:convex
```

The buyer and approved vendor tokens must belong to separate authenticated accounts. Capture the exact command, deployment URL (not credentials), test package identifier, exit code, and full redacted output. Confirm the buyer has a suitable NGN wallet and the vendor is approved. The script's insufficient-funds assertion expects the exact message `Insufficient NGN wallet balance`; perform any required wallet adjustment only in the intended test deployment and restore the test fixture afterward. Never report this test as passed without its actual output.

## 5. Neon migration diagnostic

Do not run DDL against the production Neon branch. Follow `migrations/STATUS.md` and `scripts/neon-diagnose.sh`; use a disposable branch and a direct, non-pooled connection. The diagnostic runs every numbered migration twice with `psql -v ON_ERROR_STOP=1`, then inspects `schema_migrations` if present and lists public tables. Capture the exact failing file, PostgreSQL error text, and line if either pass fails. The script's operator-supplied branch name/ID must be independently checked against Neon Console; a URL alone cannot cryptographically prove its branch identity.

## Evidence checklist

- [ ] Regen workflow run URL and terminal conclusion.
- [ ] Regen “Commit lockfile if changed” log; lockfile commit SHA or “already up to date” evidence.
- [ ] Verification workflow run URL on the regenerated commit.
- [ ] Terminal conclusion and logs for both `root` and `api` jobs.
- [ ] Local command outputs and commit SHA, if local checks were run.
- [ ] Redacted live Convex output, if live verification was run.
- [ ] Redacted disposable-branch migration diagnostic output, if run.
- [ ] Explicit list of checks not executed or still blocked.

Until these artifacts are attached, CI/live verification status remains **unverified**, regardless of the workflow configuration in the repository.
