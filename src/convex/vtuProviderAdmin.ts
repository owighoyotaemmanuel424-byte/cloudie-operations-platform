/**
 * Admin management for VTU providers.
 *
 * Every function here re-verifies the admin role SERVER-SIDE via
 * `requireAdmin`, regardless of what the client believes. The `RequireAdmin`
 * component is a convenience layer, not the security boundary.
 *
 * The load-bearing rule of this file: no query here ever returns a sealed or
 * plaintext credential. Admin reads return `hasApiKey` / `hasWebhookSecret`
 * booleans. Convex subscriptions stream query results to every subscribed
 * browser, so a credential in a query result is a credential in every admin's
 * page source — and in the audit log if it is also written there.
 */

import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { auditLog, requireAdmin } from "./adminApi";
import { encrypt, isSecretError } from "./lib/encryption";
import { VTU_AUTH_SCHEMES, VTU_PROVIDER_STATUSES } from "./schema";
import { PROVIDER_PRESETS } from "../lib/vtuProviderPresets";

/**
 * Seal a secret, turning a missing master key into an actionable message
 * rather than an opaque `ENCRYPTION_KEY_NOT_CONFIGURED` code.
 */
async function sealOrThrow(plaintext: string): Promise<string> {
  try {
    return await encrypt(plaintext);
  } catch (error) {
    if (isSecretError(error) && error.code === "ENCRYPTION_KEY_NOT_CONFIGURED") {
      throw new Error(
        "APP_MASTER_KEY is not configured. Add it in the project Keys panel before saving provider credentials.",
      );
    }
    throw error;
  }
}

const statusValidator = v.union(
  ...VTU_PROVIDER_STATUSES.map((s) => v.literal(s)),
);

/**
 * The closed auth-scheme enum, validated here exactly as the schema does.
 *
 * A free string would let a typo through to a provider that then rejects every
 * call with a confusing 401. The union makes the bad value unrepresentable.
 */
const authSchemeValidator = v.union(
  ...VTU_AUTH_SCHEMES.map((s) => v.literal(s)),
);

// ─── Reads ─────────────────────────────────────────────────────────

/**
 * All providers, for the admin table.
 *
 * `hasApiKey` / `hasWebhookSecret` are booleans precisely so the UI can show
 * "configured" without ever receiving the value.
 */
export const listProviders = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const rows = await ctx.db
      .query("vtuProviders")
      .withIndex("by_status_priority")
      .collect();

    return rows.map((p) => ({
      _id: p._id,
      name: p.name,
      displayName: p.displayName,
      status: p.status,
      active: p.status === "active",
      baseUrl: p.baseUrl,
      healthPath: p.healthPath ?? null,
      authHeader: p.authHeader ?? null,
      authScheme: p.authScheme ?? "",
      callbackSignatureHeader: p.callbackSignatureHeader ?? null,
      timeoutMs: p.timeoutMs ?? null,
      priority: p.priority ?? 100,
      lastTestedAt: p.lastTestedAt ?? null,
      lastTestOk: p.lastTestOk ?? null,
      lastTestError: p.lastTestError ?? null,
      // Booleans. The sealed values stay on the server.
      hasApiKey: Boolean(p.encryptedApiKey),
      hasWebhookSecret: Boolean(p.encryptedWebhookSecret),
      hasAccountPin: Boolean(p.encryptedAccountPin),
      updatedAt: p.updatedAt,
    }));
  },
});

/** Is this user an admin? Used by actions, which cannot use `requireAdmin`. */
export const isAdmin = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    return user?.role === "admin" && !user.isSuspended;
  },
});

/**
 * The row the test-connection action needs.
 *
 * Internal and action-facing, so it returns the SEALED key for that action to
 * open. No public query may do this — a public query is subscribable.
 */
export const getForTest = internalQuery({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("vtuProviders")
      .withIndex("by_name", (q) => q.eq("name", args.name))
      .unique();
    if (!row) return null;
    return {
      baseUrl: row.baseUrl,
      encryptedApiKey: row.encryptedApiKey,
      healthPath: row.healthPath,
      authHeader: row.authHeader,
      authScheme: row.authScheme,
    };
  },
});

