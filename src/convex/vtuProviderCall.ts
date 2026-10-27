"use node";

/**
 * Provider credential opening and the outbound call.
 *
 * This is the ONLY place a provider credential is ever decrypted, and the
 * only place an outbound provider HTTP call is made.
 *
 * It is a "use node" module for two independent reasons: it uses `node:crypto`
 * to open a sealed value, and it performs `fetch`. Convex forbids a V8 function
 * from importing it, which is a useful structural guarantee — a query could
 * not decrypt a credential even by accident.
 */

import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { tryDecrypt, isSecretError } from "./lib/encryption";
import { getAdapter } from "./vtuRegistry";
import { composeAuthHeader } from "./vtuShared";
import type { ProviderCallOptions, VtuProviderAdapter } from "./vtuShared";
import { parseServiceCode, validateCustomerIdentifier } from "../lib/vtu";

const DEFAULT_TIMEOUT_MS = 20_000;

export type ProviderCallErrorCode =
  | "PROVIDER_NOT_FOUND"
  | "PROVIDER_DISABLED"
  | "CREDENTIAL_MISSING"
  | "CREDENTIAL_CORRUPT"
  | "ADAPTER_UNKNOWN"
  | "ADAPTER_INCOMPLETE"
  | "ADMIN_REQUIRED";

/**
 * A provider-side failure, as a typed code.
 *
 * Carries no credential material in the message, because these errors reach an
 * admin UI and an audit log.
 */
export class VtuProviderError extends Error {
  readonly code: ProviderCallErrorCode;

  constructor(code: ProviderCallErrorCode) {
    super(`Provider error: ${code}`);
    this.name = "VtuProviderError";
    this.code = code;
  }
}

export type ResolvedCall =
  | {
      ok: true;
      adapter: VtuProviderAdapter;
      opts: ProviderCallOptions;
      /** Admin-configured signature header name, for webhook aliasing. */
      signatureHeader?: string;
    }
  | { ok: false; code: ProviderCallErrorCode };

/**
 * Resolve a provider and open its credential, for one outbound call.
 *
 * The returned `opts` holds a PLAINTEXT key. It is a local, it is never
 * persisted, never returned from a query, and never logged — including at
 * debug level and including truncated. See the lifetime markers below.
 */
