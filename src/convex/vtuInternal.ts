/**
 * VTU money path and transitions — internal only.
 *
 * Nothing here is public. The client cannot begin a purchase, advance a
 * status, refund itself, or set a price; it can only ask the action in
 * `vtuHttp.ts` to run a purchase, and that action resolves the caller and
 * passes `userId` explicitly.
 *
 * (A public mutation reads the caller from the auth context. An ACTION calling
 * a public mutation does NOT carry that context, so a purchase mutation
 * reachable from an action must be internal and take `userId` itself.)
 *
 * These live apart from `vtu.ts` for a second, concrete reason: a Convex
 * module that reaches for its OWN exports through the generated `internal`
 * API creates a self-referential type-inference cycle that collapses the
 * module — and everything importing it — to `any`.
 */

import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { creditWallet, debitWallet } from "./wallet";
import { query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
// Type-only: `MutationCtx` is what the reversal helper takes, so an action
// cannot pass an action context to it.
import type { MutationCtx } from "./_generated/server";
// The reversal-reason and unresolved-reason vocabularies, from the one file
// that owns the enums, so the mutation argument and the schema field cannot
// drift apart.
import {
  vtuDeliveryValidator,
  vtuReversalReasonValidator,
  vtuUnresolvedReasonValidator,
} from "./vtuSchema/types";
import type { VtuReversalReason } from "./vtuSchema/types";
import { getAuthUserId } from "@convex-dev/auth/server";
import { sanitizeForLog } from "./vtuShared";
import type { VtuServiceType, VtuTransactionStatus } from "./vtuShared";
import {
  isValidRequestId,
  maskIdentifier,
  parseServiceCode,
  validateCustomerIdentifier,
  vtuLedgerPurchaseKey,
  vtuPurchaseKey,
  vtuRefundKey,
} from "../lib/vtu";
import {
  canonicalProductCode,
  composeProviderProductCode,
  effectiveProvider,
  resolvePointsCost,
  ROUTE_MESSAGES,
  routeProduct,
} from "./vtuServiceRouting";

/** Purchases allowed per minute, per user. Fixed window in Convex, no Redis. */
export const PURCHASE_RATE_LIMIT = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

/** Shared with the public price queries in `vtu.ts`. */
export async function consumeRateLimit(
  ctx: { db: any },
  key: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const row = await ctx.db
    .query("rateLimitBuckets")
    .withIndex("by_key_and_window", (q: any) =>
      q.eq("key", key).eq("windowStart", windowStart),
    )
    .first();
  if (!row) {
    await ctx.db.insert("rateLimitBuckets", { key, windowStart, count: 1 });
    return true;
  }
  if (row.count >= limit) return false;
  await ctx.db.patch(row._id, { count: row.count + 1 });
  return true;
}

/**
 * Where a service code would actually be dispatched — for a lookup, not a buy.
 *
 * The recipient-validation action needs the provider's own code for a biller
 * BEFORE a transaction exists, and it must be the code the purchase would use.
 * Deriving it anywhere else would validate against one biller and charge
 * another, which is worse than not validating at all.
 *
 * It therefore runs the SAME `routeProduct` the purchase runs, and returns
 * scalars only. Internal, because the provider's code is not the client's
 * business: the action needs it to build the lookup URL and the browser never
 * receives it.
 *
 * Returns `null` when the product cannot be routed, which the action reports as
 * "could not check" rather than "invalid" — an unroutable product is already
 * refused at confirm time with a better message.
 */
export const resolveValidationTarget = internalQuery({
  args: { serviceCode: v.string() },
  handler: async (ctx, args) => {
    const parsed = parseServiceCode(args.serviceCode);
    if (!parsed) return null;

    const productCode = canonicalProductCode(args.serviceCode);
    if (!productCode) return null;

    const route = await routeProduct(ctx, productCode);
    if (!route.ok) return null;

    let providerProductCode: string;
    try {
      providerProductCode = composeProviderProductCode(
        route.winner.providerProductCode,
        // `parseServiceCode` reports "no amount" as null, and the composer
        // distinguishes undefined (nothing to substitute) from a number. A
        // token-bearing code is therefore refused below rather than filled
        // with "null".
        parsed.amountNgn ?? undefined,
      );
    } catch {
      // An amount-token route addressed without an amount. The purchase
      // refuses this too; nothing is validated against a code we cannot build.
      return null;
    }

    return {
      provider: route.winner.provider,
      providerProductCode,
      productCode,
      serviceType: route.product.serviceType,
    };
  },
});

/**
 * Account-holder lookups allowed per minute, per user.
 *
 * A lookup is a METERED provider call — the aggregator counts look-ups against
 * the same account budget the purchases come out of — and unlike a purchase it
 * is cheap and repeatable, so the page triggers it on a debounce rather than
 * once per customer action. That is exactly the shape of endpoint that gets
 * hammered by an impatient retry or a script, so it is rate limited at the same
 * layer and with the same mechanism as purchases.
 *
 * Higher than the purchase limit because a human legitimately checks a meter
 * number more than once, and lower than anything a script would want.
 */
export const VALIDATION_RATE_LIMIT = 30;

/**
 * Spend one lookup from the caller's per-minute budget.
 *
 * A mutation rather than an inline check in the action, because a rate limit
 * enforced by a read-then-write from an action is not a limit at all: two
 * concurrent lookups both read the old count and both proceed. Convex mutations
 * are serializable, so the read-modify-write inside `consumeRateLimit` is the
 * only form of this that actually holds.
 */
export const consumeValidationRateLimit = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args): Promise<boolean> => {
    return await consumeRateLimit(
      ctx,
      `vtuValidate:${args.userId}`,
      VALIDATION_RATE_LIMIT,
      RATE_LIMIT_WINDOW_MS,
    );
  },
});