export const recordTestResult = internalMutation({
  args: { name: v.string(), ok: v.boolean(), error: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("vtuProviders")
      .withIndex("by_name", (q) => q.eq("name", args.name))
      .unique();
    if (!row) return;
    await ctx.db.patch(row._id, {
      lastTestedAt: Date.now(),
      lastTestOk: args.ok,
      lastTestError: args.error,
      updatedAt: Date.now(),
    });
  },
});

// ─── Writes ─────────────────────────────────────────────────────────

export const createProvider = mutation({
  args: {
    name: v.string(),
    displayName: v.string(),
    baseUrl: v.string(),
    apiKey: v.string(),
    webhookSecret: v.optional(v.string()),
    accountPin: v.optional(v.string()),
    status: v.optional(statusValidator),
    healthPath: v.optional(v.string()),
    authHeader: v.optional(v.string()),
    authScheme: v.optional(authSchemeValidator),
    callbackSignatureHeader: v.optional(v.string()),
    timeoutMs: v.optional(v.number()),
    priority: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { adminId } = await requireAdmin(ctx);

    const name = args.name.trim().toLowerCase();
    if (!/^[a-z0-9_-]{2,32}$/.test(name)) {
      throw new Error("Provider name must be 2-32 characters: a-z, 0-9, - or _");
    }

    const existing = await ctx.db
      .query("vtuProviders")
      .withIndex("by_name", (q) => q.eq("name", name))
      .unique();
    if (existing) throw new Error("A provider with this name already exists");

    const now = Date.now();
    const sealedKey = await sealOrThrow(args.apiKey);
    const sealedWebhook = args.webhookSecret
      ? await sealOrThrow(args.webhookSecret)
      : undefined;
    // Sealed separately from the API key: it is a different secret with its
    // own rotation, and sharing one ciphertext would couple them.
    const sealedPin = args.accountPin ? await sealOrThrow(args.accountPin) : undefined;

    const id: Id<"vtuProviders"> = await ctx.db.insert("vtuProviders", {
      name,
      displayName: args.displayName.trim() || name,
      status: args.status ?? "disabled",
      baseUrl: args.baseUrl.trim(),
      // Sealed at the boundary. A plaintext key never reaches the database.
      encryptedApiKey: sealedKey,
      encryptedWebhookSecret: sealedWebhook,
      encryptedAccountPin: sealedPin,
      healthPath: args.healthPath,
      authHeader: args.authHeader,
      authScheme: args.authScheme,
      callbackSignatureHeader: args.callbackSignatureHeader,
      timeoutMs: args.timeoutMs,
      priority: args.priority ?? 100,
      updatedBy: adminId,
      createdAt: now,
      updatedAt: now,
    });

    // The audit row records the shape of the change, never the secret.
    await auditLog(ctx, adminId, {
      action: "vtu_provider_created",
      resource: "vtuProvider",
      resourceId: name,
      after: {
        name,
        baseUrl: args.baseUrl,
        status: args.status ?? "disabled",
        authScheme: args.authScheme ?? "",
        hasApiKey: true,
        hasWebhookSecret: Boolean(args.webhookSecret),
        hasAccountPin: Boolean(args.accountPin),
      },
    });

    return id;
  },
});

/**
 * Update a provider.
 *
 * Omitting `apiKey` / `webhookSecret` LEAVES THE EXISTING SEALED VALUE ALONE.
 * That is what lets the admin UI show `••••••••` and offer "Replace key" without
 * a read-modify-write that would need the plaintext it is never given.
 */
