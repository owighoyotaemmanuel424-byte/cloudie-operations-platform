import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { effectivePointsCost } from "./pricing";

/*
 * Business Suite — owner-facing management of white-label tenant sites.
 *
 * Every read/write here is scoped to the signed-in user: a site is reachable
 * when the user owns it, holds an owner/admin membership on it, or is a
 * platform admin. Nothing is trusted from the client except the tenantId, and
 * that is checked on every single handler.
 */

/** Fallback plan price; overridable from the admin pricing screen. */
const DEFAULT_RENEWAL_POINTS = 250;
/** Grace window after a missed renewal before customer pages go read-only. */
const GRACE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Fonts the Theme tab may set — keeps stored values renderable on the client. */
const FONTS = [
  "Inter",
  "DM Sans",
  "Sora",
  "Manrope",
  "Space Grotesk",
  "IBM Plex Sans",
  "Source Serif 4",
  "Fraunces",
];
const HEX = /^#[0-9a-fA-F]{6}$/;
const DOMAIN = /^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/;

async function writeAudit(
  ctx: MutationCtx,
  args: {
    actorId: Id<"users">;
    actorEmail?: string;
    action: string;
    resourceId: string;
    reason?: string;
    before?: unknown;
    after?: unknown;
  },
) {
  await ctx.db.insert("auditLogs", {
    actorId: args.actorId,
    actorEmail: args.actorEmail,
    action: args.action,
    resource: "tenantSites",
    resourceId: args.resourceId,
    reason: args.reason,
    before: args.before,
    after: args.after,
    createdAt: Date.now(),
  });
}

/** Load a site for an already-identified user (also used by the DNS action). */
async function loadSiteFor(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenantSites">,
  userId: Id<"users">,
): Promise<{ site: Doc<"tenantSites">; user: Doc<"users"> }> {
  const user = await ctx.db.get(userId);
  if (!user) throw new Error("User not found");
  const site = await ctx.db.get(tenantId);
  if (!site) throw new Error("Site not found");

  const isPlatformAdmin = user.role === "admin";
  if (site.ownerId !== userId && !isPlatformAdmin) {
    const membership = await ctx.db
      .query("tenantUsers")
      .withIndex("by_tenant_and_user", (q) => q.eq("tenantId", tenantId).eq("userId", userId))
      .first();
    const manages = membership && ["owner", "admin"].includes(membership.role);
    if (!manages) throw new Error("Not authorized for this site");
  }
  return { site, user };
}

/** Load a site the signed-in caller is allowed to manage. */
async function loadSite(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenantSites">,
): Promise<{ site: Doc<"tenantSites">; user: Doc<"users"> }> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Unauthorized");
  return loadSiteFor(ctx, tenantId, userId);
}

function requireReason(reason: string, min = 8) {
  const trimmed = reason.trim();
  if (trimmed.length < min) throw new Error(`Give a reason of at least ${min} characters.`);
  if (trimmed.length > 400) throw new Error("Reason must be under 400 characters.");
  return trimmed;
}

/** The list screen: one row per site with the two counts the table shows. */
export const listSites = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const sites = await ctx.db
      .query("tenantSites")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .take(50);

    const planPrice = await effectivePointsCost(ctx, "tenant_renewal", DEFAULT_RENEWAL_POINTS);

    const rows = [];
    for (const site of sites) {
      if (site.lifecycleStatus === "deleted") continue;
      // Bounded reads: a single site is a small dataset, and the cap keeps a
      // pathological tenant from turning the list into a full-table scan.
      const members = await ctx.db
        .query("tenantUsers")
        .withIndex("by_tenant", (q) => q.eq("tenantId", site._id))
        .take(100);
      const ledger = await ctx.db
        .query("tenantLedger")
        .withIndex("by_tenant", (q) => q.eq("tenantId", site._id))
        .take(200);

      const ledgerUsers = new Set<string>(members.map((m) => m.userId));
      for (const entry of ledger) ledgerUsers.add(entry.userId);

      rows.push({
        _id: site._id,
        siteName: site.siteName,
        siteType: site.siteType,
        subdomain: site.subdomain,
        status: site.lifecycleStatus ?? (site.isActive ? "active" : "suspended"),
        isActive: site.isActive,
        renewalDate: site.renewalDate ?? null,
        ledgerUsers: ledgerUsers.size,
        members: members.length,
        monthlyPoints: site.monthlyPoints ?? planPrice,
      });
    }
    return rows;
  },
});

