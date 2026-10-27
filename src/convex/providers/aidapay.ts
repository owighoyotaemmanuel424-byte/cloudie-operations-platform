"use node";

/**
 * AidaPay VTU adapter.
 *
 * The second real adapter, and the proof that a new aggregator is a new file
 * plus a `vtuProviders` row. Nothing above `vtuRegistry.ts` changes: the
 * routing table picks the provider by name, the credential layer opens the row
 * and hands this adapter an opaque `ProviderCallOptions`, and the ledger knows
 * only `ProviderPurchaseResult`.
 *
 * ── Endpoint shapes ──────────────────────────────────────────────────
 * AidaPay publishes documented endpoints, so unlike Pairgate's speculative
 * paths these are transcribed from AidaPay's API reference. The two this
 * adapter owns are isolated in `purchasePath()` and `transactionPath()`, plus
 * the mappers below, so a correction is a two-line change here and nowhere
 * else.
 *
 * THE HEALTH PATH IS NOT HERE, and that is deliberate rather than an
 * omission. `GET /my_account` is a read-only probe an operator runs from
 * `/admin/vtu/providers`, not a step in any purchase, so it is admin data on
 * `vtuProviders.healthPath` rather than adapter code — the same way it works
 * for Pairgate. A previous revision of this comment named an `accountPath()`
 * function that was never written, which is how the wrong path went
 * unnoticed: the comment described a seam the code did not have.
 *
 * WHAT `baseUrl` IS, because the two halves of the system read it differently
 * and this is the trap. This adapter composes `baseUrl + purchasePath()`, and
 * `purchasePath()` already carries the `/api/v1` prefix — so the row's `baseUrl`
 * must be the BARE ORIGIN (`https://aidapay.ng`), and the health path must
 * therefore be the full `/api/v1/my_account`. Setting `baseUrl` to
 * `https://aidapay.ng/api/v1` yields `.../api/v1/api/v1/buy` on every purchase.
 *
 * ── No sandbox ───────────────────────────────────────────────────────
 * AidaPay publishes no sandbox endpoint. Verification is against production,
 * with Pairgate temporarily disabled so nothing reaches a real customer — see
 * `docs/vtu-verification-runbook.md`. This adapter has NOT been exercised against a
 * live AidaPay endpoint. Status and scope: see `docs/vtu-slice-5.md`, section
 * "Slice 4 status" — which this file is named in, so the two stay in sync.
 *
 * ── Bill purchases (slice 7) ─────────────────────────────────────────
 * `POST /buy` serves airtime, data, cable and electricity alike: the product
 * travels in `provider_code`, a plan in `package_code`, and an amount (for
 * airtime and electricity) in `amount` — which is sent as a STRING because
 * that is the type the reference documents and shows. Electricity returns the
 * meter token that IS the delivery, so `deliveryOf` maps it onto the
 * provider-agnostic `delivery` values the transaction stores. Scope and the
 * operator steps: `docs/vtu-slice-7.md`.
 */

import { createHmac } from "node:crypto";
import { mapProviderStatus } from "../vtuProviderStatus";
import type { ProviderStatusVerdict } from "../vtuProviderStatus";
import { composeAuthHeader } from "../vtuShared";
import type {
  ProviderCallOptions,
  ProviderCallbackEvent,
  ProviderPurchaseRequest,
  ProviderPurchaseResult,
  ProviderRecipientCheck,
  ProviderRecipientRequest,
  VtuProviderAdapter,
} from "../vtuShared";
import type { VtuDelivery } from "../vtuSchema/types";
import { safeEqualHex } from "./signature";

// ─── Endpoint mapping (from AidaPay's API reference) ────────────────

function purchasePath(): string {
  return "/api/v1/buy";
}

/**
 * AidaPay's authoritative re-read, by ref.
 *
 * RATE LIMITED by AidaPay to 3 calls per 5 minutes. Nothing in slice 4 calls
 * this — it exists to satisfy the interface so slice 5 can add reconciliation
 * without a signature change, and slice 5 owns the budget.
 */
function transactionPath(ref: string): string {
  return `/api/v1/transaction/${encodeURIComponent(ref)}`;
}