export const updateProvider = mutation({
  args: {
    name: v.string(),
    displayName: v.optional(v.string()),
    baseUrl: v.optional(v.string()),
    apiKey: v.optional(v.string()),
    webhookSecret: v.optional(v.string()),
    clearWebhookSecret: v.optional(v.boolean()),
    accountPin: v.optional(v.string()),
    clearAccountPin: v.optional(v.boolean()),
    status: v.optional(statusValidator),
    healthPath: v.optional(v.string()),
    authHeader: v.optional(v.string()),
    authScheme: v.optional(authSchemeValidator),
    callbackSignatureHeader: v.optional(v.string()),
    timeoutMs: v.optional(v.number()),
    priority: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { adminId } = await requireAdmin(ctx);

    const row = await ctx.db
      .query("vtuProviders")
      .withIndex("by_name", (q) => q.eq("name", args.name))
      .unique();
    if (!row) throw new Error("Provider not found");

    const patch: Record<string, unknown> = { updatedAt: Date.now(), updatedBy: adminId };
    if (args.displayName !== undefined) patch.displayName = args.displayName;
    if (args.baseUrl !== undefined) patch.baseUrl = args.baseUrl;
    if (args.status !== undefined) patch.status = args.status;
    if (args.healthPath !== undefined) patch.healthPath = args.healthPath;
    if (args.authHeader !== undefined) patch.authHeader = args.authHeader;
    if (args.authScheme !== undefined) patch.authScheme = args.authScheme;
    if (args.callbackSignatureHeader !== undefined) {
      patch.callbackSignatureHeader = args.callbackSignatureHeader;
    }
    if (args.timeoutMs !== undefined) patch.timeoutMs = args.timeoutMs;
    if (args.priority !== undefined) patch.priority = args.priority;
    if (args.notes !== undefined) patch.notes = args.notes;

    if (args.apiKey) patch.encryptedApiKey = await sealOrThrow(args.apiKey);
    if (args.webhookSecret) {
      patch.encryptedWebhookSecret = await sealOrThrow(args.webhookSecret);
    }
    if (args.clearWebhookSecret) patch.encryptedWebhookSecret = undefined;

    // Same leave-alone-unless-replaced rule as the other two secrets: the UI
    // shows a mask and offers "Replace", and never receives the plaintext.
    if (args.accountPin) patch.encryptedAccountPin = await sealOrThrow(args.accountPin);
    if (args.clearAccountPin) patch.encryptedAccountPin = undefined;

    await ctx.db.patch(row._id, patch);

    await auditLog(ctx, adminId, {
      action: "vtu_provider_updated",
      resource: "vtuProvider",
      resourceId: args.name,
      before: { status: row.status, baseUrl: row.baseUrl },
      after: {
        status: args.status ?? row.status,
        baseUrl: args.baseUrl ?? row.baseUrl,
        authScheme: args.authScheme ?? row.authScheme ?? "",
        apiKeyReplaced: Boolean(args.apiKey),
        webhookSecretReplaced: Boolean(args.webhookSecret || args.clearWebhookSecret),
        accountPinReplaced: Boolean(args.accountPin || args.clearAccountPin),
      },
      reason: args.apiKey ? "credential replaced" : "configuration updated",
    });
  },
});

/**
 * Change a provider's status.
 *
 * `disabled` stops NEW purchases routing to it, because resolution gates on
 * `status === "active"` before a purchase is reserved. It does NOT abort
 * anything in flight: a transaction already dispatched is settled against the
 * provider reference it carries, and webhook verification deliberately still
 * accepts a disabled provider so those transactions can complete.
 */
export const setProviderStatus = mutation({
  args: { name: v.string(), status: statusValidator, reason: v.string() },
  handler: async (ctx, args) => {
    const { adminId } = await requireAdmin(ctx);
    if (!args.reason || args.reason.trim().length < 3) {
      throw new Error("A reason is required");
    }

    const row = await ctx.db
      .query("vtuProviders")
      .withIndex("by_name", (q) => q.eq("name", args.name))
      .unique();
    if (!row) throw new Error("Provider not found");

    await ctx.db.patch(row._id, {
      status: args.status,
      updatedAt: Date.now(),
      updatedBy: adminId,
    });

    await auditLog(ctx, adminId, {
      action: "vtu_provider_status_changed",
      resource: "vtuProvider",
      resourceId: args.name,
      before: { status: row.status },
      after: { status: args.status },
      reason: args.reason,
    });
  },
});

export const deleteProvider = mutation({
  args: { name: v.string(), reason: v.string() },
  handler: async (ctx, args) => {
    const { adminId } = await requireAdmin(ctx);
    if (!args.reason || args.reason.trim().length < 3) {
      throw new Error("A reason is required");
    }

    const row = await ctx.db
      .query("vtuProviders")
      .withIndex("by_name", (q) => q.eq("name", args.name))
      .unique();
    if (!row) throw new Error("Provider not found");

    const inFlight = await ctx.db
      .query("vtuTransactions")
      .withIndex("by_status", (q) => q.eq("status", "processing"))
      .take(50);
    const owned = inFlight.filter((t) => t.provider === args.name);
    if (owned.length > 0) {
      throw new Error(
        `Cannot delete: ${owned.length} transaction(s) are still in flight for this provider. Disable it instead — disabling lets those complete.`,
      );
    }

    await ctx.db.delete(row._id);
    await auditLog(ctx, adminId, {
      action: "vtu_provider_deleted",
      resource: "vtuProvider",
      resourceId: args.name,
      before: { name: row.name, baseUrl: row.baseUrl, status: row.status },
      reason: args.reason,
    });
  },
});

