# Slice 7 — bills: electricity, cable, and data

Airtime was the only purchasable product through slice 6. The purchase path
accepted `airtime.<network>.<amount>` and nothing else, so a catalog row for a
disco or a data plan was a product nobody could buy. This slice makes the
grammar and the money path serve three more service types, and fixes the
AidaPay shapes that only a real bill would have exposed.

Everything here routes through the same tables, the same ledger, the same
webhook handler and the same reconciliation sweep as airtime. What changed is
the ADDRESS and the PRICE SOURCE, not the machinery.

## 1. The service-code grammar

`<serviceType>.<host>.<tail>`, where the tail's shape is the product's shape:

| Shape | Example | Product code | Price source |
|---|---|---|---|
| amount | `airtime.mtn.1000` | `airtime-mtn` | the customer's amount |
| amount | `electricity.ikeja-electric.5000` | `electricity-ikeja-electric` | the customer's amount |
| package | `data.mtn.1gb-30-days` | `data-mtn-1gb-30-days` | `vtuServiceCatalog.priceNgn` |
| package | `cable.dstv.compact` | `cable-dstv-compact` | `vtuServiceCatalog.priceNgn` |

A numeric tail is an amount; anything else is a package slug. `parseServiceCode`
checks the SHAPE only — whether a product exists is the catalog's answer, which
is what lets an operator add a disco, a biller, or a data plan with no deploy.
Airtime keeps its four-network whitelist and its 100–100,000 bounds in code,
because those predate the catalog.

`serviceCodeForProduct` is the inverse mapping (product code → the code a
customer buys with), and it is what `getPurchaseDetail` ships to the browser as
`serviceCodeTemplate`. The client fills `{amount}` and never learns the grammar.

## 2. What prices a package product

`vtuServiceCatalog.priceNgn` — the provider's naira price for ONE of these.
Amount-priced products leave it absent (their naira price IS the amount the
customer typed, so a value there could drift from the bounds). A package
product with neither a price nor an amount cannot be priced, and the purchase
refuses with a configuration message rather than charging zero.

The ledger's rate snapshot is built from this number, so it is the one value
that decides what a customer is charged in points. Set it from the provider's
own package list.

## 3. AidaPay's documented shapes (the fix)

Read from AidaPay's own API reference (`https://aidapay.ng/api`). Three things
the adapter had wrong or missing, all of which a real bill would have hit on the
first live purchase:

1. **`POST /buy` nests two levels deep.** `data.transaction_data` carries
   `transaction_hash`, `status`, `amount`, `commission`. Reading one level was
   how a legitimate `Processing` buy classified as an unrecognised response and
   never captured a provider reference — so its webhook could not match it and
   the sweep had nothing to poll for. `dataOf` now unwraps
   `transaction_data` when present and stays flat otherwise, which keeps
   `/transaction` and the webhook (both flat) working unchanged.
2. **The reference is `transaction_hash`.** It is preferred over `ref` (ours)
   because it is what AidaPay's dashboard displays and what
   `/transaction/{hash}` accepts.
3. **`amount` is documented as a string.** The request now sends
   `String(amount)`, matching the reference's own example.

## 4. Delivery values (the meter token)

For prepaid electricity the token IS the delivery: a confirmed purchase whose
token never reaches the customer is money spent for nothing.

`vtuTransactions.delivery` (optional) holds `{ token, units, serial, pin,
expires }`. It is written by whichever path carries it — the dispatch response,
a webhook, or a reconciliation poll — and MERGED rather than replaced, so a
later status update cannot erase a token an earlier one supplied. The adapter
maps AidaPay's `meter_token` / `meter_unit` / `serial_no` / `pin` / `expires`
onto those provider-agnostic names, and nothing above the adapter learns a
vendor's vocabulary.

Surfaced on the purchase page and in `/vtu/history`.

## 5. The pages