/**
 * Resolve the points cost for a service code: override first, conversion
 * second.
 *
 * DELETED as of slice 3's follow-up, deliberately. This was the ROUTING-UNAWARE
 * copy of the precedence chain, kept for the user-facing price queries. Once
 * the offer grid and the preview routed properly they had no callers, and a
 * second implementation of a money rule is a liability even when it is
 * currently correct: it is the first thing that drifts when an operator sets a
 * `pointsCostOverride`. `resolvePointsCost` in `vtuServiceRouting.ts` is now
 * the ONLY place the precedence exists, and every consumer — the purchase
 * mutation, the offer grid, the preview, the admin dry-run — calls it.
 */

/**
 * A purchase that could not be routed.
 *
 * Thrown BEFORE the idempotency claim, the transaction row, and the debit —
 * so a routing failure costs the customer nothing. A separate error type
 * rather than a bare `Error` so the action can report a code the page can
 * distinguish instead of showing a generic failure.
 */
export class VtuRoutingError extends Error {
  readonly code: "PRODUCT_NOT_FOUND" | "PRODUCT_INACTIVE" | "NO_ROUTE_AVAILABLE";
  constructor(
    code: "PRODUCT_NOT_FOUND" | "PRODUCT_INACTIVE" | "NO_ROUTE_AVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "VtuRoutingError";
    this.code = code;
  }
}

/**
 * A purchase whose amount falls outside the bounds the CATALOG row declares.
 *
 * Separate from `VtuRoutingError` because it is a different fault with a
 * different fix: a routing error is an operator problem, an amount outside
 * the range is the customer's input, and the page says so differently.
 *
 * The bounds are read from `vtuServiceCatalog`, NOT from a constant. That is
 * the point of the field: a product whose face values are not 100–100,000
 * declares its own range and the same code enforces it, so slice 4 can add a
 * fixed-price product with no code change and no chance of the two disagreeing
 * about what is sellable.
 */
export class VtuAmountRangeError extends Error {
  readonly code = "AMOUNT_OUT_OF_RANGE" as const;
  constructor(message: string) {
    super(message);
    this.name = "VtuAmountRangeError";
  }
}

/**
 * Check a purchase amount against the bounds on the catalog row.
 *
 * Absent bounds mean "no bound declared", not "zero and zero" — a fixed-price
 * product with no `minAmount` is not refusing everything. An inverted range
 * is a configuration mistake, so it is treated as unbounded rather than
 * silently refusing every purchase.
 */
export function assertAmountInRange(
  product: { minAmount?: number; maxAmount?: number },
  amountNgn: number,
): void {
  const { minAmount, maxAmount } = product;
  if (minAmount !== undefined && maxAmount !== undefined && minAmount > maxAmount) return;

  const tooSmall = minAmount !== undefined && amountNgn < minAmount;
  const tooLarge = maxAmount !== undefined && amountNgn > maxAmount;
  if (!tooSmall && !tooLarge) return;

  const low = minAmount !== undefined ? `₦${minAmount.toLocaleString()}` : "any amount";
  const high = maxAmount !== undefined ? `₦${maxAmount.toLocaleString()}` : "any amount";
  throw new VtuAmountRangeError(
    `Enter an amount between ${low} and ${high}. Your balance was not touched.`,
  );
}

export type BeginPurchaseResult =
  | {
      reused: true;
      transactionId: Id<"vtuTransactions">;
      status: VtuTransactionStatus;
      pointsDebited: number;
      walletDebitedNgn?: number;
    }
  | {
      reused: false;
      transactionId: Id<"vtuTransactions">;
      status: "pending";
      pointsDebited: number;
      walletDebitedNgn: number;
      ngnPerPoint: number;
      /** The route, snapshotted onto the row. The action dispatches through
       *  exactly this and never re-routes. */
      routedProvider: string;
      routedProviderProductCode: string;
      routedProviderPackageCode: string | null;
      /** The CATALOG's own service type — schema-validated, and the value the
       *  adapter is told. Read from the product rather than re-derived from
       *  the service code, so the two can never disagree at the wire. */
      serviceType: VtuServiceType;
    };