// ─── Preset configuration ───────────────────────────────────────────

/**
 * Configure a provider from a known-good preset, in one step.
 *
 * The admin form has eight fields, six of which are constants of the provider
 * rather than choices of the operator. Typing `https://aidapay.ng/api/v1` into
 * a base-URL box produces a well-formed URL that resolves to
 * `.../api/v1/api/v1/buy` on every purchase — a misconfiguration that reads
 * as correct and only surfaces as a 404 on live traffic.
 *
 * This mutation is the alternative: the operator supplies the API key, the
 * account PIN and optionally the status, and every constant comes from
 * `PROVIDER_PRESETS` — the same module the UI renders the preview from, so
 * what is promised and what is written cannot drift.
 *
 * IDEMPOTENT BY CONSTRUCTION AND UPSERT-SAFE. An existing row keeps its sealed
 * API key and PIN unless the operator supplies new ones, which is the same
 * "omitting leaves it alone" rule `updateProvider` follows, so re-running this
 * to repair a wrong base URL cannot silently rotate a credential.
 *
 * It REPAIRS the constants unconditionally, including on a row an operator
 * hand-edited. That is the point of running it: the constants belong to the
 * provider, so re-asserting them cannot lose anything the operator chose.
 * The status and priority are left alone unless passed, since those ARE
 * choices.
 */
export const applyPreset = mutation({
  args: {
    preset: v.string(),
    apiKey: v.optional(v.string()),
    accountPin: v.optional(v.string()),
    webhookSecret: v.optional(v.string()),
    status: v.optional(statusValidator),
    priority: v.optional(v.number()),
    activate: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { adminId } = await requireAdmin(ctx);

    const preset = PROVIDER_PRESETS[args.preset.trim().toLowerCase()];
    if (!preset) {
      throw new Error(
        `No preset named "${args.preset}". Known presets: ${Object.keys(PROVIDER_PRESETS).join(", ") || "none"}.`,
      );
    }

    const apiKey = args.apiKey?.trim();
    const pin = args.accountPin?.trim();

    const now = Date.now();
    const existing = await ctx.db
      .query("vtuProviders")
      .withIndex("by_name", (q) => q.eq("name", preset.name))
      .unique();

    // An API key is required to CREATE a row, but repairing the constants of a
    // row that already has one must not demand the secret be re-typed — that
    // is the whole reason the preset form exists, and asking for the key again
    // to fix a wrong base URL would reintroduce exactly the friction it
    // removes. Same rule as the PIN below: a stored sealed value counts.
    if (!apiKey && !existing?.encryptedApiKey) {
      throw new Error("The API key is required.");
    }

    // A preset that requires a PIN cannot be configured without one: the
    // adapter refuses to dispatch rather than sending a placeholder. On an
    // existing row a PIN already sealed counts, so repairing the constants of a
    // configured provider does not demand the secret be re-typed.
    if (preset.requiresAccountPin && !pin && !existing?.encryptedAccountPin) {
      throw new Error(
        `${preset.displayName} requires a 4-digit account PIN on every purchase.`,
      );
    }

    // Re-assert every constant. The operator's own choices — status,
    // priority, and any credential they did not re-type — are preserved.
    const constants = {
      name: preset.name,
      displayName: preset.displayName,
      baseUrl: preset.baseUrl,
      healthPath: preset.healthPath,
      authHeader: preset.authHeader,
      authScheme: preset.authScheme,
      callbackSignatureHeader: preset.callbackSignatureHeader,
      timeoutMs: preset.timeoutMs,
    };

    if (existing) {
      const patch: Record<string, unknown> = {
        ...constants,
        updatedAt: now,
        updatedBy: adminId,
      };
      // Omitting the key keeps the sealed value in place — a repair must not
      // rotate a credential.
      if (apiKey) patch.encryptedApiKey = await sealOrThrow(apiKey);
      if (pin) patch.encryptedAccountPin = await sealOrThrow(pin);
      if (args.webhookSecret?.trim()) {
        patch.encryptedWebhookSecret = await sealOrThrow(args.webhookSecret.trim());
      }
      if (args.status !== undefined) patch.status = args.status;
      // `activate` is honoured on an EXISTING row too, and only ever promotes.
      // Leaving it out must not demote a live provider back to sandbox, but
      // ticking "Go live now" while repairing a misconfigured sandbox row has
      // to actually take effect — otherwise the checkbox silently does nothing
      // on exactly the row the operator is looking at.
      else if (args.activate) patch.status = "active";
      if (args.priority !== undefined) patch.priority = args.priority;

      await ctx.db.patch(existing._id, patch);
      await auditLog(ctx, adminId, {
        action: "vtu_provider_preset_applied",
        resource: "vtuProvider",
        resourceId: preset.name,
        before: { baseUrl: existing.baseUrl, healthPath: existing.healthPath ?? null },
        after: {
          ...constants,
          apiKeyReplaced: Boolean(apiKey),
          accountPinReplaced: Boolean(pin),
        },
        reason: "Applied preset constants",
      });
      return { name: preset.name, created: false as const };
    }

    // Guaranteed non-empty on this branch: the guard above refused unless a key
    // was supplied OR one is already stored, and an existing row returns above.
    const sealedApiKey = await sealOrThrow(apiKey ?? existing!.encryptedApiKey!);

    const id = await ctx.db.insert("vtuProviders", {
      ...constants,
      // Sandbox by default. A provider that has never answered a connection
      // test does not belong in the live routing table.
      status: args.status ?? (args.activate ? "active" : "sandbox"),
      encryptedApiKey: sealedApiKey,
      encryptedAccountPin: pin ? await sealOrThrow(pin) : undefined,
      encryptedWebhookSecret: args.webhookSecret?.trim()
        ? await sealOrThrow(args.webhookSecret.trim())
        : undefined,
      priority: args.priority ?? preset.priority,
      createdAt: now,
      updatedAt: now,
      updatedBy: adminId,
    });

    await auditLog(ctx, adminId, {
      action: "vtu_provider_preset_applied",
      resource: "vtuProvider",
      resourceId: preset.name,
      after: {
        ...constants,
        status: args.status ?? (args.activate ? "active" : "sandbox"),
        hasApiKey: true,
        hasAccountPin: Boolean(pin),
      },
      reason: "Created from preset",
    });

    return { name: preset.name, created: true as const, id };
  },
});