async function resolveCall(
  ctx: any,
  name: string,
  mode: "purchase" | "verification" | "reconcile" | "validate",
): Promise<ResolvedCall> {
  // `validate` resolves EXACTLY as a purchase does — a live provider only —
  // because it is a lookup a customer runs on the way to buying. Answering a
  // destination question from a sandbox or disabled credential would name an
  // account the customer cannot then pay, and routing already refuses those
  // products, so this cannot fire for a product that would have been buyable.
  const resolution: any = await ctx.runQuery(
    mode === "verification"
      ? internal.vtuProviderConfig.resolveForVerification
      : mode === "reconcile"
        ? internal.vtuProviderConfig.resolveForReconcile
        : internal.vtuProviderConfig.resolveForPurchase,
    { name },
  );

  if (!resolution?.ok) {
    return { ok: false, code: (resolution?.code ?? "PROVIDER_NOT_FOUND") as ProviderCallErrorCode };
  }

  // A row can exist for a provider whose adapter has not been written yet —
  // slice 3 will make that reachable through the admin UI. Fail closed.
  const adapter = getAdapter(name);
  if (!adapter) return { ok: false, code: "ADAPTER_UNKNOWN" };

  // The registry validates an adapter on entry, but an object can satisfy
  // registration and still be missing a method by the time it is called, and
  // each mode needs a different one. Checked HERE — before the credential is
  // opened and before the caller has dispatched anything — so the failure is a
  // typed code on a path that has spent nothing yet.
  //
  // That placement is what makes the failure cheap:
  //   purchase  -> `purchaseVtu` has already reserved and debited, and its
  //                `fail()` path settles and refunds, so the points come back
  //                in the same action instead of stranding in `pending`;
  //   reconcile -> the sweep escalates without consuming a rate-limited call;
  //   validate  -> the lookup is refused with a typed code and nothing is
  //                charged, because nothing has been charged yet;
  //   verification -> no method is needed to OPEN a webhook secret, so the
  //                guard for that one lives where the method is called.
  //
  // `verifyRecipient` is OPTIONAL on the interface, and an adapter without one
  // is a provider with no lookup endpoint rather than a broken adapter. The
  // guard here therefore produces `ADAPTER_INCOMPLETE`, which the caller
  // reports as "this provider cannot check that" and never as a refusal.
  const requiredMethod =
    mode === "purchase"
      ? "purchase"
      : mode === "reconcile"
        ? "verify"
        : mode === "validate"
          ? "verifyRecipient"
          : null;
  if (requiredMethod && typeof (adapter as any)[requiredMethod] !== "function") {
    return { ok: false, code: "ADAPTER_INCOMPLETE" };
  }

  // Which sealed value this mode opens. A purchase authenticates with the API
  // key, a webhook proves itself with the webhook secret, and a reconciliation
  // poll authenticates as the API again — it is a read of the same account the
  // purchase path bills against, so it opens the same material.
  const sealed =
    mode === "verification"
      ? resolution.provider.encryptedWebhookSecret
      : resolution.provider.encryptedApiKey;
  if (!sealed) return { ok: false, code: "CREDENTIAL_MISSING" };

  // ═══ PLAINTEXT CREDENTIAL LIFETIME — BEGINS ═══════════════════
  // `opened` is a local. It must never be assigned to a query result, an
  // audit row, a notification, or a log. It goes out of scope when this
  // function returns and the caller uses only `opts` thereafter.
  const opened = await tryDecrypt(sealed);
  // ═══ PLAINTEXT CREDENTIAL LIFETIME — ENDS ═════════════════════

  if (!opened.ok) {
    // A truncated payload, a wrong master key, and a tampered row all land
    // here. Reported as a typed code rather than rethrown, so a corrupt
    // credential produces a clean provider error instead of an unhandled
    // crypto exception reaching the client.
    return { ok: false, code: "CREDENTIAL_CORRUPT" };
  }

  // ── Second sealed value ──────────────────────────────────────────
  //
  // The account PIN is a separate secret, not a second copy of the API key:
  // it has its own lifetime and is rotated on its own. It is sealed
  // independently for the same reason the webhook secret is.
  //
  // Absent is NOT an error. It is absent for every provider that has no
  // equivalent (Pairgate), and the adapter that needs it is the one that must
  // refuse cleanly. Failing here instead would take down a provider that is
  // working perfectly.
  //
  // Present but unopenable IS an error: a row that claims a PIN we cannot read
  // would otherwise dispatch a purchase with a silently empty one.
  // Only the PURCHASE path opens it. A webhook proves itself with a signature
  // and a reconciliation poll is a read-only GET — neither ever sends a PIN,
  // so decrypting one would put a spend credential in memory for no benefit.
  // This makes "the account PIN is opened only by the purchase path" a
  // property of this function rather than something every caller must
  // remember.
  let accountPin: string | undefined;
  const sealedPin =
    mode === "purchase" ? resolution.provider.encryptedAccountPin : undefined;
  if (sealedPin) {
    // ═══ PLAINTEXT CREDENTIAL LIFETIME — BEGINS ═══════════════════
    const openedPin = await tryDecrypt(sealedPin);
    // ═══ PLAINTEXT CREDENTIAL LIFETIME — ENDS ═════════════════════
    if (!openedPin.ok) return { ok: false, code: "CREDENTIAL_CORRUPT" };
    accountPin = openedPin.value;
  }

  return {
    ok: true,
    adapter,
    opts: {
      baseUrl: resolution.provider.baseUrl,
      apiKey: opened.value,
      // Omitted rather than set to undefined, so the key does not exist at all
      // on the options object a provider with no PIN can read.
      ...(accountPin !== undefined ? { accountPin } : {}),
      authHeader: resolution.provider.authHeader,
      authScheme: resolution.provider.authScheme,
      timeoutMs: resolution.provider.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      fetchImpl: fetch,
    },
    signatureHeader: resolution.provider.callbackSignatureHeader,
  };
}

/**
 * Open a provider credential for a purchase.
 *
 * Throws {@link VtuProviderError} on any resolution failure. Callers surface
 * the code; they must not attempt an env fallback, because none exists.
 */
export async function openForPurchase(ctx: any, name: string): Promise<ResolvedCall> {
  return resolveCall(ctx, name, "purchase");
}

/** Open a provider's webhook secret for callback verification. */
export async function openForVerification(ctx: any, name: string): Promise<ResolvedCall> {
  return resolveCall(ctx, name, "verification");
}

/**
 * Open a provider's API key for a reconciliation poll (`adapter.verify`).
 *
 * Read-only by construction: this mode never carries the account PIN, and it
 * never resolves a disabled or sandbox row for a NEW purchase — it settles
 * transactions that were already dispatched.
 */