/**
 * Begin a purchase: claim the key, debit the ledger, record the transaction.
 *
 * The ordering is the design:
 *
 *   1. Rate limit.
 *   2. Idempotency — an existing claim means a retry, so return the recorded
 *      transaction WITHOUT debiting again. Checked before the limiter so a
 *      genuine retry of a request that timed out is served rather than being
 *      rate-limited into a failure the customer pays for.
 *   3. ROUTE. Which provider serves this product is decided here, before
 *      anything is claimed or charged, so a product that cannot be routed
 *      throws with no ledger row and no transaction.
 *
 *      Worth being precise about WHY it sits here rather than after the
 *      claim: it is NOT the position that protects the claim. Convex rolls
 *      the whole mutation back when a handler throws, so the `vtuIdempotency`
 *      row would disappear either way — moving routing after the claim was
 *      tried, and no test could tell the difference. What the position buys
 *      is that the route, the price, and the provider are all settled BEFORE
 *      any money moves, so a failure is a refusal rather than a refund, and a
 *      reversal is never needed for a configuration mistake.
 *   4. Claim the key. If a later step throws, this insert rolls back with it.
 *   5. Insert the transaction, carrying the ROUTE SNAPSHOT, so the debit can
 *      be keyed on its own id.
 *   6. Debit, keyed per ATTEMPT. Throws on insufficient balance, unwinding
 *      the claim and the row above.
 *
 * Steps 4–6 are one Convex transaction, so there is no window in which the key
 * exists without a debit, or a debit without a row to reconcile against.
 *
 * The route is SNAPSHOTTED rather than looked up again later because the
 * routing table is admin-editable and a purchase is not: an operator who
 * re-points a product while a purchase is in flight must not change which
 * provider settles it. Every downstream consumer — the dispatch action and the
 * webhook handler — reads the snapshot off the transaction.
 *
 * `points.debit` returns the EXISTING ledger id on a replay rather than
 * failing, so its return value alone is not proof of a new debit — the
 * uniqueness of `vtuIdempotency` is what actually prevents a double charge.
 */
