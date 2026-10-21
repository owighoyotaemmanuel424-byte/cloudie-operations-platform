import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";

/*
 * White-label tenant portal (`/t/:subdomain`).
 *
 * This is the customer-facing layer of a tenant site. It is intentionally
 * separate from `bankingCustomer.ts`: that module powers the older
 * `/site/:siteId/*` portal and hard-requires `siteType === "bank"`, while a
 * tenant site can also be an investment or business workspace.
 *
 * Every handler re-resolves the site by subdomain and checks membership against
 * that site's own id — the client never supplies a tenantId to read another
 * tenant's data.
 */

const ACTIVE = "active";

async function siteBySubdomain(ctx: QueryCtx | MutationCtx, subdomain: string) {
  const sub = subdomain.trim().toLowerCase();
  if (!sub) return null;
  return await ctx.db
    .query("tenantSites")
    .withIndex("by_subdomain", (q) => q.eq("subdomain", sub))
    .first();
}

function lifecycleOf(site: Doc<"tenantSites">) {
  return site.lifecycleStatus ?? (site.isActive ? ACTIVE : "disabled");
}

function isOpen(site: Doc<"tenantSites">) {
  return site.isActive && lifecycleOf(site) === ACTIVE;
}

async function membershipFor(
  ctx: QueryCtx | MutationCtx,
  site: Doc<"tenantSites">,
  userId: Id<"users">,
) {
  if (site.ownerId === userId) {
    return { isMember: true, isOwner: true, role: "owner", status: "active" };
  }
  const row = await ctx.db
    .query("tenantUsers")
    .withIndex("by_tenant_and_user", (q) => q.eq("tenantId", site._id).eq("userId", userId))
    .first();
  if (!row) return { isMember: false, isOwner: false, role: null, status: null };
  return {
    isMember: true,
    isOwner: false,
    role: row.role,
    status: row.status ?? "active",
  };
}

function balanceMinorOf(account: Doc<"tenantAccounts">) {
  const minor = (account as { balanceMinor?: number }).balanceMinor;
  if (typeof minor === "number") return minor;
  return Math.round((account.balance ?? 0) * 100);
}

/**
 * Everything the portal needs for one signed-in customer: profile, membership,
 * accounts, recent ledger and latest KYC record. Signed-out visitors get a
 * minimal tenant payload so the login screen can still be branded.
 */
export const myPortal = query({
  args: { subdomain: v.string() },
  handler: async (ctx, args) => {
    const site = await siteBySubdomain(ctx, args.subdomain);
    if (!site) return null;

    const tenant = {
      _id: site._id,
      siteName: site.siteName,
      displayName: site.displayName ?? site.siteName,
      siteType: site.siteType,
      subdomain: site.subdomain,
      currency: site.currency ?? "USD",
      lifecycleStatus: lifecycleOf(site),
      isAvailable: isOpen(site),
      branding: site.branding ?? null,
      fontFamily: site.fontFamily ?? null,
      supportEmail: site.supportEmail ?? null,
    };

    const userId = await getAuthUserId(ctx);
    if (!userId) return { tenant, viewer: null, membership: null, accounts: [], ledger: [], kyc: null };

    const membership = await membershipFor(ctx, site, userId);
    const user = await ctx.db.get(userId);
    if (!user) return { tenant, viewer: null, membership: null, accounts: [], ledger: [], kyc: null };

    const viewer = {
      userId: user._id,
      name: user.name ?? "",
      email: user.email ?? "",
      createdAt: user.createdAt ?? user._creationTime,
    };
    if (!membership.isMember) {
      return { tenant, viewer, membership, accounts: [], ledger: [], kyc: null };
    }

    const accounts = await ctx.db
      .query("tenantAccounts")
      .withIndex("by_tenant_and_user", (q) => q.eq("tenantId", site._id).eq("userId", userId))
      .take(20);

    // Bounded read, then filter to this customer. The tenant ledger is per-site
    // and small; capping protects the page from a runaway tenant.
    const ledgerRows = await ctx.db
      .query("tenantLedger")
      .withIndex("by_tenant", (q) => q.eq("tenantId", site._id))
      .order("desc")
      .take(300);
    const ledger = ledgerRows.filter((row) => row.userId === userId).slice(0, 40);

    const kycRows = await ctx.db
      .query("kycRecords")
      .withIndex("by_tenant", (q) => q.eq("tenantId", site._id))
      .order("desc")
      .take(200);
    const mine = kycRows.filter((row) => row.userId === userId);
    const kyc = mine[0] ?? null;

    return {
      tenant,
      viewer,
      membership,
      accounts: accounts.map((account) => ({
        _id: account._id,
        name: account.name,
        accountType: account.accountType,
        accountNumber: account.accountNumber,
        currency: (account as { currency?: string }).currency ?? tenant.currency,
        isActive: account.isActive,
        balanceMinor: balanceMinorOf(account),
        createdAt: account.createdAt,
      })),
      ledger: ledger.map((row) => ({
        _id: row._id,
        amount: row.amount,
        description: row.description,
        type: row.type,
        createdAt: row.createdAt,
      })),
      kyc: kyc
        ? {
            _id: kyc._id,
            status: kyc.status,
            fullName: kyc.fullName,
            documentName: kyc.documentName ?? null,
            rejectionReason: kyc.rejectionReason ?? null,
            livenessPassed: kyc.livenessPassed ?? false,
            submittedAt: kyc.createdAt,
            updatedAt: kyc.updatedAt,
          }
        : null,
    };
  },
});