/**
 * The provider's own callback URL, for the admin to paste into AidaPay's
 * dashboard.
 *
 * Returned rather than composed in the client because the host is a server
 * fact. The AidaPay dashboard cannot send custom headers, which is why this is
 * a per-provider PATH: the path is the only place the provider identity can
 * live.
 */
export const getPresetSetup = query({
  args: { preset: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const preset = PROVIDER_PRESETS[args.preset.trim().toLowerCase()];
    if (!preset) return null;
    return {
      name: preset.name,
      displayName: preset.displayName,
      baseUrl: preset.baseUrl,
      healthPath: preset.healthPath,
      authHeader: preset.authHeader,
      authScheme: preset.authScheme,
      callbackSignatureHeader: preset.callbackSignatureHeader,
      webhookPath: preset.webhookPath,
      priority: preset.priority,
      requiresAccountPin: preset.requiresAccountPin,
      // `CONVEX_SITE_URL` rather than `ctx.convex.siteUrl`: that is an action
      // context property, and this is a query. The env var is the same value,
      // and it is already the source `auth.config.ts` trusts.
      callbackUrl: process.env.CONVEX_SITE_URL
        ? `${process.env.CONVEX_SITE_URL.replace(/\/+$/, "")}${preset.webhookPath}`
        : preset.webhookPath,
    };
  },
});

// ─── Migration ──────────────────────────────────────────────────────

/**
 * Seed the Pairgate row from env, ONCE.
 *
 * On the FIRST run it inserts `pairgate` with status `sandbox` — the status
 * the slice-1 integration actually runs in, so nothing changes for users.
 *
 * On EVERY SUBSEQUENT run it is a NO-OP for the credential: an existing row
 * keeps its sealed key. Only `baseUrl` and display metadata are refreshed when
 * they are empty. Re-running can never create a second row or silently
 * overwrite an admin-supplied key.
 *
 * After this runs, `PAIRGATE_API_KEY` and `PAIRGATE_WEBHOOK_SECRET` are DEAD
 * for runtime purposes. Resolution reads the table and nothing else, with no
 * fallback under any condition — a deleted row must fail loudly rather than
 * resurrect a credential somebody deliberately removed.
 *
 * Also upgrades a slice-1 row that still carries the old `provider` /
 * `encryptedSecret` field names, so a pre-cutover row is repaired in place
 * rather than duplicated.
 *
 * A missing `PAIRGATE_API_KEY` is REPORTED (`action: "no_env"`) rather than
 * thrown. Convex redacts the message of a thrown error in a production
 * deployment, so the admin saw "Server Error / Called by client" and a request
 * ID while the one actionable sentence stayed on the server. A status in the
 * return value survives redaction, which is the only reason this is a return
 * instead of a throw.
 */