export const beginPurchase = internalMutation({
  args: {
    userId: v.id("users"),
    clientRequestId: v.string(),
    serviceCode: v.string(),
    customerIdentifier: v.string(),
  },
  handler: async (ctx, args): Promise<BeginPurchaseResult> => {
    if (!isValidRequestId(args.clientRequestId)) {
      throw new Error("A valid clientRequestId is required");
    }

    const parsed = parseServiceCode(args.serviceCode);
    if (!parsed) throw new Error("Unsupported product");

    // Per SERVICE TYPE, not per phone: an electricity purchase carries a meter
    // number and a cable purchase a smartcard number, and the rules for each
    // are different enough that one validator could not serve them all.
    const identity = validateCustomerIdentifier(parsed.serviceType, args.customerIdentifier);
    if (!identity.ok) throw new Error(identity.error);

    if (
      !(await consumeRateLimit(
        ctx,
        `vtu:purchase:${args.userId}`,
        PURCHASE_RATE_LIMIT,
        RATE_LIMIT_WINDOW_MS,
      ))
    ) {
      throw new Error("Too many purchase attempts. Try again in a minute.");
    }

    const key = vtuPurchaseKey(args.clientRequestId);

    // 2. Idempotency.
    const existingClaim = await ctx.db
      .query("vtuIdempotency")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (existingClaim?.transactionId) {
      const tx = await ctx.db.get(existingClaim.transactionId);
      if (tx) {
        return {
          reused: true,
          transactionId: tx._id,
          status: tx.status,
          pointsDebited: tx.pointsDebited,
          walletDebitedNgn: tx.walletDebitedNgn ?? tx.nairaPrice,
        };
      }
    }

    // 3. ROUTE. Deliberately before the claim, the row, and the debit: a
    //    product that cannot be served must cost the customer nothing, and a
    //    burned request id would make their retry impossible.
    const productCode = canonicalProductCode(args.serviceCode);
    // Unreachable: `parseServiceCode` accepted this code a few lines above,
    // and the two read the same parts. Asserted rather than defaulted, because
    // a silent fallback here would route on a code nobody configured.
    if (!productCode) throw new Error("Unsupported product");

    const route = await routeProduct(ctx, productCode);
    if (!route.ok) {
      throw new VtuRoutingError(route.code, ROUTE_MESSAGES[route.code]);
    }

    // The catalog row's bounds are the authority, not a constant in this
    // file. The migration seeds exactly the 100–100,000 that
    // `parseServiceCode` already enforced above, so nothing changes for
    // existing users — but a product that declares different bounds is now
    // actually held to them.
    //
    // A package product has NO amount to bound: the customer chose a plan and
    // the plan carries the price. That direction is checked first, because a
    // product configured to require an amount and addressed without one is a
    // purchase we would otherwise price from nothing.
    if (parsed.amountNgn !== null) {
      assertAmountInRange(route.product, parsed.amountNgn);
    } else if (route.product.requiresAmount) {
      throw new Error("This product needs an amount. Choose one and try again.");
    }

    const routedProviderProductCode = composeProviderProductCode(
      route.winner.providerProductCode,
      parsed.amountNgn ?? undefined,
    );

    // 4. Claim the key. Rolls back with everything below on throw.
    const now = Date.now();
    const claimId = await ctx.db.insert("vtuIdempotency", {
      key,
      scope: "purchase",
      userId: args.userId,
      createdAt: now,
    });

    // What this purchase costs in naira. For an amount-priced product it is
    // the amount the customer chose; for a fixed package it is the catalog's
    // own price — the provider's, synced from its package list. A product with
    // NEITHER cannot be priced at all, and that is a configuration fault the
    // purchase must fail on BEFORE the debit rather than guess around.
    const nairaPrice = parsed.amountNgn ?? route.product.priceNgn;
    if (nairaPrice === undefined || !(nairaPrice > 0)) {
      throw new Error(
        "This product has no price configured. An administrator needs to set one.",
      );
    }

    // The ONE cost function, and it answers both halves of the price: the
    // points figure the customer is quoted, and `chargeNgn` — the money the
    // wallet is debited. Level 1 (this route's override) is only consulted
    // because a route exists; see `resolvePointsCost`.
    //
    // Deriving the debit from `nairaPrice` instead was the drift this closes: a
    // route override priced the product at 42 points, the app quoted that, and
    // the wallet took ₦1,000 anyway.
    const { points, ngnPerPoint, chargeNgn } = await resolvePointsCost(ctx, {
      productCode: route.winner.productCode,
      serviceCode: args.serviceCode,
      provider: route.winner.provider,
      nairaPrice,
    });

    // 5. Insert the transaction FIRST, so the debit can be keyed on its id.
    //
    // The ledger key is per ATTEMPT (see `vtuLedgerPurchaseKey`). If it were
    // the client request id, the immutable ledger row from a FAILED attempt
    // would block this debit forever and the customer's retry would be free.
    // All of steps 4–6 are one transaction, so this row cannot survive a
    // failed debit.
    //
    // `routedProvider*` are WRITE-ONCE. They are set here and never patched
    // again; the settlement path reads them rather than re-routing.
    const transactionId = await ctx.db.insert("vtuTransactions", {
      userId: args.userId,
      clientRequestId: args.clientRequestId,
      serviceCode: args.serviceCode,
      routedProvider: route.winner.provider,
      routedProviderProductCode,
      routedProviderPackageCode: route.winner.providerPackageCode ?? undefined,
      provider: route.winner.provider,
      status: "pending",
      customerIdentifier: maskIdentifier(identity.value),
      network: parsed.network,
      amountNgn: parsed.amountNgn ?? undefined,
      // The FACE VALUE of what is being bought, which is not the same number
      // as the charge: an override makes those two differ, and the receipt
      // shows both ("Value" beside "Wallet charged").
      nairaPrice,
      ngnPerPoint,
      pointsDebited: points,
      walletDebitedNgn: chargeNgn,
      idempotencyKey: key,
      createdAt: now,
      updatedAt: now,
    });

    // 6. Debit, keyed on this attempt.
    const debitId = await debitWallet(ctx, {
      userId: args.userId,
      amountNgn: chargeNgn,
      type: "vtu_purchase",
      description: `${args.serviceCode} for ${maskIdentifier(identity.value)}`,
      reference: route.winner.provider,
      idempotencyKey: vtuLedgerPurchaseKey(transactionId),
      metadata: {
        clientRequestId: args.clientRequestId,
        serviceCode: args.serviceCode,
        customerIdentifier: maskIdentifier(identity.value),
        nairaPrice,
        chargeNgn,
        transactionId,
      },
    });

    await ctx.db.patch(transactionId, { debitWalletLedgerId: debitId });
    await ctx.db.patch(claimId, { transactionId });

    return {
      reused: false,
      transactionId,
      status: "pending",
      pointsDebited: points,
      walletDebitedNgn: chargeNgn,
      ngnPerPoint,
      routedProvider: route.winner.provider,
      routedProviderProductCode,
      routedProviderPackageCode: route.winner.providerPackageCode,
      serviceType: route.product.serviceType,
    };
  },
});

/**
 * WHICH WRITER may move a transaction out of WHICH status, per verdict.
 *
 * The safety property this table encodes is narrow and load-bearing, and it is
 * the reason `failed` exists as its own status even though it never rests: a
 * transaction is reversed only when something DEFINITIVELY told us the top-up
 * did not happen. Every automatic reversal therefore passes through the
 * `failed` verdict, and `unknown` — the state where the top-up may well have
 * landed at the carrier — is not reversible at all.
 *
 * Every row here matches the transition comment in `vtuSchema/types.ts`. A
 * verdict absent from a status's row is refused, not coerced.
 */