/** Overview tab: the four stat cards plus a merged recent-activity feed. */
export const getOverview = query({
  args: { tenantId: v.id("tenantSites") },
  handler: async (ctx, args) => {
    // Returns null for sites the caller cannot see, so a pasted URL shows a
    // friendly "no access" card instead of throwing through the router.
    let site: Doc<"tenantSites">;
    try {
      ({ site } = await loadSite(ctx, args.tenantId));
    } catch {
      return null;
    }

    const members = await ctx.db
      .query("tenantUsers")
      .withIndex("by_tenant", (q) => q.eq("tenantId", site._id))
      .take(200);
    const ledger = await ctx.db
      .query("tenantLedger")
      .withIndex("by_tenant", (q) => q.eq("tenantId", site._id))
      .order("desc")
      .take(500);
    const kyc = await ctx.db
      .query("kycRecords")
      .withIndex("by_tenant", (q) => q.eq("tenantId", site._id))
      .order("desc")
      .take(300);
    const planPrice = await effectivePointsCost(ctx, "tenant_renewal", DEFAULT_RENEWAL_POINTS);

    const approved = kyc.filter((k) => k.status === "approved").length;
    const pending = kyc.filter((k) =>
      ["submitted", "under_review"].includes(k.status),
    ).length;

    // ── Activity: newest 8 across money movement and KYC decisions ──
    type Activity = {
      id: string;
      kind: "ledger" | "kyc";
      title: string;
      detail: string;
      amount?: number;
      at: number;
    };
    const nameCache = new Map<string, string>();
    const nameOf = async (id: Id<"users">) => {
      const cached = nameCache.get(id);
      if (cached) return cached;
      const u = await ctx.db.get(id);
      const name = u?.name || u?.email || "Unknown user";
      nameCache.set(id, name);
      return name;
    };

    const activity: Activity[] = [];
    for (const entry of ledger.slice(0, 8)) {
      activity.push({
        id: `ledger-${entry._id}`,
        kind: "ledger",
        title: entry.description,
        detail: await nameOf(entry.userId),
        amount: entry.amount,
        at: entry.createdAt,
      });
    }
    for (const record of kyc.slice(0, 4)) {
      activity.push({
        id: `kyc-${record._id}`,
        kind: "kyc",
        title:
          record.status === "approved"
            ? "KYC approved"
            : record.status === "rejected"
              ? "KYC rejected"
              : "KYC submitted",
        detail: record.fullName,
        at: record.updatedAt ?? record.createdAt,
      });
    }
    activity.sort((a, b) => b.at - a.at);

    const volume = ledger.reduce((sum, entry) => sum + Math.abs(entry.amount), 0);

    return {
      site: {
        _id: site._id,
        siteName: site.siteName,
        displayName: site.displayName ?? site.siteName,
        siteType: site.siteType,
        subdomain: site.subdomain,
        currency: site.currency ?? "USD",
        status: site.lifecycleStatus ?? (site.isActive ? "active" : "suspended"),
        isActive: site.isActive,
        renewalDate: site.renewalDate ?? null,
        fontFamily: site.fontFamily ?? "Inter",
        branding: {
          logo: site.branding?.logo ?? null,
          primaryColor: site.branding?.primaryColor ?? "#0f4c3a",
          accentColor: site.branding?.accentColor ?? "#c8a24a",
          surfaceColor: site.branding?.surfaceColor ?? "#f7f5ef",
          themeMode: site.branding?.themeMode ?? "light",
          tagline: site.branding?.tagline ?? "Banking built around your community.",
          heroHeadline: site.branding?.heroHeadline ?? "Your money, your neighbourhood.",
        },
        monthlyPoints: site.monthlyPoints ?? planPrice,
        nextInvoiceAt: site.renewalDate ?? null,
        graceEndsAt: site.renewalDate ? site.renewalDate + GRACE_DAYS * DAY_MS : null,
        graceDays: GRACE_DAYS,
      },
      stats: {
        users: members.length,
        activeUsers: members.filter((m) => (m.status ?? "active") === "active").length,
        ledgerVolume: volume,
        ledgerCount: ledger.length,
        kycApprovedPct: kyc.length === 0 ? 0 : Math.round((approved / kyc.length) * 100),
        kycPending: pending,
        kycTotal: kyc.length,
        ledgerUsers: new Set(ledger.map((l) => l.userId)).size,
      },
      activity: activity.slice(0, 8),
    };
  },
});

