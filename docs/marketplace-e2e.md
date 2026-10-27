# Marketplace browser end-to-end acceptance protocol

**Purpose:** prove the real deployed marketplace purchase flow, including live Convex reactivity and the two-currency presentation. This is a manual acceptance test, not evidence that the flow has passed. Run only with dedicated test buyer/vendor accounts and a non-production deployment/package. Never change a production wallet balance.

## Test setup

- Use a deployed build connected to the intended non-production Convex deployment.
- Have two separate browser sessions: buyer and approved vendor. Keep the buyer dialog open in one tab while the vendor fulfills in the other session.
- Confirm the buyer can access `/marketplace`, the vendor can access its order fulfillment view, and the operator has an approved way to lower the test buyer's NGN wallet for the insufficient-funds case.
- Record deployment URL, test date/time, package name/ID, package NGN price, initial NGN wallet balance, initial points balance, buyer/vendor test identities (redact private data), browser/version, viewport, and any console/network errors.
- Run the full protocol once at **375×667** and once at **1440×900**. Reset test data/balances between runs as needed.

## Test procedure and acceptance criteria

### 1. Establish the initial balances and package price

1. Sign in as the test buyer and open `/marketplace`.
2. Record the buyer's NGN wallet balance from the top-bar pill or wallet page, and record the cheapest visible package's NGN price.
3. Record the buyer's points balance before purchase.

**Pass:** the balance and price are legible and unambiguous. The package price is expressed in NGN; points reward is a separate quantity. Do not infer that points are NGN.

### 2. Inspect the review dialog

1. Click **Buy** on the cheapest package.
2. Confirm the dialog opens in the `review` state.
3. Inspect the price, points reward, and wallet-after amount.

**Pass criteria:**
- The NGN price is formatted with `fmtNaira`, in a monospace/tabular-number presentation.
- The points reward is formatted with `fmtPoints`, in monospace, with a leading `+` and success-green treatment.
- The wallet-after amount is displayed in NGN.
- No single rendered dialog line combines the NGN currency symbol with the reward-unit label (case-insensitive).
- The displayed wallet-after amount equals the starting NGN wallet balance minus the package price, bounded by the UI's documented arithmetic.
- Review copy clearly explains that NGN is held in escrow and points are credited only after vendor fulfillment.

Capture a screenshot of the review dialog at each viewport.

### 3. Confirm and inspect the pending order

1. Click **Confirm purchase** once.
2. Confirm the dialog transitions to `pending` / “Order in escrow”.
3. Record the order reference shown in the dialog.
4. Confirm the reference is monospace and exactly matches the `orderId` returned by `api.pointMarket.createOrder` (use browser network/devtools or server-side test instrumentation available to the operator; do not guess based only on a similar-looking ID).
5. Press **Escape** and confirm the dialog can be dismissed. Navigate to the order page using the same reference, then verify the order can be reopened in the purchase dialog from that page and that its reference and escrow state are preserved. If the order page only displays a separate detail page and does not reopen the dialog, record this criterion as FAIL rather than treating navigation alone as equivalent.

**Pass:** the order is created once, the reference matches, and the pending state accurately explains that points are not yet credited. The same order can be re-opened from its order page without creating a replacement. Record any inability to reopen or re-identify the same order as a failure.

### 4. Fulfill as the vendor and prove Convex reactivity

1. Keep the buyer's pending dialog open in its browser tab.
2. In the separate vendor session, find the same order by the exact reference and fulfill it using the normal vendor UI.
3. Watch the buyer tab without refreshing it.

**Critical pass criterion:** the buyer dialog transitions from `pending` to `success` **without a page reload**. This live transition is the acceptance evidence for the reactive Convex query path. A transition only after clicking Refresh or reloading is a failure for this criterion.
4. Inspect the success receipt:
   - **Paid:** NGN amount equals the package price.
   - **Wallet balance:** NGN amount equals the buyer wallet after deduction.
   - **Points credited:** signed `+N`, green, and equal to the package reward.
   - Order reference matches the original order.

Record the elapsed time from vendor fulfillment to buyer success and save a screenshot/video that shows the buyer tab changing without reload.

### 5. Reload and reconcile balances

1. Reload the buyer page after the receipt was shown.
2. Reopen the wallet/balance views and compare them with the receipt.
3. Record the post-purchase NGN wallet and points balances.

**Pass:** the persisted NGN balance is lower by exactly the package price; points balance is higher by exactly the credited reward; the values agree with the receipt. Investigate any mismatch before proceeding.

### 6. Force and verify insufficient funds

1. Using an approved admin/development workflow or Convex dashboard, lower the **test buyer's** NGN wallet balance to less than the package price. Record the before/after test balance. Never edit production data.
2. Record current NGN wallet and points balances.
3. Attempt another purchase of a package whose price exceeds the lowered balance.
4. Inspect the resulting dialog and reload the balance views.

**Pass criteria:**
- Dialog state is `failed`.
- Dialog contains the exact sentence **“You were not charged.”**
- NGN wallet balance is unchanged from immediately before the failed attempt.
- Points balance is unchanged from immediately before the failed attempt.
- No order/payment is incorrectly presented as successful or credited.

If the attempt is blocked in the review UI before confirmation, record that separately; this does not prove the backend rejection path. To test the backend rejection path, the confirmed attempt must reach `createOrder` and be rejected for insufficient funds without changing either balance. Preserve the exact error/console evidence with secrets redacted.

### 7. Responsive layout and accessibility pass

Repeat steps 1–6 at both required viewports: **375×667** and **1440×900**.

At each viewport confirm:
- Dialog fits within the viewport, uses its own vertical scrolling when needed, and does not overflow horizontally.
- All key amounts, order reference, error copy, and action buttons are visible/readable and reachable.
- Escape dismissal works where applicable; focus remains usable and buttons are not obscured by the mobile viewport.
- No overlapping, clipped, or inaccessible content appears when the keyboard/browser chrome is present on mobile.

Capture review, pending, success, and failed screenshots at both sizes.

## Result record

Copy this checklist into the test report and mark each row PASS / FAIL / BLOCKED. A BLOCKED result is not a pass.

- [ ] 375×667 — review formatting and currency-separation rules
- [ ] 375×667 — create order, matching reference, dismiss/reopen path
- [ ] 375×667 — vendor fulfillment updates buyer dialog without reload
- [ ] 375×667 — receipt and persisted balances reconcile
- [ ] 375×667 — insufficient-funds failure says “You were not charged.” and balances do not change
- [ ] 375×667 — no viewport overflow
- [ ] 1440×900 — review formatting and currency-separation rules
- [ ] 1440×900 — create order, matching reference, dismiss/reopen path
- [ ] 1440×900 — vendor fulfillment updates buyer dialog without reload
- [ ] 1440×900 — receipt and persisted balances reconcile
- [ ] 1440×900 — insufficient-funds failure says “You were not charged.” and balances do not change
- [ ] 1440×900 — no viewport overflow

Attach the deployment URL, timestamps, screenshots/video, redacted order references, initial/final NGN and points balances, exact failure output (if any), and browser console/network errors. Acceptance is complete only when every criterion passes at both viewports and the evidence is reviewed.