/**
 * WHO is allowed to reverse, and from which status.
 *
 * Two very different authorities, deliberately not one:
 *
 *   `provider_verdict` — something told us definitively that the top-up did
 *     not happen. Only reachable from `failed`, which `settleTransaction`
 *     writes immediately before calling this.
 *
 *   `operator_override` — a human decided to refund. Reachable only from
 *     `unresolved`, the state that exists BECAUSE the system could not reach a
 *     verdict. This is the one case where we refund something unconfirmed, and
 *     it is a decision, not a policy.
 *
 * Making the authority an explicit parameter is what lets the guard stay
 * meaningful after the admin path arrived: the alternative — fetching the row,
 * faking an intermediate `failed` write, and reusing the provider path — would
 * have been a one-line lie that dissolved the property the guard exists to
 * protect.
 */
type ReversalAuthority = "provider_verdict" | "operator_override";

const REVERSIBLE_FROM: Record<ReversalAuthority, readonly VtuTransactionStatus[]> = {
  provider_verdict: ["failed"],
  operator_override: ["unresolved"],
};

const SETTLE_ALLOWED_FROM = {
  confirmed: ["processing", "unknown", "unresolved"],
  failed: ["pending", "processing", "unknown"],
  // Derived, NOT restated. The operator-refund verdict and the reversal helper
  // are two gates on one fact ("a human may refund a transaction that reached
  // `unresolved`"), and writing the list twice is how one copy quietly stops
  // being true — a mutation that widened only this line was absorbed by the
  // helper and survived every test. Reading it from `REVERSIBLE_FROM` makes
  // that class of drift impossible rather than merely unlikely.
  reversed: REVERSIBLE_FROM.operator_override,
  unresolved: ["pending", "processing", "unknown"],
} as const satisfies Record<SettleVerdictStatus, readonly VtuTransactionStatus[]>;

/** Statuses a transaction never leaves again, except by a human (`unresolved`). */
const TERMINAL_STATUSES: readonly VtuTransactionStatus[] = [
  "confirmed",
  "reversed",
  "unresolved",
];

/** Which of our code paths wrote a transition. Recorded on the row as `source`. */
export type SettleSource = "dispatch" | "webhook" | "reconciliation" | "admin";

export type SettleVerdictStatus = "confirmed" | "failed" | "reversed" | "unresolved";

export type SettleResult =
  | {
      settled: true;
      status: "confirmed" | "reversed" | "unresolved";
      /** Present only on the `reversed` verdicts — the refund ledger row. */
      creditId?: Id<"walletLedger">;
    }
  | {
      settled: false;
      reason: "not_found" | "already_terminal" | "illegal_transition";
      status?: VtuTransactionStatus;
    };

/**
 * THE single writer of every terminal transaction status.
 *
 * Before this mutation there were two writers of a terminal status — the
 * synchronous provider response in `purchaseVtu` and the webhook handler in
 * `applyCallback` — and slice 5 adds a third (the reconciliation sweep). Three
 * writers of one state is a race, and the race is not theoretical: a webhook
 * that lands in the same tick as a sweep's verdict would double-credit the
 * customer under the old shape, because the two wrote independently.
 *
 * It is impossible now, and by construction rather than by discipline:
 *
 *   1. Every caller goes through this one mutation.
 *   2. The FIRST thing it does is check the verdict's transition against the
 *      transaction's CURRENT status. A transaction that is already terminal
 *      no-ops, so the second caller in a race sees the first caller's write and
 *      returns `already_terminal` instead of re-crediting.
 *      (Convex serialises mutations, so "the second caller" is guaranteed to
 *      observe the first caller's committed write — this is a real
 *      happens-before edge, not a hopeful one.)
 *   3. The reversal and its ledger credit happen INSIDE this mutation, in the
 *      same Convex transaction as the status write. The credit cannot land
 *      without the status, and the status cannot commit without the credit.
 *
 * The ledger is credited through `reverseAndRelease`, which is a plain helper
 * rather than a mutation precisely so that this is the ONLY way to reach it:
 * there is no `refundAndRelease` API for an action to call out of order.
 */