export async function openForReconcile(ctx: any, name: string): Promise<ResolvedCall> {
  return resolveCall(ctx, name, "reconcile");
}

/**
 * Open a key for a recipient lookup (`adapter.verifyRecipient`).
 *
 * Read-only like the reconcile mode: it authenticates as the API with the API
 * key and deliberately never opens the account PIN, so a "whose meter is
 * this?" question cannot put a spend credential in memory.
 */
export async function openForValidate(ctx: any, name: string): Promise<ResolvedCall> {
  return resolveCall(ctx, name, "validate");
}

// ─── Recipient validation ───────────────────────────────────────────

/**
 * The answer to "whose account is this?", as the page needs it.
 *
 * Three states rather than a boolean, because they call for three different
 * things on screen:
 *
 *   checked && valid     show the name and let the customer confirm.
 *   checked && !valid    the provider says no such account; do not proceed.
 *   !checked             we could not ask. Say nothing alarming, and let the
 *                        purchase go ahead — the provider remains the
 *                        authority, and refusing a sale because a lookup was
 *                        unavailable would be a worse failure than the typo it
 *                        was meant to catch.
 */
export interface RecipientValidationResult {
  checked: boolean;
  valid: boolean;
  customerName?: string;
  message?: string;
  /** Why no verdict was reached. Absent when `checked` is true. */
  reason?: string;
}

/**
 * Look up the account holder for a destination, before anything is charged.
 *
 * CUSTOMER-facing, not admin-gated: a customer must be able to check their own
 * meter number, and the lookup spends nothing. It is authenticated and rate
 * limited rather than public, because it is a metered provider call that would
 * otherwise be a free oracle for enumerating meter numbers.
 *
 * It discloses the NAME the provider returns for the customer's own input and
 * nothing else — no provider name, no provider code, no credential. The
 * provider code is resolved and used entirely inside this action.
 */
export const validateVtuRecipient = action({
  args: { serviceCode: v.string(), customerIdentifier: v.string() },
  handler: async (ctx, args): Promise<RecipientValidationResult> => {
    const userId = await getAuthUserId(ctx as any);
    if (!userId) return { checked: false, valid: false, reason: "AUTH_REQUIRED" };

    // Shape first, provider second. A malformed number is answered locally in
    // both senses: no provider call is spent, and the message is the same one
    // the purchase page already shows.
    const parsed = parseServiceCode(args.serviceCode);
    if (!parsed) return { checked: false, valid: false, reason: "BAD_SERVICE_CODE" };

    const idCheck = validateCustomerIdentifier(parsed.serviceType, args.customerIdentifier);
    if (!idCheck.ok) {
      return { checked: false, valid: false, reason: "BAD_IDENTIFIER", message: idCheck.error };
    }

    const allowed = await ctx.runMutation(
      internal.vtuInternal.consumeValidationRateLimit,
      { userId: userId as any },
    );
    if (!allowed) {
      return {
        checked: false,
        valid: false,
        reason: "RATE_LIMITED",
        message: "Too many checks in a moment. Please try again shortly.",
      };
    }

    const target: any = await ctx.runQuery(
      internal.vtuInternal.resolveValidationTarget,
      { serviceCode: args.serviceCode },
    );
    if (!target) return { checked: false, valid: false, reason: "NO_ROUTE" };

    const opened = await openForValidate(ctx, target.provider);
    if (!opened.ok) return { checked: false, valid: false, reason: opened.code };

    // Optional on the interface. Its absence is a fact about the provider, not
    // a fault, and it must never be reported as an invalid destination.
    const verify = opened.adapter.verifyRecipient;
    if (typeof verify !== "function") {
      return { checked: false, valid: false, reason: "NOT_SUPPORTED" };
    }

    try {
      const check = await verify.call(opened.adapter, {
        serviceType: target.serviceType,
        productCode: target.productCode,
        providerProductCode: target.providerProductCode,
        customerIdentifier: idCheck.value,
      }, opened.opts);

      if (!check) return { checked: false, valid: false, reason: "NO_VERDICT" };

      return {
        checked: true,
        valid: check.valid,
        ...(check.customerName ? { customerName: check.customerName } : {}),
        ...(check.message ? { message: check.message } : {}),
      };
    } catch {
      // A thrown error here is a transport fault. Reported as "could not ask",
      // deliberately NOT as a rejection: the provider is the authority on
      // whether the destination exists, and this action is a courtesy check.
      return { checked: false, valid: false, reason: "LOOKUP_FAILED" };
    }
  },
});