/**
 * AidaPay's account-holder lookup, by provider code and destination.
 *
 * Read-only, and the only pre-purchase call in this adapter. It answers "whose
 * meter / smartcard / number is this?", which is what stops a typo becoming a
 * delivered top-up for a stranger. It never spends, so it takes no PIN.
 */
function validationPath(providerCode: string, recipient: string): string {
  return `/api/v1/validation/${encodeURIComponent(providerCode)}/${encodeURIComponent(recipient)}`;
}

/** AidaPay's `provider_code` for a Nigerian mobile network. */
function providerCodeOf(network: string | undefined): string | undefined {
  const n = (network ?? "").trim().toLowerCase();
  return n === "" ? undefined : n;
}

// ─── Status interpretation ───────────────────────────────────────────

/**
 * AidaPay's vocabulary, transcribed from its published transaction statuses:
 * Completed, Processing, Pending, Refund, Cancelled.
 *
 * Deliberately NOT widened. A word AidaPay has never been observed to send
 * must keep resolving to `unknown`, because guessing "confirmed" marks
 * undelivered airtime as paid for.
 *
 * Note the two failures are DIFFERENT facts. `Refund` means the top-up was
 * pulled back after acceptance; `Cancelled` means the transaction was stopped.
 * Both refund the customer, so both map to a failed verdict — and the shared
 * classifier keeps the reason distinguishable so it reaches the transaction
 * row as a cancellation rather than a generic rejection.
 */
export const AIDAPAY_STATUS_VOCABULARY = {
  confirmed: ["completed"],
  failed: ["refund"],
  cancelled: ["cancelled"],
  processing: ["pending", "processing"],
} as const;

/**
 * AidaPay's status word, classified.
 *
 * A named wrapper rather than a raw `mapProviderStatus` call at each site, so
 * the vocabulary is bound to this adapter in one place and a test asserting
 * the five published statuses exercises the SAME function the adapter uses.
 */
export function mapAidaPayStatus(rawStatus: unknown): ProviderStatusVerdict {
  return mapProviderStatus(rawStatus, AIDAPAY_STATUS_VOCABULARY);
}

// ─── Response parsing helpers ────────────────────────────────────────