/** End-users tab: members plus ledger-only customers, with KYC and balance. */
export const listEndUsers = query({
  args: { tenantId: v.id("tenantSites") },
  handler: async (ctx, args) => {
    const { site } = await loadSite(ctx, args.tenantId);

    const members = await ctx.db
      .query("tenantUsers")
      .withIndex("by_tenant", (q) => q.eq("tenantId", site._id))
      .take(100);
    const ledger = await ctx.db
      .query("tenantLedger")
      .withIndex("by_tenant", (q) => q.eq("tenantId", site._id))
      .take(300);
    const kyc = await ctx.db
      .query("kycRecords")
      .withIndex("by_tenant", (q) => q.eq("tenantId", site._id))
      .take(300);

    // Newest KYC record wins per user.
    const kycByUser = new Map<string, Doc<"kycRecords">>();
    for (const record of kyc) {
      const existing = kycByUser.get(record.userId);
      if (!existing || (record.updatedAt ?? record.createdAt) > (existing.updatedAt ?? existing.createdAt)) {
        kycByUser.set(record.userId, record);
      }
    }
    const balanceByUser = new Map<string, number>();
    for (const entry of ledger) {
      balanceByUser.set(entry.userId, (balanceByUser.get(entry.userId) ?? 0) + entry.amount);
    }

    const ids = new Set<string>(members.map((m) => m.userId));
    for (const entry of ledger) ids.add(entry.userId);

    const rows = [];
    for (const id of ids) {
      const user = await ctx.db.get(id as Id<"users">);
      if (!user) continue;
      const membership = members.find((m) => m.userId === id);
      const record = kycByUser.get(id);
      rows.push({
        userId: user._id,
        membershipId: membership?._id ?? null,
        name: user.name || user.email || "Unnamed customer",
        email: user.email ?? "—",
        role: membership?.role ?? "customer",
        status: membership?.status ?? "active",
        kycStatus: record?.status ?? "not_started",
        balance: balanceByUser.get(id) ?? 0,
        joinedAt: membership?.createdAt ?? user.createdAt ?? user._creationTime,
      });
    }
    rows.sort((a, b) => b.balance - a.balance);
    return rows;
  },
});

/** Ledger tab: newest money movement for this tenant. */
export const listLedger = query({
  args: { tenantId: v.id("tenantSites") },
  handler: async (ctx, args) => {
    const { site } = await loadSite(ctx, args.tenantId);
    const entries = await ctx.db
      .query("tenantLedger")
      .withIndex("by_tenant", (q) => q.eq("tenantId", site._id))
      .order("desc")
      .take(100);

    const names = new Map<string, string>();
    const rows = [];
    for (const entry of entries) {
      let name = names.get(entry.userId);
      if (!name) {
        const user = await ctx.db.get(entry.userId);
        name = user?.name || user?.email || "Unknown customer";
        names.set(entry.userId, name);
      }
      rows.push({
        _id: entry._id,
        amount: entry.amount,
        description: entry.description,
        type: entry.type,
        customer: name,
        createdAt: entry.createdAt,
      });
    }
    return rows;
  },
});

/** KYC tab: every identity record submitted to this tenant. */
export const listKyc = query({
  args: { tenantId: v.id("tenantSites") },
  handler: async (ctx, args) => {
    const { site } = await loadSite(ctx, args.tenantId);
    const records = await ctx.db
      .query("kycRecords")
      .withIndex("by_tenant", (q) => q.eq("tenantId", site._id))
      .order("desc")
      .take(100);
    return records.map((r) => ({
      _id: r._id,
      fullName: r.fullName,
      status: r.status,
      documentName: r.documentName ?? null,
      rejectionReason: r.rejectionReason ?? null,
      submittedAt: r.createdAt,
      reviewedAt: r.reviewedAt ?? null,
    }));
  },
});

/** Domains tab. */
export const listDomains = query({
  args: { tenantId: v.id("tenantSites") },
  handler: async (ctx, args) => {
    const { site } = await loadSite(ctx, args.tenantId);
    const domains = await ctx.db
      .query("tenantDomains")
      .withIndex("by_tenant", (q) => q.eq("tenantId", site._id))
      .order("desc")
      .take(20);
    return domains.map((d) => ({
      _id: d._id,
      domain: d.domain,
      status: d.status,
      verificationToken: d.verificationToken,
      lastCheckedAt: d.lastCheckedAt ?? null,
      lastError: d.lastError ?? null,
      verifiedAt: d.verifiedAt ?? null,
      attempts: d.attempts,
    }));
  },
});

