# Slice 8 — credentials from the environment, and the pre-purchase account lookup

Two additions to the AidaPay integration. Both are about the same thing: the
window between "the customer has typed a destination" and "money has moved".

Nothing about the purchase path, the ledger, the webhook handler or the
reconciliation sweep changed. Everything here routes through the same tables and
the same three-state result the earlier slices established.

---

## 1. AidaPay credentials can be seeded from the environment

Until now the only way to give AidaPay a credential was to paste it into
`/admin/vtu/providers`, and the only provider with an environment path was
Pairgate (`migratePairgateFromEnv`). A deployment that keeps its secrets in the
project environment therefore had no supported way to configure the live
provider.

`migrateAidaPayFromEnv` (`vtuProviderAdmin.ts`) closes that. It is reachable
from the **Seed from env** button in *Advanced setup* on
`/admin/vtu/providers`, and directly:

```
bunx convex run vtuProviderAdmin:migrateAidaPayFromEnv '{}'
```

### What it reads

| Variable | Required | Notes |
|---|---|---|
| `AIDAPAY_API_KEY` | to create a row | Bearer token from AidaPay → Settings → API Settings |
| `AIDAPAY_ACCOUNT_PIN` | to buy | The 4-digit PIN every purchase must carry |
| `AIDAPAY_WEBHOOK_SECRET` | no | **Defaults to the API key**, which is the documented signing key |
| `AIDAPAY_STATUS` | no | `active` \| `sandbox` \| `disabled`. Defaults to `sandbox` |

The provider's *constants* — origin, health path, auth header and scheme,
signature header, timeout — are deliberately **not** environment variables. They
come from `PROVIDER_PRESETS` in `src/lib/vtuProviderPresets.ts`, the same module
the admin UI renders its preview from. A hand-typed base URL is exactly how
`https://aidapay.ng/api/v1` was once stored, producing
`.../api/v1/api/v1/buy` on every purchase.

### What it guarantees

- **Non-destructive.** It fills what is *missing* and never overwrites a
  credential that is already sealed. Re-running on every deploy cannot rotate a
  live key, and cannot revert a key an operator pasted by hand.
- **One row, ever.** A second run updates in place.
- **Sealed before storage.** Values are encrypted with `APP_MASTER_KEY` at the
  boundary. A plaintext credential never reaches the database.
- **Env is read at seed time only.** Purchases, webhooks and reconciliation
  continue to resolve the `vtuProviders` row and nothing else, with no env
  fallback under any condition — a deleted or disabled row fails loudly instead
  of being resurrected from a stale environment.
- **A missing key is reported, not thrown.** Convex redacts a thrown error's
  message in production; a status in the return value survives redaction.

Credentials themselves are added through the project's **Keys** panel. No secret
belongs in `.env.example`, and this document deliberately names variables
without values.

---

## 2. Recipient validation before charging

A meter or smartcard number is the one field on a bill-payment form a customer
cannot verify by eye, and a wrong one delivers the top-up to a stranger with
nothing to refund — the provider did exactly what it was asked. AidaPay exposes
`GET /validation/{provider_code}/{recipient}` for precisely that case, which is
the gap `docs/vtu-slice-7.md` §8 recorded as *"No recipient-name check before
charging"*.

### The three outcomes, which must stay distinguishable

| Outcome | Meaning | Effect on the purchase |
|---|---|---|
| `checked: true, valid: true` | the provider named the account holder | the name is shown; the customer confirms they are paying the right account |
| `checked: true, valid: false` | the provider says no such account | **blocked** — a destination that does not exist cannot be paid |
| `checked: false` | *we could not ask* | **not blocked** — the provider remains the authority at dispatch |

The third row is the design decision worth stating plainly. "Could not ask"
covers a rotated token (AidaPay answers a refused credential with a **302** to
its account page rather than a 401), an unsupported biller, a timeout, and an
unreadable body. Collapsing it into "invalid" would stop customers buying
because a lookup endpoint was briefly slow, which is a worse failure than the
typo this guards against. So `verifyRecipient` returns `null` for all of them,
and only a real verdict from the provider blocks.