function num(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * The object that actually carries the transaction.
 *
 * THREE shapes, all real, all from AidaPay's own documentation:
 *
 *   POST /buy          `data.transaction_data`
 *   GET  /transaction  a flat `data`
 *   a webhook          the body ITSELF — no envelope at all
 *
 * Unwrapping in one place is what keeps every reader below ignorant of which
 * route delivered the payload. Missing this one level was how a `Completed`
 * buy read as unrecognised.
 */
function dataOf(body: unknown): Record<string, unknown> {
  const b = (body ?? {}) as Record<string, unknown>;
  const nested = b.data;
  const d =
    nested && typeof nested === "object" ? (nested as Record<string, unknown>) : b;
  const transaction = d.transaction_data;
  return transaction && typeof transaction === "object"
    ? (transaction as Record<string, unknown>)
    : d;
}

/**
 * What the CUSTOMER needs from a delivered purchase.
 *
 * A prepaid meter returns a token and its units, and an internet or e-pin
 * product returns a serial, a PIN and an expiry. Undefined when none are
 * present — the normal case — so a caller can tell "delivered nothing of the
 * kind" from "delivered an empty object".
 */
function deliveryOf(
  ...sources: Record<string, unknown>[]
): VtuDelivery | undefined {
  const pick = (key: string): string | undefined => {
    for (const source of sources) {
      const value = str(source[key]);
      if (value !== undefined) return value;
    }
    return undefined;
  };

  const delivery: VtuDelivery = {};
  const token = pick("meter_token");
  const units = pick("meter_unit");
  const serial = pick("serial_no");
  const pin = pick("pin");
  const expires = pick("expires");
  if (token !== undefined) delivery.token = token;
  if (units !== undefined) delivery.units = units;
  if (serial !== undefined) delivery.serial = serial;
  if (pin !== undefined) delivery.pin = pin;
  if (expires !== undefined) delivery.expires = expires;

  return Object.keys(delivery).length > 0 ? delivery : undefined;
}

/**
 * The reference AidaPay will echo back on a callback.
 *
 * `ref` is what WE sent (the Convex transaction id), so it is the only value
 * guaranteed to be present and is the first candidate. AidaPay's own `hash` is
 * preferred when present because it is what its dashboard displays.
 */
function referenceOf(b: Record<string, unknown>, d: Record<string, unknown>): string | undefined {
  return (
    str(d.hash) ??
    // AidaPay's authoritative id, and the name its documentation uses on both
    // the buy response and the callback.
    str(d.transaction_hash) ??
    str(d.reference) ??
    // OUR reference as AidaPay echoes it back — the `ref` we sent.
    str(d.ref) ??
    str(b.hash) ??
    str(b.transaction_hash) ??
    str(b.reference) ??
    str(b.ref)
  );
}

// ─── Purchase response mapping ───────────────────────────────────────

/**
 * Map an AidaPay `/buy` response onto the provider-agnostic three-state union.
 *
 * `processing` deliberately becomes `unknown`, not `success` and not `failed`:
 * AidaPay accepted the purchase and has not finished it, so the points stay
 * debited and the row waits for the webhook.
 */
export function mapPurchaseResponse(
  body: unknown,
  fallbackReference: string,
): ProviderPurchaseResult {
  const b = (body ?? {}) as Record<string, unknown>;
  const d = dataOf(body);
  const providerReference = referenceOf(b, d);
  const verdict = mapAidaPayStatus(d.status ?? b.status);

  if (verdict.kind === "confirmed") {
    const costNgn = num(d.cost) ?? num(d.amount) ?? num(d.price);
    if (costNgn === undefined) {
      // Delivered but unpriceable. Success would leave the customer out of
      // pocket with nothing to reconcile against; failure would refund a
      // delivered top-up. `unknown` is the only honest answer.
      return {
        status: "unknown",
        message: "Provider reported Completed without a chargeable amount",
        providerReference,
        raw: body,
      };
    }
    const delivery = deliveryOf(b, d);
    return {
      status: "success",
      providerReference: providerReference ?? fallbackReference,
      costNgn,
      ...(delivery ? { delivery } : {}),
      raw: body,
    };
  }

  if (verdict.kind === "failed") {
    return {
      status: "failed",
      code: str(d.code) ?? str(b.code) ?? "PROVIDER_REJECTED",
      message: str(d.message) ?? str(b.message) ?? "The provider rejected this purchase",
      failureKind: verdict.failureKind,
      providerReference,
      raw: body,
    };
  }

  if (verdict.kind === "processing") {
    return {
      status: "unknown",
      message: "AidaPay is still processing this purchase",
      providerReference,
      raw: body,
    };
  }

  return {
    status: "unknown",
    message: `Unrecognised AidaPay response (status="${String(d.status ?? b.status ?? "")}")`,
    providerReference,
    raw: body,
  };
}

// ─── Recipient validation ────────────────────────────────────────────

/**
 * Map AidaPay's validation response onto the provider-agnostic verdict.
 *
 * DEFENSIVE ON PURPOSE, and for a different reason than the purchase mappers.
 * AidaPay documents the ENDPOINT but not a field-level schema for its reply, so
 * the name is looked for under every plausible key rather than one. Returning
 * `null` when nothing recognisable is present is the important half: a caller
 * that treated "unreadable" as "invalid" would refuse purchases whenever the
 * provider was vague, and one that treated it as "valid" would render an empty
 * name as a confirmed one. Neither guess is made here.
 */
export function mapValidationResponse(
  body: unknown,
): ProviderRecipientCheck | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const d = dataOf(body);

  const name =
    str(d.customer_name) ??
    str(d.customerName) ??
    str(d.account_name) ??
    str(d.accountName) ??
    str(d.meter_name) ??
    str(d.smartcard_name) ??
    str(d.receiver_name) ??
    str(d.name) ??
    str(b.customer_name) ??
    str(b.customerName) ??
    str(b.name);

  if (name !== undefined) return { valid: true, customerName: name };

  // No name, but an explicit negative. AidaPay signals a destination it does
  // not recognise with `success: false` and a message rather than a 404.
  const flag = d.valid ?? d.success ?? b.valid ?? b.success;
  if (flag === false) {
    return {
      valid: false,
      message: str(d.message) ?? str(b.message) ?? "The provider did not recognise that number",
    };
  }

  // A terminal status word is a verdict even without a name: `Cancelled` on a
  // lookup means the lookup could not be honoured.
  const verdict = mapAidaPayStatus(d.status ?? b.status);
  if (verdict.kind === "failed") {
    return {
      valid: false,
      message: str(d.message) ?? str(b.message) ?? "The provider rejected this lookup",
    };
  }

  return null;
}

