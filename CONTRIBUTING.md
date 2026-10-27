# Contributing

## Changing dependencies

Any change to `package.json` (dependencies or scripts) requires regenerating `bun.lock`. Batch all planned manifest changes before regenerating:

1. Push the complete `package.json` change to `main`.
2. Run `gh workflow run regen-lock.yml --ref main`.
3. Wait for the workflow to finish and its lockfile commit to land on `main`.
4. Confirm that no newer `package.json` change landed after that lockfile commit. If one did, run regeneration again.
5. Run `gh workflow run verify.yml --ref main`.

`verify.yml` intentionally uses `bun install --frozen-lockfile` to detect drift. Do not hand-edit `bun.lock` or disable frozen installs.

## Live Convex verification

`bun run verify:convex` is manual-only and is not run in CI. It requires a live Convex dev deployment, separate buyer and approved-vendor test tokens, a test package, and a wallet adjustment before the insufficient-funds check.

`verify-convex.ts` requires **two** authenticated test accounts: a buyer (any user with an NGN wallet) and an approved vendor (required for `fulfillOrder`). Set `BUYER_AUTH_TOKEN` and `VENDOR_AUTH_TOKEN` separately. The insufficient-funds step asserts on the message `Insufficient NGN wallet balance` and will pause for you to lower the buyer's wallet before continuing.


**Why you will see two verification runs**

A push that changes `package.json` triggers both `regen-lock.yml` and `verify.yml` in parallel. The first `verify.yml` run will **fail** at the `lockfile-check` job — this is the guard catching real drift, not a bug. `regen-lock.yml` then commits an updated `bun.lock`, which triggers a second `verify.yml` run that passes. Only the second run's result matters. If you push additional `package.json` changes before the regen commit lands, the cycle repeats — batch dependency changes into a single commit whenever possible.