export const migratePairgateFromEnv = mutation({
  args: {},
  handler: async (ctx) => {
    const { adminId } = await requireAdmin(ctx);
    const now = Date.now();

    // Legacy shape: schema validation is off, so an old row is still readable.
    const all = await ctx.db.query("vtuProviders").take(20);
    const legacy: any = all.find(
      (p: any) => !p.name && typeof p.provider === "string",
    );
    if (legacy) {
      await ctx.db.delete(legacy._id);
      await ctx.db.insert("vtuProviders", {
        name: String(legacy.provider),
        displayName: legacy.displayName ?? String(legacy.provider),
        status: legacy.status ?? "sandbox",
        baseUrl: legacy.baseUrl ?? "",
        // Re-seals the old ciphertext under the current primary key. The old
        // payload stays readable via the legacy ring entry either way.
        encryptedApiKey: legacy.encryptedSecret ?? "",
        encryptedWebhookSecret: legacy.encryptedCallbackSecret ?? undefined,
        callbackSignatureHeader: legacy.callbackSignatureHeader ?? undefined,
        authHeader: legacy.authHeader ?? undefined,
        timeoutMs: legacy.timeoutMs ?? undefined,
        priority: 100,
        updatedBy: adminId,
        createdAt: legacy._creationTime ?? now,
        updatedAt: now,
      });
      await auditLog(ctx, adminId, {
        action: "vtu_provider_migrated_legacy_row",
        resource: "vtuProvider",
        resourceId: String(legacy.provider),
        reason: "Upgraded slice-1 field names in place",
      });
      return { action: "upgraded_legacy" as const, provider: String(legacy.provider) };
    }

    const existing = await ctx.db
      .query("vtuProviders")
      .withIndex("by_name", (q) => q.eq("name", "pairgate"))
      .unique();

    if (existing) {
      // Idempotent no-op. An admin-supplied key is never overwritten.
      if (!existing.baseUrl) {
        await ctx.db.patch(existing._id, { baseUrl: "", updatedAt: now });
      }
      await auditLog(ctx, adminId, {
        action: "vtu_provider_migration_noop",
        resource: "vtuProvider",
        resourceId: "pairgate",
        reason: "Row already present",
      });
      return { action: "noop" as const, provider: "pairgate" };
    }

    const apiKey = process.env.PAIRGATE_API_KEY;
    if (!apiKey) {
      await auditLog(ctx, adminId, {
        action: "vtu_provider_migration_skipped",
        resource: "vtuProvider",
        resourceId: "pairgate",
        reason:
          "PAIRGATE_API_KEY is not configured; nothing to seed, and no row was written",
      });
      return { action: "no_env" as const, provider: "pairgate" };
    }

    const sealedKey = await sealOrThrow(apiKey);

    const webhookSecret = process.env.PAIRGATE_WEBHOOK_SECRET;
    const sealedWebhook = webhookSecret ? await sealOrThrow(webhookSecret) : undefined;

    await ctx.db.insert("vtuProviders", {
      name: "pairgate",
      displayName: "Pairgate",
      // Sandbox, not active: this is what slice 1 actually ran against, so
      // nothing changes for existing users.
      status: "sandbox",
      baseUrl: process.env.PAIRGATE_BASE_URL ?? "https://api.pairgate.com",
      encryptedApiKey: sealedKey,
      encryptedWebhookSecret: sealedWebhook,
      callbackSignatureHeader: "x-pairgate-signature",
      authHeader: "x-api-key",
      healthPath: "/api/v1/balance",
      timeoutMs: 20_000,
      priority: 100,
      updatedBy: adminId,
      createdAt: now,
      updatedAt: now,
    });

    await auditLog(ctx, adminId, {
      action: "vtu_provider_migrated",
      resource: "vtuProvider",
      resourceId: "pairgate",
      after: { name: "pairgate", status: "sandbox", hasApiKey: true },
      reason: "Seeded from PAIRGATE_API_KEY; env vars are no longer read at runtime",
    });

    return { action: "inserted" as const, provider: "pairgate" };
  },
});