// ─── Signature header ────────────────────────────────────────────────

/**
 * Header names AidaPay may sign under.
 *
 * `vtuHttp` lowercases every inbound header before calling, and aliases the
 * row's configured `callbackSignatureHeader` onto these, so an operator who
 * renames the header in admin needs no code change. AidaPay documents
 * `Signature`; the rest are tolerated rather than relied on.
 */
const SIGNATURE_HEADERS = ["signature", "x-signature", "x-aidapay-signature"];

function signatureFrom(headers: Record<string, string>): string | null {
  for (const name of SIGNATURE_HEADERS) {
    const value = headers[name] ?? headers[name.toLowerCase()];
    if (value) return value.replace(/^sha256=/, "").trim();
  }
  return null;
}

// ─── Adapter ─────────────────────────────────────────────────────────

export const aidapayAdapter: VtuProviderAdapter = {
  name: "aidapay",
  displayName: "AidaPay",

  async purchase(
    req: ProviderPurchaseRequest,
    opts: ProviderCallOptions,
  ): Promise<ProviderPurchaseResult> {
    // AidaPay requires a provider-level 4-digit PIN on every purchase. If the
    // row has none sealed, this purchase CANNOT be dispatched.
    //
    // `failed` — not `unknown` — is the honest answer: nothing was sent, so
    // nothing can have reached the carrier, and the customer is refunded
    // immediately instead of waiting on a webhook that will never arrive.
    // Sending a zero or empty PIN instead would be refused by AidaPay with a
    // far less actionable message.
    const accountPin = (opts.accountPin ?? "").trim();
    if (accountPin === "") {
      return {
        status: "failed",
        code: "ACCOUNT_PIN_NOT_CONFIGURED",
        message:
          "This payment provider has no account PIN configured. An operator must add one before it can serve purchases.",
        failureKind: "rejected",
        raw: { attempted: true, dispatched: false },
      };
    }

    // `amount` is only sent when the product has a face value. AidaPay accepts
    // it alongside a fixed `package_code` for data plans, and requires it for
    // airtime, where the code names the network rather than the size.
    const amount = req.amountNgn;
    const providerCode = providerCodeOf(req.network);
    const packageCode = str(req.providerPackageCode);

    // `ref` is the PHYSICAL attempt id (our Convex transaction id), NOT the
    // client's logical request id. AidaPay 403s a duplicate `ref`, and our
    // own rule releases the idempotency key on failure so a customer can retry
    // with the SAME client request id — forwarding that upstream would 403
    // every legitimate retry. The transaction id is unique per attempt, so a
    // retry always carries a ref AidaPay has not seen.
    const rawBody = JSON.stringify({
      recipient: req.customerIdentifier,
      ...(providerCode ? { provider_code: providerCode } : {}),
      account_pin: accountPin,
      ref: req.attemptId,
      // A STRING, because that is the type AidaPay documents and shows in its
      // own request example. It also removes any dependence on how a PHP
      // backend would coerce a JSON number.
      ...(amount !== undefined ? { amount: String(amount) } : {}),
      ...(packageCode ? { package_code: packageCode } : {}),
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

    try {
      const response = await opts.fetchImpl(
        `${opts.baseUrl.replace(/\/+$/, "")}${purchasePath()}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            // Composed from the ROW (authScheme "bearer", authHeader
            // "Authorization"), never hand-built here, so the sandbox and
            // production rows authenticate identically to the test probe.
            ...composeAuthHeader(opts),
          },
          body: rawBody,
          signal: controller.signal,
        },
      );

      const text = await response.text();

      // 5xx and 429 are the server's problem, not the customer's: the outcome
      // is undetermined, so this is `unknown` and the row stays unresolved.
      if (response.status >= 500 || response.status === 429) {
        return {
          status: "unknown",
          message: `AidaPay returned HTTP ${response.status}`,
          raw: { status: response.status, body: text },
        };
      }

      let parsed: unknown;
      try {
        parsed = text ? JSON.parse(text) : {};
      } catch {
        return {
          status: "unknown",
          message: "AidaPay returned a non-JSON response",
          raw: { status: response.status, body: text },
        };
      }

      if (!response.ok) {
        const b = parsed as Record<string, unknown>;
        const d = dataOf(parsed);
        // A 4xx body can still name a terminal state (a Cancelled transaction
        // is reported with one), so classify rather than assuming every
        // non-2xx is the same kind of rejection.
        const verdict = mapAidaPayStatus(d.status ?? b.status);
        return {
          status: "failed",
          code: str(b.code) ?? str(d.code) ?? `HTTP_${response.status}`,
          message: str(b.message) ?? str(d.message) ?? "AidaPay rejected this purchase",
          ...(verdict.kind === "failed" ? { failureKind: verdict.failureKind } : {}),
          providerReference: referenceOf(b, d),
          raw: parsed,
        };
      }

      return mapPurchaseResponse(parsed, req.attemptId);
    } catch (error) {
      // Timeout or network error. The top-up may or may not have landed at the
      // carrier, so the caller must NOT refund on this path.
      const message = error instanceof Error ? error.message : "Network error contacting AidaPay";
      return { status: "unknown", message, raw: { thrown: message } };
    } finally {
      clearTimeout(timer);
    }
  },

  /**
   * Account-holder lookup, before any money moves.
   *
   * AidaPay's `GET /validation/{provider_code}/{recipient}`. Three outcomes,
   * and the difference between the last two is the whole reason this method
   * returns a nullable verdict rather than a boolean:
   *
   *   a name           -> the destination exists; show it and let the customer
   *                       confirm they are paying the right account.
   *   a negative       -> the provider says no such account. The purchase will
   *                       be refused, so the page says so first.
   *   `null`           -> we could not ask: a refused credential, a 302 to the
   *                       account page, an unsupported biller, a timeout. NOT
   *                       a reason to block a purchase.
   *
   * `redirect: "manual"`, for the same reason the catalog sync sets it: AidaPay
   * answers an unauthenticated request with a 302 rather than a 401, and
   * following it lands on HTML.
   */
  async verifyRecipient(
    req: ProviderRecipientRequest,
    opts: ProviderCallOptions,
  ): Promise<ProviderRecipientCheck | null> {
    const providerCode = (req.providerProductCode ?? "").trim();
    const recipient = (req.customerIdentifier ?? "").trim();
    if (providerCode === "" || recipient === "") return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

    try {
      const response = await opts.fetchImpl(
        `${opts.baseUrl.replace(/\/+$/, "")}${validationPath(providerCode, recipient)}`,
        {
          method: "GET",
          headers: { accept: "application/json", ...composeAuthHeader(opts) },
          redirect: "manual",
          signal: controller.signal,
        },
      );

      // A non-2xx is a refusal, never a verdict about the destination. Reading
      // it as "invalid" would hard-block a purchase because a token was
      // rotated or a biller lost its lookup support.
      if (!response.ok) return null;

      const text = await response.text();
      if (!text) return null;
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return null;
      }
      return mapValidationResponse(parsed);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  },

  /**
   * Verify, THEN parse.
   *
   * The order is the security property, and the single method is what makes it
   * unavoidable: a caller cannot obtain the parsed event without the signature
   * having been checked first, because an unverified body returns null.
   *
   * The key is the ACCESS TOKEN, which is the same material AidaPay uses to
   * authenticate the API. The provider row therefore seals the token twice —
   * once as the API key, once as the webhook secret — so either copy can be
   * rotated without invalidating the other.
   */
  verifyAndParseCallback(
    rawBody: string,
    headers: Record<string, string>,
    secret: string,
  ): ProviderCallbackEvent | null {
    if (!secret) return null;

    const provided = signatureFrom(headers);
    if (!provided) return null;

    const expectedHex = createHmac("sha256", secret).update(rawBody).digest("hex");
    const verified =
      safeEqualHex(expectedHex, provided) ||
      safeEqualHex(Buffer.from(expectedHex, "hex").toString("base64"), provided);
    if (!verified) return null;

    // Only now is the body parsed.
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return null;
    }
    if (!body || typeof body !== "object") return null;

    const b = body as Record<string, unknown>;
    const d = dataOf(body);

    const providerReference = referenceOf(b, d);
    if (!providerReference) return null;

    const verdict = mapAidaPayStatus(d.status ?? b.status);

    // Only a TERMINAL verdict resolves a transaction. `processing` and
    // `unknown` both return null, leaving the row untouched rather than
    // resolving it on an assumption — a duplicate or premature AidaPay
    // callback is then simply a no-op.
    if (verdict.kind !== "confirmed" && verdict.kind !== "failed") return null;

    const delivery = deliveryOf(b, d);
    return {
      providerReference,
      outcome: verdict.kind === "confirmed" ? "confirmed" : "failed",
      costNgn: num(d.cost) ?? num(d.amount),
      code: str(d.code) ?? str(b.code),
      message: str(d.message) ?? str(b.message),
      // The webhook is where a meter token normally arrives: the buy call has
      // already returned `Processing` by then.
      ...(delivery ? { delivery } : {}),
      // Preserved so a Refund or Cancelled is recorded as a cancellation
      // rather than a generic rejection, which is what selects the
      // `provider_cancelled` reversal reason.
      ...(verdict.kind === "failed" ? { failureKind: verdict.failureKind } : {}),
      eventId: str(d.id) ?? str(b.id) ?? providerReference,
    };
  },

  /**
   * Authoritative re-read. Called only by the reconciliation sweep.
   *
   * AidaPay rate-limits this to 3 calls per 5 minutes, so the sweep enforces
   * that budget BEFORE dispatching (see `reserveReconcileBudget`); nothing
   * else in the codebase calls this.
   */
  async verify(
    providerReference: string,
    opts: ProviderCallOptions,
  ): Promise<ProviderPurchaseResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

    try {
      const response = await opts.fetchImpl(
        `${opts.baseUrl.replace(/\/+$/, "")}${transactionPath(providerReference)}`,
        {
          method: "GET",
          headers: {
            accept: "application/json",
            ...composeAuthHeader(opts),
          },
          signal: controller.signal,
        },
      );

      const text = await response.text();
      if (response.status >= 500 || response.status === 429) {
        return {
          status: "unknown",
          message: `AidaPay returned HTTP ${response.status}`,
          raw: { status: response.status, body: text },
        };
      }

      let parsed: unknown;
      try {
        parsed = text ? JSON.parse(text) : {};
      } catch {
        return {
          status: "unknown",
          message: "AidaPay returned a non-JSON response",
          raw: { status: response.status, body: text },
        };
      }

      if (!response.ok) {
        const b = parsed as Record<string, unknown>;
        const d = dataOf(parsed);
        const verdict = mapAidaPayStatus(d.status ?? b.status);

        // A non-2xx body can still NAME a terminal state — AidaPay reports a
        // Cancelled transaction with one — and only a classified status word
        // is a provider verdict. Everything else here (a 404 for a reference
        // AidaPay does not recognise, a 401 from a rotated token) is "we could
        // not read it", which the three-state union spells `unknown`.
        //
        // This distinction is load-bearing. `failed` is the one word that makes
        // the reconciliation sweep refund a customer, so returning it for
        // "could not resolve that reference" would reverse money on the
        // strength of an HTTP status line rather than on anything the provider
        // said about the transaction.
        if (verdict.kind === "failed") {
          return {
            status: "failed",
            code: str(b.code) ?? str(d.code) ?? `HTTP_${response.status}`,
            message: str(b.message) ?? str(d.message) ?? "AidaPay rejected this transaction",
            failureKind: verdict.failureKind,
            providerReference,
            raw: parsed,
          };
        }
        if (verdict.kind === "confirmed") return mapPurchaseResponse(parsed, providerReference);

        return {
          status: "unknown",
          message: `AidaPay could not resolve that reference (HTTP ${response.status})`,
          providerReference,
          raw: parsed,
        };
      }

      return mapPurchaseResponse(parsed, providerReference);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Network error contacting AidaPay";
      return { status: "unknown", message, raw: { thrown: message } };
    } finally {
      clearTimeout(timer);
    }
  },
};
