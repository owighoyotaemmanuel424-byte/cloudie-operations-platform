# Live Convex verification handoff

The script `scripts/verify-convex.ts` exercises the point marketplace against a live Convex deployment. It is deliberately not a CI test: it creates a real test order, credits points through the approved vendor path, and then expects an insufficient-funds rejection after a human changes the buyer's test wallet balance.

## Preconditions

- Use a **non-production Convex deployment** and test buyer/vendor accounts.
- Buyer and vendor must be different authenticated users.
- The vendor must be approved and own the selected active `pointPackages` package.
- The buyer must initially have enough NGN wallet balance to buy the package.
- Know the package's NGN price before starting. The script pauses for a human to lower the buyer balance below that price before the final assertion.
- Do not expose auth tokens in shell history, CI logs, commits, screenshots, or chat. Use the team's approved secret-handling method.

## Run

From repository root:

```bash
git checkout main
git pull --ff-only origin main

export CONVEX_URL='https://<your-non-production-deployment>.convex.cloud'
export BUYER_AUTH_TOKEN='<buyer-auth-token>'
export VENDOR_AUTH_TOKEN='<approved-vendor-auth-token>'
export TEST_PACKAGE_ID='<active-pointPackages-id-visible-to-buyer>'

bun run verify:convex
```

All four variables are required. The script fails before making calls if any is absent. It uses separate `ConvexHttpClient` instances and authenticates each with its corresponding token.

## Expected sequence

1. Resolves `TEST_PACKAGE_ID` through `api.pointMarket.listPackages` to a generated `Id<"pointPackages">`.
2. Calls `api.pointMarket.getMyOrder` with a nonexistent order ID and verifies a null result; separately checks `api.users.currentUser` to ensure the buyer token actually authenticates.
3. Calls `api.pointMarket.createOrder({ packageId })` as buyer and prints the returned `orderId`.
4. Queries the order as buyer and asserts `status === "escrow"`.
5. Calls `api.pointMarket.fulfillOrder({ orderId })` as the approved vendor.
6. Queries the order as buyer and asserts `status === "credited"`.
7. Pauses for a human to lower the **test buyer's NGN wallet** below the package price.
8. Calls `createOrder` again and requires the rejection message to contain the exact text `Insufficient NGN wallet balance`. It checks the error message, not a structured `data.code` field.

A zero exit status means all assertions passed. A non-zero exit status means the run failed or an assertion did not hold. The script's final success message is not a substitute for retaining the process exit code and output.

## Evidence to retain

Record:

- Git commit SHA.
- Convex deployment URL (never the tokens).
- Test package ID and the package's NGN price.
- Whether the buyer and vendor are separate accounts and the vendor is approved.
- Full console output, exit code, and any server error message.
- Confirmation that the buyer wallet was lowered below the package price before pressing Enter.
- Cleanup/restoration performed on test fixtures, including any test wallet adjustment.

## Important interpretation notes

- This is a live manual check, not a unit test and not evidence that GitHub Actions passed.
- The nonexistent-order query returning `null` alone does **not** prove authentication: `getMyOrder` also returns null when no user is authenticated. The script therefore separately requires `api.users.currentUser` to return a user.
- `createOrder` writes an order record before debiting the wallet; the backend cancels the order when the debit fails. Review the resulting test record/ledger if the final insufficient-funds assertion is run.
- Never run wallet adjustments or this test against a production buyer account.
- If an endpoint name or generated API type changes, stop and reconcile the script against the deployed source before attempting another live run.