// ─── Lifecycle ────────────────────────────────────────────────────────────────

export const lockdownSite = mutation({
  args: { tenantId: v.id("tenantSites"), reason: v.string() },
  handler: async (ctx, args) => {
    const { site, user } = await loadSite(ctx, args.tenantId);
    if (site.lifecycleStatus === "deleted") throw new Error("This site has been deleted.");
    const reason = requireReason(args.reason);
    const before = { isActive: site.isActive, lifecycleStatus: site.lifecycleStatus };
    await ctx.db.patch(site._id, { isActive: false, lifecycleStatus: "suspended" });
    await writeAudit(ctx, {
      actorId: user._id,
      actorEmail: user.email,
      action: "tenant.lockdown",
      resourceId: site._id,
      reason,
      before,
      after: { isActive: false, lifecycleStatus: "suspended" },
    });
    return { ok: true };
  },
});

export const reactivateSite = mutation({
  args: { tenantId: v.id("tenantSites"), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { site, user } = await loadSite(ctx, args.tenantId);
    if (site.lifecycleStatus === "deleted") throw new Error("This site has been deleted.");
    const before = { isActive: site.isActive, lifecycleStatus: site.lifecycleStatus };
    await ctx.db.patch(site._id, { isActive: true, lifecycleStatus: "active" });
    await writeAudit(ctx, {
      actorId: user._id,
      actorEmail: user.email,
      action: "tenant.reactivate",
      resourceId: site._id,
      reason: args.reason?.trim() || "Reactivated by owner",
      before,
      after: { isActive: true, lifecycleStatus: "active" },
    });
    return { ok: true };
  },
});