- `/vtu/bills?product=<productCode>` — one page for data, cable and
  electricity. It asks for the destination the catalog names, asks for an
  amount only when the product has one, prices through `api.vtu.previewCost` on
  the exact code it will buy, and then SUBSCRIBES to the transaction it created.
- `/vtu` — the catalogue's Buy button now links airtime to its own grid and
  everything else to the bills page. A product with no route, no price, or a
  code that cannot round-trip says "not available to buy yet" rather than
  failing after the click.
- `/admin/vtu/catalog` — the product form gained the fixed-price field, shown
  only when the customer does NOT choose an amount.

## 6. Selling a bill product — the operator's steps

Nothing is sellable until a catalog row and a route exist for it, and the
catalog is intentionally data rather than code:

1. **Find the provider's codes.** AidaPay exposes them under your token:
   `GET /api/v1/service/data-bundle-sme`, `/cable-tv-subscription`,
   `/meter-token` → `provider_code` per biller; then
   `GET /api/v1/packages/{provider_code}` → `package_api_code` and
   `package_amount` per plan. The Business dashboard shows the same lists.
2. **Create the product** at `/admin/vtu/catalog` → New product:
   - `productCode` — canonical: `electricity-ikeja-electric`, `data-mtn-1gb-30-days`,
     `cable-dstv-compact`. It is permanent, and it must begin with the service
     type (`electricity-`, `data-`, `cable-`).
   - `requiresAmount` on for electricity, off for data/cable.
   - `Fixed price ₦` for data/cable — the provider's price for the plan.
   - Destination label: `Meter number`, `Smartcard number`, `Phone number`.
3. **Create the route** on the same page: provider `aidapay`,
   `providerProductCode` = AidaPay's `provider_code`,
   `providerPackageCode` = AidaPay's `package_api_code` (data/cable only), and
   `providerProductCode` may carry `{amount}` for amount-priced products.
4. **Check the routing preview** on the same page — it runs the real routing
   function, so it names the provider a purchase would actually use.

Pairgate stays configured and enabled as a fallback: the new products simply
have no Pairgate route, so they fail closed (`NO_ROUTE_AVAILABLE`) rather than
being sent somewhere unchosen. Add a Pairgate route for any product you want it
to serve.

## 7. Tests

`tests/vtuBills.test.ts` (8 tests) drives the real purchase action against a
real Convex implementation with a stub adapter registered under AidaPay's name:

- an electricity top-up sends the meter number with the amount and NO package;
- a data bundle is priced from the catalog and sends the package code;
- a destination that does not match the service type is refused before any
  charge (no transaction row, no debit);
- a product addressed without the amount it requires fails with the typed
  routing refusal and does not burn the idempotency key;
- `getPurchaseDetail` reports the exact fixed price, the template, and the
  amount token;
- the catalogue lists both shapes as buyable;
- a webhook's meter token is written onto the transaction it settles.

`tests/vtuAidaPayCompat.test.ts` gained the documented-shape block: the nested
`/buy` envelope, a delivered buy inside it, a confirmed `/transaction` poll with
`meter_token`, and a signed webhook carrying the token. `tests/vtuLedger.test.ts`
pins the new grammar's two shapes.

## 8. Known gaps

1. **No catalog sync yet.** The steps in §6 are manual. A `GET /service/...` +
   `GET /packages/...` sync that creates products and routes for you is the
   obvious next slice — it is the difference between "the operator can add a
   plan" and "the operator clicks one button".
2. ~~**No recipient-name check before charging.**~~ **CLOSED** in
   `docs/vtu-slice-8.md` §2. AidaPay's
   `GET /validation/{provider_code}/{recipient}` is now called from the bills
   page before confirmation, and a destination the provider positively rejects
   cannot be paid for. The important half of that design: "we could not ask"
   does **not** block a purchase.
3. **Receipts do not carry the token yet.** It is on the purchase page and in
   history; the receipt document is a separate template change.