/**
 * Seed the AidaPay row from environment variables.
 *
 * The deployed configuration path. An operator sets the provider's credentials
 * once, as secrets, and this mutation seals them into the row the runtime
 * resolves. Nothing else about how a credential is used changes: resolution
 * still reads `vtuProviders` and NOTHING else, with no env fallback under any
 * condition, so a row that is deleted or disabled fails loudly rather than
 * being resurrected from a stale environment.
 *
 * This is deliberately the same shape as `migratePairgateFromEnv` and shares
 * its central rule: RE-RUNNING IS SAFE. It fills what is MISSING and never
 * overwrites a credential that is already sealed, so it can be run on every
 * deploy without rotating a live key, and an operator who pasted a new key into
 * the admin UI does not have it silently reverted by the next boot.
 *
 * Reads, in order of who owns each value:
 *
 *   AIDAPAY_API_KEY         required to create the row. The Bearer token from
 *                           AidaPay's dashboard (Settings -> API Settings).
 *   AIDAPAY_ACCOUNT_PIN     the 4-digit PIN AidaPay requires on every purchase.
 *                           Without one the adapter refuses to dispatch, so a
 *                           row created without it is created but flagged.
 *   AIDAPAY_WEBHOOK_SECRET  optional, and DEFAULTS TO THE API KEY. AidaPay's
 *                           documented callback signature is
 *                           `hash_hmac('sha256', $body, $access_token)`, so the
 *                           token IS the signing key; defaulting it here is what
 *                           makes webhooks verify without a second copy of the
 *                           same secret. Setting it explicitly is for the case
 *                           where the signing key is rotated separately.
 *   AIDAPAY_STATUS          optional: active | sandbox | disabled. Defaults to
 *                           `sandbox`, because AidaPay publishes no sandbox and
 *                           a new row must be promoted to live deliberately.
 *
 * The provider's CONSTANTS — origin, health path, auth header and scheme,
 * signature header, timeout — come from `PROVIDER_PRESETS` rather than from the
 * environment. They are properties of AidaPay, not of this deployment, and
 * letting a deploy override them is how `baseUrl` came to carry a `/api/v1`
 * prefix that produced `.../api/v1/api/v1/buy` on every purchase.
 *
 * A missing API key is REPORTED (`action: "no_env"`) rather than thrown. Convex
 * redacts a thrown error's message in production, which would leave the
 * operator with "Server Error" and a request id while the one actionable
 * sentence stayed on the server.
 */