### Where each piece lives

- **`providers/aidapay.ts`** — `validationPath()` and `mapValidationResponse()`.
  The mapper is pure and exported so the five response shapes it tolerates are
  testable without a network. It accepts both a nested `data` envelope and a
  flat body, because AidaPay documents the endpoint but not a field-level
  schema for its reply.
- **`vtuShared.ts`** — `ProviderRecipientCheck` and an **optional**
  `verifyRecipient?` on `VtuProviderAdapter`. Optional on purpose: a required
  method would break every existing adapter and the registry's completeness
  check with it, and an aggregator with no lookup endpoint is a legitimate
  provider rather than a broken one.
- **`vtuProviderCall.ts`** — `openForValidate` plus the `validateVtuRecipient`
  action. The new `validate` mode resolves through `resolveForPurchase` (a live
  provider only, because it is a step on the way to buying) and **never opens
  the account PIN**: a read-only "whose meter is this?" must not put a spend
  credential in memory.
- **`vtuInternal.ts`** — `resolveValidationTarget` runs the *same*
  `routeProduct` the purchase runs, so the biller that is looked up is the
  biller that would be charged. It returns scalars only; the provider's code is
  never sent to the browser.
- **`pages/VtuBills.tsx`** — a debounced lookup once the destination is
  well-formed, with superseded results discarded, so typing a twelve-digit
  number spends one call rather than twelve. The effect depends on primitives,
  not on the query's object identity, so re-rendering cannot re-ask.

### Cost and abuse

The lookup is a **metered provider call**, and it is the kind of endpoint that
gets hammered by an impatient retry. It is therefore authenticated and rate
limited at 30 lookups per minute per user, enforced by
`consumeValidationRateLimit` — a mutation, because a rate limit imposed by a
read-then-write *from an action* is not a limit at all.

Airtime is deliberately not validated: the endpoint answers "whose account is
this?" for a biller, and a phone number is not a billed account.

---

## 3. Tests

`tests/vtuRecipientValidation.test.ts` — **25 tests**, all driven against the
real purchase/routing modules or against the adapter with a fake `fetch`:

- **the mapper**: a nested `data.customer_name`, a flat `name`, an explicit
  `success: false` with the provider's own message, a terminal status word, and
  — the load-bearing one — that an unrecognised body yields `null` rather than a
  guess;
- **the adapter**: the URL is exactly
  `/api/v1/validation/{provider_code}/{recipient}`, the request is a `GET`, the
  auth header is composed from the row (`Authorization: Bearer …`), redirects
  are manual, a 302/404/500/transport failure all yield `null`, and a missing
  code or recipient is never sent;
- **the action**: unauthenticated is `AUTH_REQUIRED` with no provider call; a
  provider refusal is a *checked* refusal; a malformed destination is refused
  locally without spending a lookup; no route is `NO_ROUTE`; an adapter with no
  `verifyRecipient` is `ADAPTER_INCOMPLETE`, never a rejection; a thrown lookup
  is `LOOKUP_FAILED`; a disabled provider cannot be looked up; the account PIN is
  **never opened**; nothing about the provider crosses the wire; and the per-user
  budget is enforced;
- **the environment seed**: a missing key writes nothing; a successful seed
  writes every preset constant, seals the key, defaults the webhook secret to
  the token, and starts in `sandbox`; the defaulted secret is confirmed to
  decrypt to the API key, because that is the value a real callback is signed
  with; re-running changes nothing that is already stored; `AIDAPAY_STATUS`
  promotes, and a typo does not invent a status; a non-admin cannot seed.

Run them with `bun test tests/vtuRecipientValidation.test.ts`.

---

## 4. What is still not verified live

Unchanged from slice 7 and worth repeating, because this slice adds a
**customer-facing** call rather than an admin one: **no request in this slice has
been made to aidapay.ng.** The adapter, the mapper, the action and the UI are
verified against the documented shapes and against stubs; the first live
recipient lookup is still operator work, per
`docs/vtu-verification-runbook.md`.