export const settleTransaction = internalMutation({
  args: {
    transactionId: v.id("vtuTransactions"),
    source: v.union(
      v.literal("dispatch"),
      v.literal("webhook"),
      v.literal("reconciliation"),
      v.literal("admin"),
    ),
    verdict: v.union(
      // Delivered. The debit stands.
      v.object({
        status: v.literal("confirmed"),
        providerReference: v.optional(v.string()),
        costNgn: v.optional(v.number()),
        /** What the customer needs from a delivered purchase (a meter token,
         *  a serial, a PIN). Absent for everything that delivers nothing of
         *  the kind. */
        delivery: v.optional(vtuDeliveryValidator),
        raw: v.optional(v.any()),
      }),
      // Definitively rejected or cancelled. Reverses in this same mutation,
      // which is why `failed` is never observable on a committed row.
      v.object({
        status: v.literal("failed"),
        reversalReason: v.union(
          v.literal("provider_failed"),
          v.literal("provider_cancelled"),
          v.literal("reconciliation"),
        ),
        providerReference: v.optional(v.string()),
        code: v.optional(v.string()),
        message: v.optional(v.string()),
        raw: v.optional(v.any()),
      }),
      // An operator refunding a transaction the system could not settle.
      v.object({
        status: v.literal("reversed"),
        reversalReason: vtuReversalReasonValidator,
        reason: v.optional(v.string()),
        raw: v.optional(v.any()),
      }),
      // Neither delivered nor provably failed. Escalated to a human, never
      // auto-reversed.
      v.object({
        status: v.literal("unresolved"),
        unresolvedReason: vtuUnresolvedReasonValidator,
        message: v.optional(v.string()),
        raw: v.optional(v.any()),
      }),
    ),
  },
  handler: async (ctx, args): Promise<SettleResult> => {
    const tx = await ctx.db.get(args.transactionId);
    if (!tx) return { settled: false, reason: "not_found" };

    const verdict = args.verdict;
    const allowedFrom: readonly VtuTransactionStatus[] = SETTLE_ALLOWED_FROM[verdict.status];
    if (!allowedFrom.includes(tx.status)) {
      return {
        settled: false,
        reason: TERMINAL_STATUSES.includes(tx.status)
          ? "already_terminal"
          : "illegal_transition",
        status: tx.status,
      };
    }

    // A never-dispatched row may only be declared failed by the one writer that
    // KNOWS nothing was sent. The status alone cannot tell us that, so the
    // source has to, and the check fails closed for every other source.
    if (verdict.status === "failed" && tx.status === "pending" && args.source !== "dispatch") {
      return { settled: false, reason: "illegal_transition", status: tx.status };
    }

    const now = Date.now();

    if (verdict.status === "confirmed") {
      await ctx.db.patch(args.transactionId, {
        status: "confirmed",
        providerReference: verdict.providerReference ?? tx.providerReference,
        ...(verdict.costNgn !== undefined ? { nairaPrice: verdict.costNgn } : {}),
        // MERGED, never replaced with nothing: a webhook that confirms without
        // repeating the token must not erase the token an earlier response
        // already delivered. Field-wise merge, so a partial update adds its
        // own values and leaves the rest intact.
        ...(verdict.delivery
          ? { delivery: { ...(tx.delivery ?? {}), ...verdict.delivery } }
          : {}),
        source: args.source,
        failureReason: undefined,
        failureCode: undefined,
        rawResponse: sanitizeForLog(verdict.raw ?? null),
        resolvedAt: now,
        updatedAt: now,
      });
      return { settled: true, status: "confirmed" };
    }

    if (verdict.status === "unresolved") {
      await ctx.db.patch(args.transactionId, {
        status: "unresolved",
        unresolvedReason: verdict.unresolvedReason,
        failureReason: verdict.message,
        source: args.source,
        rawResponse: sanitizeForLog(verdict.raw ?? null),
        updatedAt: now,
      });
      return { settled: true, status: "unresolved" };
    }

    if (verdict.status === "failed") {
      // The intermediate `failed` write is not decoration: `reverseAndRelease`
      // requires it, which is what keeps "a reversal is only reachable from a
      // failure verdict" true at the single point where it could break. Both
      // writes commit together or neither does.
      await ctx.db.patch(args.transactionId, {
        status: "failed",
        providerReference: verdict.providerReference ?? tx.providerReference,
        failureCode: verdict.code,
        failureReason: verdict.message,
        source: args.source,
        rawResponse: sanitizeForLog(verdict.raw ?? null),
        updatedAt: now,
      });
      const reversal = await reverseAndRelease(ctx, {
        transactionId: args.transactionId,
        reason: verdict.message ?? "Provider reported failure",
        reversalReason: verdict.reversalReason,
        authorizedBy: "provider_verdict",
        source: args.source,
      });
      return reversal.reversed
        ? { settled: true, status: "reversed", creditId: reversal.creditId }
        : { settled: false, reason: "illegal_transition", status: "failed" };
    }

    // verdict.status === "reversed": a human decided to refund.
    const reversal = await reverseAndRelease(ctx, {
      transactionId: args.transactionId,
      reason: verdict.reason ?? "Reversed by an operator",
      reversalReason: verdict.reversalReason,
      authorizedBy: "operator_override",
      source: args.source,
    });
    return reversal.reversed
      ? { settled: true, status: "reversed", creditId: reversal.creditId }
      : { settled: false, reason: "illegal_transition", status: tx.status };
  },
});