export const migrateAidaPayFromEnv = mutation({
  args: {},
  handler: async (ctx) => {
    const { adminId } = await requireAdmin(ctx);
    const preset = PROVIDER_PRESETS["aidapay"];
    if (!preset) throw new Error("No aidapay preset is registered.");

    const now = Date.now();
    const existing = await ctx.db
      .query("vtuProviders")
      .withIndex("by_name", (q) => q.eq("name", preset.name))
      .unique();

    const envKey = (process.env.AIDAPAY_API_KEY ?? "").trim();

    // An existing row with a sealed key needs no environment at all: this can
    // legitimately be run to repair a hand-edited `baseUrl` on a deployment
    // that keeps its credential only in the database.
    if (!envKey && !existing?.encryptedApiKey) {
      await auditLog(ctx, adminId, {
        action: "vtu_provider_migration_skipped",
        resource: "vtuProvider",
        resourceId: preset.name,
        reason:
          "AIDAPAY_API_KEY is not configured and no credential is stored; nothing was written",
      });
      // ONE return shape for every branch, including this one. A union whose
      // members carry different fields forces every caller to narrow before it
      // can read a result, and the alternative — callers casting — is how a
      // status report starts lying.
      return {
        action: "no_env" as const,
        provider: preset.name,
        filled: { apiKey: false, accountPin: false, webhookSecret: false },
        hasAccountPin: false,
      };
    }

    const envPin = (process.env.AIDAPAY_ACCOUNT_PIN ?? "").trim();
    // Documented algorithm: HMAC-SHA256 over the raw body keyed by the access
    // token. So the token is the default signing key, and a separate value is
    // only needed when it is rotated independently.
    const envWebhookSecret = (process.env.AIDAPAY_WEBHOOK_SECRET ?? "").trim()
      || envKey;

    const statusFromEnv = (process.env.AIDAPAY_STATUS ?? "").trim().toLowerCase();
    const status = (VTU_PROVIDER_STATUSES as readonly string[]).includes(statusFromEnv)
      ? (statusFromEnv as (typeof VTU_PROVIDER_STATUSES)[number])
      : undefined;

    // Every constant re-asserted, exactly as `applyPreset` does. The two paths
    // read the same module, so a row seeded from env and a row configured in
    // admin are indistinguishable afterwards.
    const constants = {
      displayName: preset.displayName,
      baseUrl: preset.baseUrl,
      healthPath: preset.healthPath,
      authHeader: preset.authHeader,
      authScheme: preset.authScheme,
      callbackSignatureHeader: preset.callbackSignatureHeader,
      timeoutMs: preset.timeoutMs,
    };

    if (existing) {
      const patch: Record<string, unknown> = {
        ...constants,
        updatedAt: now,
        updatedBy: adminId,
      };

      // FILL, NEVER OVERWRITE. A credential already sealed was either pasted by
      // an operator or written by an earlier run of this mutation, and either
      // way it is the more recent statement of intent than the environment.
      let keyFilled = false;
      let pinFilled = false;
      let secretFilled = false;
      if (!existing.encryptedApiKey && envKey) {
        patch.encryptedApiKey = await sealOrThrow(envKey);
        keyFilled = true;
      }
      if (!existing.encryptedAccountPin && envPin) {
        patch.encryptedAccountPin = await sealOrThrow(envPin);
        pinFilled = true;
      }
      if (!existing.encryptedWebhookSecret && envWebhookSecret) {
        patch.encryptedWebhookSecret = await sealOrThrow(envWebhookSecret);
        secretFilled = true;
      }
      if (status !== undefined) patch.status = status;

      await ctx.db.patch(existing._id, patch);

      await auditLog(ctx, adminId, {
        action: "vtu_provider_migrated_from_env",
        resource: "vtuProvider",
        resourceId: preset.name,
        before: { baseUrl: existing.baseUrl, healthPath: existing.healthPath ?? null },
        after: {
          ...constants,
          apiKeyFilled: keyFilled,
          accountPinFilled: pinFilled,
          webhookSecretFilled: secretFilled,
          status: status ?? existing.status,
        },
        reason: "Re-asserted preset constants; missing credentials filled from environment",
      });

      return {
        action: "updated" as const,
        provider: preset.name,
        filled: { apiKey: keyFilled, accountPin: pinFilled, webhookSecret: secretFilled },
        hasAccountPin: Boolean(existing.encryptedAccountPin || pinFilled),
      };
    }

    // Guaranteed non-empty: the guard above refused unless a key was supplied
    // OR one is already stored, and an existing row returned above.
    const sealedApiKey = await sealOrThrow(envKey);

    await ctx.db.insert("vtuProviders", {
      name: preset.name,
      ...constants,
      // Sandbox unless the environment explicitly says otherwise. AidaPay has
      // no sandbox environment, so the only safe default for a row that has
      // never answered a connection test is "do not route live money at it".
      status: status ?? "sandbox",
      encryptedApiKey: sealedApiKey,
      encryptedAccountPin: envPin ? await sealOrThrow(envPin) : undefined,
      encryptedWebhookSecret: envWebhookSecret
        ? await sealOrThrow(envWebhookSecret)
        : undefined,
      priority: preset.priority,
      createdAt: now,
      updatedAt: now,
      updatedBy: adminId,
    });

    await auditLog(ctx, adminId, {
      action: "vtu_provider_migrated_from_env",
      resource: "vtuProvider",
      resourceId: preset.name,
      after: {
        ...constants,
        status: status ?? "sandbox",
        hasApiKey: true,
        hasAccountPin: Boolean(envPin),
        hasWebhookSecret: Boolean(envWebhookSecret),
      },
      reason: "Seeded from AIDAPAY_* environment variables; env is no longer read at runtime",
    });

    return {
      action: "inserted" as const,
      provider: preset.name,
      filled: { apiKey: true, accountPin: Boolean(envPin), webhookSecret: true },
      hasAccountPin: Boolean(envPin),
    };
  },
});