// ─── Test connection ────────────────────────────────────────────────

export interface TestConnectionResult {
  ok: boolean;
  provider: string;
  latencyMs?: number;
  error?: string;
}

/**
 * Probe a provider's read-only health or balance endpoint.
 *
 * HARD CONSTRAINT: this only ever issues a `GET` to the row's configured
 * `healthPath`. It never calls `purchase`, because a test button wired to a
 * spending path is a foot-gun holding a production key. The "no transaction
 * created" assertion in the test suite is what keeps that honest.
 */
export const testProviderConnection = action({
  args: { name: v.string() },
  handler: async (ctx, args): Promise<TestConnectionResult> => {
    // Admin-gated server-side; the UI check is convenience only.
    const userId = await getAuthUserId(ctx as any);
    if (!userId) return { ok: false, provider: args.name, error: "ADMIN_REQUIRED" };
    const isAdmin = await ctx.runQuery(internal.vtuProviderAdmin.isAdmin, { userId });
    if (!isAdmin) return { ok: false, provider: args.name, error: "ADMIN_REQUIRED" };

    // A disabled provider may still be tested — an operator diagnosing an
    // outage needs to probe it, and probing does not route any money.
    const row: any = await ctx.runQuery(internal.vtuProviderAdmin.getForTest, {
      name: args.name,
    });
    if (!row) {
      return { ok: false, provider: args.name, error: "PROVIDER_NOT_FOUND" };
    }
    if (!row.healthPath) {
      return { ok: false, provider: args.name, error: "HEALTH_PATH_NOT_CONFIGURED" };
    }

    const sealed = row.encryptedApiKey;
    if (!sealed) {
      return { ok: false, provider: args.name, error: "CREDENTIAL_MISSING" };
    }

    // ═══ PLAINTEXT CREDENTIAL LIFETIME — BEGINS ═══════════════════
    const opened = await tryDecrypt(sealed);
    // ═══ PLAINTEXT CREDENTIAL LIFETIME — ENDS ═════════════════════
    if (!opened.ok) {
      await recordTest(ctx, args.name, false, "CREDENTIAL_CORRUPT");
      return { ok: false, provider: args.name, error: "CREDENTIAL_CORRUPT" };
    }

    const url = `${String(row.baseUrl).replace(/\/+$/, "")}${row.healthPath}`;
    // Composed by the SAME rule an adapter uses, so a provider configured for
    // `Authorization: Bearer` is probed exactly the way it is called. Probing
    // with a hand-built header would report a healthy provider as broken.
    const authHeaders = composeAuthHeader({
      authHeader: row.authHeader ?? undefined,
      authScheme: row.authScheme ?? undefined,
      apiKey: opened.value,
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    const started = Date.now();

    try {
      const response = await fetch(url, {
        // GET only. Never POST here.
        method: "GET",
        headers: {
          accept: "application/json",
          ...authHeaders,
        },
        signal: controller.signal,
      });
      const latencyMs = Date.now() - started;

      // A 401/403 means the credential is wrong, which is the case an admin
      // most needs told apart from a network problem.
      if (response.status === 401 || response.status === 403) {
        await recordTest(ctx, args.name, false, "CREDENTIALS_REJECTED");
        return { ok: false, provider: args.name, latencyMs, error: "CREDENTIALS_REJECTED" };
      }
      if (!response.ok) {
        const message = `HTTP_${response.status}`;
        await recordTest(ctx, args.name, false, message);
        return { ok: false, provider: args.name, latencyMs, error: message };
      }

      await recordTest(ctx, args.name, true);
      return { ok: true, provider: args.name, latencyMs };
    } catch (error) {
      const latencyMs = Date.now() - started;
      const message = error instanceof Error ? error.message : "NETWORK_ERROR";
      // Recorded as a short message. Never derived from the credential.
      await recordTest(ctx, args.name, false, "NETWORK_ERROR");
      return { ok: false, provider: args.name, latencyMs, error: message.slice(0, 120) };
    } finally {
      clearTimeout(timer);
    }
  },
});

async function recordTest(
  ctx: any,
  name: string,
  ok: boolean,
  error?: string,
): Promise<void> {
  await ctx.runMutation(internal.vtuProviderAdmin.recordTestResult, {
    name,
    ok,
    error,
  });
}

/** Guard used by callers that prefer a thrown typed error. */
export function requireCall(resolved: ResolvedCall): ResolvedCall & { ok: true } {
  if (!resolved.ok) throw new VtuProviderError(resolved.code);
  return resolved;
}

export { isSecretError };