/**
 * `processing -> unknown`. NOT a terminal write, which is why it is not
 * `settleTransaction`.
 *
 * "We asked and the transport gave us nothing" is a real, resting, non-terminal
 * state: the points stay debited, the webhook may still arrive, and the sweep
 * will poll it. The name says what it writes; the previous `recordOutcome`
 * could write `confirmed` and `failed` too, and keeping that name around after
 * those two moved out would have left a function whose name promised a
 * capability it no longer had — exactly how a second terminal writer gets
 * reintroduced by accident.
 */
const UNKNOWN_ALLOWED_FROM: readonly VtuTransactionStatus[] = ["processing", "unknown"];

export type MarkUnknownResult =
  | { applied: true }
  | { applied: false; reason: "not_found" | "illegal_transition" };

export const markUnknown = internalMutation({
  args: {
    transactionId: v.id("vtuTransactions"),
    message: v.optional(v.string()),
    providerReference: v.optional(v.string()),
    raw: v.optional(v.any()),
    source: v.union(
      v.literal("dispatch"),
      v.literal("webhook"),
      v.literal("reconciliation"),
      v.literal("admin"),
    ),
  },
  handler: async (ctx, args): Promise<MarkUnknownResult> => {
    const tx = await ctx.db.get(args.transactionId);
    if (!tx) return { applied: false, reason: "not_found" };
    // Refuses `pending` deliberately: a row that was never dispatched has not
    // been asked, so "we do not know" would be a lie about what happened.
    if (!UNKNOWN_ALLOWED_FROM.includes(tx.status)) {
      return { applied: false, reason: "illegal_transition" };
    }

    await ctx.db.patch(args.transactionId, {
      status: "unknown",
      providerReference: args.providerReference ?? tx.providerReference,
      failureReason: args.message,
      source: args.source,
      rawResponse: sanitizeForLog(args.raw ?? null),
      updatedAt: Date.now(),
    });
    return { applied: true };
  },
});

/**
 * `pending -> processing`. Written immediately before the provider call, so a
 * row that ages in `pending` means "never dispatched" while a row that ages in
 * `processing` means "dispatched, never answered".
 */
export const markProcessing = internalMutation({
  args: { transactionId: v.id("vtuTransactions") },
  handler: async (
    ctx,
    args,
  ): Promise<{ marked: boolean; reason?: string }> => {
    const tx = await ctx.db.get(args.transactionId);
    if (!tx) return { marked: false, reason: "not_found" };
    if (tx.status !== "pending") return { marked: false, reason: "not_pending" };

    await ctx.db.patch(args.transactionId, { status: "processing", updatedAt: Date.now() });
    return { marked: true };
  },
});

export type RefundResult =
  | { reversed: true; creditId: Id<"walletLedger">; releasedKey: string }
  | { reversed: false; reason: "not_found" | "illegal_transition" | "already_reversed" };

/**
 * Credit the points back and release the idempotency key so the customer can
 * retry the same request id.
 *
 * A plain helper, NOT a mutation. That is the whole point: `settleTransaction`
 * is the only caller, so there is no way for an action — or a future sweep — to
 * reach a reversal without going through the terminal-status guard first. As a
 * mutation this was reachable in isolation, which is exactly the second writer
 * slice 5 removes.
 *
 * Running inside `settleTransaction`'s mutation context also means the credit
 * and the status write commit together. The credit cannot land without the
 * status, and the status cannot commit without the credit.
 *
 * Two further properties make the release safe to rely on:
 *   1. The credit amount is `pointsDebited` — the FROZEN snapshot. Re-reading
 *      the live rate would refund a different number of points than were
 *      taken and the balance would not return to where it started.
 *   2. The credit key derives from the transaction id, so a duplicate call
 *      cannot pay twice; the status guard also short-circuits first.
 */