/**
 * Self-enrolment: a signed-in Cloudie account joins this tenant's customer list.
 * Joining is idempotent and blocked while the site is suspended.
 */
export const joinPortal = mutation({
  args: { tenantId: v.id("tenantSites") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in first.");
    const site = await ctx.db.get(args.tenantId);
    if (!site) throw new Error("Site not found");
    if (!isOpen(site)) throw new Error("This site is temporarily unavailable.");

    const membership = await membershipFor(ctx, site, userId);
    if (membership.isMember) return { joined: true };

    await ctx.db.insert("tenantUsers", {
      tenantId: site._id,
      userId,
      role: "customer",
      status: "active",
      createdAt: Date.now(),
    });
    const user = await ctx.db.get(userId);
    await ctx.db.insert("auditLogs", {
      actorId: userId,
      actorEmail: user?.email,
      action: "tenant.portal.join",
      resource: "tenantSite",
      resourceId: site._id,
      createdAt: Date.now(),
    });
    return { joined: true };
  },
});

/** Profile tab: display name only — email is the sign-in identity. */
export const updateProfile = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Unauthorized");
    const name = args.name.trim();
    if (name.length < 2) throw new Error("Enter your full name.");
    if (name.length > 80) throw new Error("Name must be under 80 characters.");
    await ctx.db.patch(userId, { name });
    return { ok: true };
  },
});

/**
 * KYC step 3: file the identity record after the document + liveness steps.
 * Replaces an existing rejected record so "Retry" does not pile up duplicates.
 */
export const submitKyc = mutation({
  args: {
    tenantId: v.id("tenantSites"),
    fullName: v.string(),
    dateOfBirth: v.optional(v.string()),
    documentName: v.string(),
    livenessPassed: v.boolean(),
    storageFileId: v.optional(v.id("storageFiles")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Unauthorized");
    const site = await ctx.db.get(args.tenantId);
    if (!site) throw new Error("Site not found");
    if (!isOpen(site)) throw new Error("This site is temporarily unavailable.");

    const membership = await membershipFor(ctx, site, userId);
    if (!membership.isMember) throw new Error("You are not a customer of this site.");
    if (membership.status === "suspended") throw new Error("This customer account is suspended.");

    const fullName = args.fullName.trim();
    if (fullName.length < 3) throw new Error("Enter your full legal name.");
    if (!args.documentName.trim()) throw new Error("Upload an identity document first.");
    if (!args.livenessPassed) throw new Error("Complete the liveness check first.");

    const now = Date.now();
    const existing = await ctx.db
      .query("kycRecords")
      .withIndex("by_tenant", (q) => q.eq("tenantId", site._id))
      .order("desc")
      .take(100);
    const mine = existing.filter((row) => row.userId === userId);
    const open = mine.find((row) => ["submitted", "under_review", "approved"].includes(row.status));
    if (open) {
      throw new Error(`You already have a ${open.status.replace(/_/g, " ")} application.`);
    }

    const previous = mine[0];
    const id = await ctx.db.insert("kycRecords", {
      tenantId: site._id,
      userId,
      status: "submitted",
      fullName,
      dateOfBirth: args.dateOfBirth,
      documentName: args.documentName.trim(),
      storageFileId: args.storageFileId,
      livenessPassed: true,
      resubmissionCount: previous ? (previous.resubmissionCount ?? 0) + 1 : 0,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("auditLogs", {
      actorId: userId,
      action: "tenant.kyc.submit",
      resource: "tenantSite",
      resourceId: site._id,
      after: { kycRecordId: id, documentName: args.documentName, livenessPassed: true },
      createdAt: now,
    });
    return { id };
  },
});