/** End-users tab action: suspend / reinstate a single customer. */
export const setUserStatus = mutation({
  args: {
    tenantId: v.id("tenantSites"),
    userId: v.id("users"),
    suspended: v.boolean(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { site, user } = await loadSite(ctx, args.tenantId);
    if (args.userId === site.ownerId) throw new Error("You cannot suspend the site owner.");
    const target = await ctx.db.get(args.userId);
    if (!target) throw new Error("Customer not found");

    const membership = await ctx.db
      .query("tenantUsers")
      .withIndex("by_tenant_and_user", (q) =>
        q.eq("tenantId", site._id).eq("userId", args.userId),
      )
      .first();

    const status = args.suspended ? "suspended" : "active";
    if (membership) {
      await ctx.db.patch(membership._id, { status });
    } else {
      // Ledger-only customer: materialise the membership so the state persists.
      await ctx.db.insert("tenantUsers", {
        tenantId: site._id,
        userId: args.userId,
        role: "customer",
        status,
        createdAt: Date.now(),
      });
    }
    await writeAudit(ctx, {
      actorId: user._id,
      actorEmail: user.email,
      action: args.suspended ? "tenant.user.suspend" : "tenant.user.reinstate",
      resourceId: site._id,
      reason: args.reason?.trim() || undefined,
      after: { userId: args.userId, status },
    });
    return { ok: true };
  },
});

// ─── Theme ───────────────────────────────────────────────────────────────────

export const updateTheme = mutation({
  args: {
    tenantId: v.id("tenantSites"),
    primaryColor: v.optional(v.string()),
    accentColor: v.optional(v.string()),
    surfaceColor: v.optional(v.string()),
    fontFamily: v.optional(v.string()),
    logo: v.optional(v.string()),
    themeMode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { site, user } = await loadSite(ctx, args.tenantId);

    for (const color of [args.primaryColor, args.accentColor, args.surfaceColor]) {
      if (color !== undefined && !HEX.test(color)) {
        throw new Error("Colors must be 6-digit hex values, e.g. #1F6F5C.");
      }
    }
    if (args.fontFamily !== undefined && !FONTS.includes(args.fontFamily)) {
      throw new Error("That font is not available.");
    }
    if (args.themeMode !== undefined && !["light", "dark"].includes(args.themeMode)) {
      throw new Error("Theme mode must be light or dark.");
    }
    if (args.logo !== undefined && args.logo.length > 500_000) {
      throw new Error("Logo is too large — use an image under 400 KB.");
    }

    const branding = {
      ...(site.branding ?? {}),
      ...(args.primaryColor ? { primaryColor: args.primaryColor } : {}),
      ...(args.accentColor ? { accentColor: args.accentColor } : {}),
      ...(args.surfaceColor ? { surfaceColor: args.surfaceColor } : {}),
      ...(args.themeMode ? { themeMode: args.themeMode } : {}),
      ...(args.logo !== undefined ? { logo: args.logo || undefined } : {}),
    };

    await ctx.db.patch(site._id, {
      branding,
      ...(args.fontFamily ? { fontFamily: args.fontFamily } : {}),
    });
    await writeAudit(ctx, {
      actorId: user._id,
      actorEmail: user.email,
      action: "tenant.theme.update",
      resourceId: site._id,
      after: { fontFamily: args.fontFamily, branding },
    });
    return { ok: true };
  },
});

// ─── Domains ─────────────────────────────────────────────────────────────────

export const addDomain = mutation({
  args: { tenantId: v.id("tenantSites"), domain: v.string() },
  handler: async (ctx, args) => {
    const { site, user } = await loadSite(ctx, args.tenantId);
    const domain = args.domain
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "");
    if (!DOMAIN.test(domain) || domain.includes("cloudie.app")) {
      throw new Error("Enter a domain like portal.yourbank.com.");
    }

    const existing = await ctx.db
      .query("tenantDomains")
      .withIndex("by_domain", (q) => q.eq("domain", domain))
      .first();
    if (existing) {
      throw new Error(
        existing.tenantId === site._id
          ? "That domain is already attached to this site."
          : "That domain is already attached to another site.",
      );
    }

    const token = `cloudie-verify-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
    const domainId = await ctx.db.insert("tenantDomains", {
      tenantId: site._id,
      domain,
      verificationToken: token,
      status: "pending",
      attempts: 0,
      createdAt: Date.now(),
    });
    await writeAudit(ctx, {
      actorId: user._id,
      actorEmail: user.email,
      action: "tenant.domain.add",
      resourceId: site._id,
      after: { domain },
    });
    return { domainId, domain, token };
  },
});

export const removeDomain = mutation({
  args: { tenantId: v.id("tenantSites"), domainId: v.id("tenantDomains") },
  handler: async (ctx, args) => {
    const { site, user } = await loadSite(ctx, args.tenantId);
    const row = await ctx.db.get(args.domainId);
    if (!row || row.tenantId !== site._id) throw new Error("Domain not found");
    await ctx.db.delete(row._id);
    await writeAudit(ctx, {
      actorId: user._id,
      actorEmail: user.email,
      action: "tenant.domain.remove",
      resourceId: site._id,
      before: { domain: row.domain },
    });
    return { ok: true };
  },
});

/** Read-side used by the DNS verification action (actions cannot touch the DB). */
export const getDomainForCheck = internalQuery({
  args: { domainId: v.id("tenantDomains"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.domainId);
    if (!row) throw new Error("Domain not found");
    await loadSiteFor(ctx, row.tenantId, args.userId);
    return { domain: row.domain, token: row.verificationToken, tenantId: row.tenantId };
  },
});

export const applyDomainCheck = internalMutation({
  args: {
    domainId: v.id("tenantDomains"),
    verified: v.boolean(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.domainId);
    if (!row) throw new Error("Domain not found");
    const now = Date.now();
    await ctx.db.patch(row._id, {
      status: args.verified ? "verified" : "failed",
      attempts: row.attempts + 1,
      lastCheckedAt: now,
      lastError: args.verified ? undefined : (args.error ?? "No matching TXT record found."),
      verifiedAt: args.verified ? now : row.verifiedAt,
    });
    return { verified: args.verified };
  },
});

// ─── Billing ─────────────────────────────────────────────────────────────────

/** Pay the next renewal now: debits the plan price and extends the term 30 days. */
export const payRenewalEarly = mutation({
  args: { tenantId: v.id("tenantSites") },
  handler: async (ctx, args) => {
    const { site, user } = await loadSite(ctx, args.tenantId);
    if (site.lifecycleStatus === "deleted") throw new Error("This site has been deleted.");

    const cost = site.monthlyPoints ?? (await effectivePointsCost(ctx, "tenant_renewal", DEFAULT_RENEWAL_POINTS));
    const balance = typeof user.pointsBalance === "number" ? user.pointsBalance : 0;
    if (balance < cost) {
      throw new Error(`INSUFFICIENT_POINTS: You need ${cost - balance} more point(s) to renew.`);
    }

    const balanceAfter = balance - cost;
    const now = Date.now();
    const from = Math.max(now, site.renewalDate ?? now);
    const renewalDate = from + 30 * DAY_MS;

    await ctx.db.patch(user._id, { pointsBalance: balanceAfter });
    await ctx.db.insert("pointLedger", {
      userId: user._id,
      amount: -cost,
      balanceAfter,
      description: `Tenant renewal — ${site.siteName}`,
      type: "service_charge",
      referenceId: site._id,
      createdAt: now,
    });
    await ctx.db.patch(site._id, { renewalDate, isActive: true, lifecycleStatus: "active" });
    await writeAudit(ctx, {
      actorId: user._id,
      actorEmail: user.email,
      action: "tenant.renewal.pay",
      resourceId: site._id,
      before: { renewalDate: site.renewalDate },
      after: { renewalDate, points: cost },
    });
    return { renewalDate, charged: cost, balanceAfter };
  },
});

// ─── Danger zone ─────────────────────────────────────────────────────────────

export const suspendSite = mutation({
  args: { tenantId: v.id("tenantSites"), reason: v.string() },
  handler: async (ctx, args) => {
    const { site, user } = await loadSite(ctx, args.tenantId);
    const reason = requireReason(args.reason);
    await ctx.db.patch(site._id, { isActive: false, lifecycleStatus: "suspended" });
    await writeAudit(ctx, {
      actorId: user._id,
      actorEmail: user.email,
      action: "tenant.suspend",
      resourceId: site._id,
      reason,
      after: { lifecycleStatus: "suspended" },
    });
    return { ok: true };
  },
});

export const transferOwnership = mutation({
  args: { tenantId: v.id("tenantSites"), email: v.string(), reason: v.string() },
  handler: async (ctx, args) => {
    const { site, user } = await loadSite(ctx, args.tenantId);
    if (site.ownerId !== user._id && user.role !== "admin") {
      throw new Error("Only the owner can transfer this site.");
    }
    const email = args.email.trim().toLowerCase();
    if (!email.includes("@")) throw new Error("Enter a valid email address.");
    const target = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();
    if (!target) throw new Error("No Cloudie account uses that email. Ask them to sign up first.");
    if (target._id === site.ownerId) throw new Error("That account already owns this site.");
    const reason = requireReason(args.reason);

    const previousOwner = await ctx.db.get(site.ownerId);
    await ctx.db.patch(site._id, { ownerId: target._id });
    const membership = await ctx.db
      .query("tenantUsers")
      .withIndex("by_tenant_and_user", (q) => q.eq("tenantId", site._id).eq("userId", target._id))
      .first();
    if (membership) {
      await ctx.db.patch(membership._id, { role: "owner", status: "active" });
    } else {
      await ctx.db.insert("tenantUsers", {
        tenantId: site._id,
        userId: target._id,
        role: "owner",
        status: "active",
        createdAt: Date.now(),
      });
    }
    await writeAudit(ctx, {
      actorId: user._id,
      actorEmail: user.email,
      action: "tenant.transfer",
      resourceId: site._id,
      reason,
      before: { ownerId: site.ownerId, ownerEmail: previousOwner?.email },
      after: { ownerId: target._id, ownerEmail: target.email },
    });
    return { ok: true };
  },
});

export const deleteSite = mutation({
  args: { tenantId: v.id("tenantSites"), confirmName: v.string(), reason: v.string() },
  handler: async (ctx, args) => {
    const { site, user } = await loadSite(ctx, args.tenantId);
    if (args.confirmName.trim() !== site.siteName) {
      throw new Error("The site name you typed does not match.");
    }
    const reason = requireReason(args.reason, 10);

    // Soft delete: ledger and KYC records must survive for audit and disputes.
    await ctx.db.patch(site._id, { isActive: false, lifecycleStatus: "deleted" });
    await writeAudit(ctx, {
      actorId: user._id,
      actorEmail: user.email,
      action: "tenant.delete",
      resourceId: site._id,
      reason,
      before: { siteName: site.siteName, lifecycleStatus: site.lifecycleStatus },
      after: { lifecycleStatus: "deleted" },
    });
    return { ok: true };
  },
});