async function reverseAndRelease(
  ctx: MutationCtx,
  args: {
    transactionId: Id<"vtuTransactions">;
    reason: string;
    /**
     * WHY this reversal happened, as a closed enum.
     *
     * REQUIRED, not optional, and that is the point: this is the only writer of
     * `status: "reversed"`, so making the argument mandatory here is what makes
     * `reversalReason` non-null on every reversed row by CONSTRUCTION rather
     * than by discipline. Convex cannot express a cross-field constraint
     * (`reversed` implies a reason), so the invariant is enforced at the one
     * place that can break it.
     *
     * The schema field stays optional only because a table validator has no
     * way to say "required when status is reversed".
     */
    reversalReason: VtuReversalReason;
    authorizedBy: ReversalAuthority;
    /**
     * Which path is performing the reversal, written onto the row by this
     * patch.
     *
     * Required because `source` is defined as "which path wrote the LAST
     * transition", and for a reversal this patch IS that transition. Without
     * it an operator's refund would leave the escalation's `reconciliation`
     * sitting on the row — an audit trail naming the wrong actor, which is
     * exactly the sort of drift that is invisible until someone is asked who
     * authorised a refund months later.
     */
    source: SettleSource;
  },
): Promise<RefundResult> {
  const tx = await ctx.db.get(args.transactionId);
  if (!tx) return { reversed: false, reason: "not_found" };
  if (tx.status === "reversed") return { reversed: false, reason: "already_reversed" };
  // Notably refuses `unknown`: releasing an unresolved transaction risks
  // charging a customer twice for a top-up that may have landed.
  const allowedFrom = REVERSIBLE_FROM[args.authorizedBy];
  if (!allowedFrom.includes(tx.status)) {
    return { reversed: false, reason: "illegal_transition" };
  }
  if (tx.reversalWalletLedgerId) return { reversed: false, reason: "already_reversed" };

  const refundAmountNgn = tx.walletDebitedNgn ?? tx.nairaPrice;
  const creditId = await creditWallet(ctx, {
    userId: tx.userId,
    amountNgn: refundAmountNgn,
    type: "vtu_refund",
    description: `VTU refund: ${tx.serviceCode} (${tx.customerIdentifier})`,
    reference: tx.provider,
    idempotencyKey: vtuRefundKey(tx._id),
    metadata: {
      transactionId: tx._id,
      serviceCode: tx.serviceCode,
      reason: args.reason,
      reversalReason: args.reversalReason,
      walletDebitedNgn: refundAmountNgn,
    },
  });

  // Deleting the claim is what lets the customer retry the same
  // clientRequestId without being charged a second time for one attempt.
  const claim = await ctx.db
    .query("vtuIdempotency")
    .withIndex("by_key", (q) => q.eq("key", tx.idempotencyKey))
    .unique();
  if (claim) await ctx.db.delete(claim._id);

  const now = Date.now();
  await ctx.db.patch(args.transactionId, {
    status: "reversed",
    // Written in the SAME patch as the status, so there is no intermediate
    // state in which the row is reversed without a reason.
    reversalReason: args.reversalReason,
    source: args.source,
    reversalWalletLedgerId: creditId,
    reversedAt: now,
    resolvedAt: now,
    failureReason: args.reason,
    updatedAt: now,
  });

  return { reversed: true, creditId, releasedKey: tx.idempotencyKey };
}

/**
 * Find a transaction by the reference the aggregator assigned.
 *
 * The provider is matched against the transaction's ROUTE SNAPSHOT, never
 * against the routing table. The webhook arrives long after dispatch, and an
 * operator may have re-pointed the product in between; re-routing here would
 * let a Pairgate callback settle an AidaPay transaction, or vice versa.
 *
 * `effectiveProvider` is also what makes pre-slice-3 rows (no snapshot) keep
 * matching, without this function knowing that slice history exists.
 */
export const findByProviderReference = internalQuery({
  args: { provider: v.string(), providerReference: v.string() },
  handler: async (ctx, args) => {
    const matches = await ctx.db
      .query("vtuTransactions")
      .withIndex("by_provider_reference", (q) =>
        q.eq("providerReference", args.providerReference),
      )
      .take(5);
    const row = matches.find((t) => effectiveProvider(t) === args.provider);
    return row?._id ?? null;
  },
});

/**
 * Record a callback we could not match.
 *
 * Audited rather than rejected: a 4xx makes the aggregator retry forever
 * against a reference that will never resolve on our side.
 */
export const auditUnmatchedCallback = internalMutation({
  args: { provider: v.string(), providerReference: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert("auditLogs", {
      action: "vtu_callback_unmatched",
      resource: "vtuTransaction",
      resourceId: args.providerReference,
      after: { provider: args.provider },
      reason: "No transaction matched this provider reference",
      createdAt: Date.now(),
    });
  },
});

// NOTE: provider configuration is no longer read here. Resolution lives in
// `vtuProviderConfig.ts` (V8, testable) and credential opening in
// `vtuProviderCall.ts` ("use node"), so a sealed credential never travels
// through a mutation result on its way to the HTTP call.

/** Subscribe to one transaction. Owner-only; the page renders whatever this says. */
export const getTransaction = query({
  args: { transactionId: v.id("vtuTransactions") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const tx = await ctx.db.get(args.transactionId);
    if (!tx || tx.userId !== userId) return null;
    return {
      _id: tx._id,
      status: tx.status,
      serviceCode: tx.serviceCode,
      network: tx.network ?? null,
      customerIdentifier: tx.customerIdentifier,
      nairaPrice: tx.nairaPrice,
      ngnPerPoint: tx.ngnPerPoint,
      pointsDebited: tx.pointsDebited,
      walletDebitedNgn: tx.walletDebitedNgn ?? tx.nairaPrice,
      providerReference: tx.providerReference ?? null,
      // For prepaid electricity the token IS the delivery, so the page that
      // just bought it must be able to show it without a round trip to the
      // history list.
      delivery: tx.delivery ?? null,
      failureReason: tx.failureReason ?? null,
      createdAt: tx.createdAt,
      updatedAt: tx.updatedAt,
    };
  },
});
