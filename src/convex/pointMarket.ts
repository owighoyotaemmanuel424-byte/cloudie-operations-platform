import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { debitWallet } from "./wallet";

/*
 * Points marketplace.
 *
 * A verified vendor lists point packages (cash price → points). When a buyer
 * checks out, cash leaves their wallet into platform escrow; points are only
 * credited once the vendor fulfils, and the vendor's payout is opened at the
 * same moment. Disputes freeze the escrow until an admin resolves it.
 *
 * Money is NGN wallet balance (minor units stored on packages/orders), points
 * are the platform's `users.pointsBalance` / `pointLedger` pair.
 */

const DAY_MS = 86_400_000;
/** Escrow is considered overdue (buyer may dispute) after this window. */
const OVERDUE_MS = DAY_MS;

async function requireUser(ctx: QueryCtx | MutationCtx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Unauthorized");
  return userId;
}

async function myVendor(ctx: QueryCtx | MutationCtx, userId: Id<"users">) {
  return await ctx.db
    .query("vendors")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
}

/** Vendor the caller owns and that is allowed to sell. */
async function requireApprovedVendor(ctx: QueryCtx | MutationCtx) {
  const userId = await requireUser(ctx);
  const vendor = await myVendor(ctx, userId);
  if (!vendor) throw new Error("Register as a vendor first.");
  if (vendor.status !== "approved") {
    throw new Error(`Your vendor account is ${vendor.status}.`);
  }
  return { userId, vendor };
}

function unitPriceMinor(priceMinor: number, points: number) {
  if (points <= 0) return 0;
  return Math.round((priceMinor / points) * 1000);
}

// ─── Browse ──────────────────────────────────────────────────────────────────

export const listPackages = query({
  args: {
    search: v.optional(v.string()),
    minPrice: v.optional(v.number()),
    maxPrice: v.optional(v.number()),
    minPoints: v.optional(v.number()),
    maxPoints: v.optional(v.number()),
    verifiedOnly: v.optional(v.boolean()),
    sort: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const packages = await ctx.db
      .query("pointPackages")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .take(200);

    const rows = [];
    for (const pkg of packages) {
      const vendor = await ctx.db.get(pkg.vendorId);
      if (!vendor || vendor.status !== "approved") continue;
      if (args.verifiedOnly && vendor.status !== "approved") continue;
      if (args.search && !`${pkg.name} ${vendor.businessName}`.toLowerCase().includes(args.search.toLowerCase())) {
        continue;
      }
      if (args.minPrice !== undefined && pkg.priceMinor < args.minPrice * 100) continue;
      if (args.maxPrice !== undefined && pkg.priceMinor > args.maxPrice * 100) continue;
      if (args.minPoints !== undefined && pkg.points < args.minPoints) continue;
      if (args.maxPoints !== undefined && pkg.points > args.maxPoints) continue;

      rows.push({
        _id: pkg._id,
        name: pkg.name,
        points: pkg.points,
        priceMinor: pkg.priceMinor,
        currency: pkg.currency,
        unitPriceMinor: unitPriceMinor(pkg.priceMinor, pkg.points),
        totalSold: pkg.totalSold,
        vendorId: vendor._id,
        vendorName: vendor.businessName,
        vendorVerified: vendor.status === "approved",
      });
    }

    switch (args.sort) {
      case "price_asc":
        rows.sort((a, b) => a.priceMinor - b.priceMinor);
        break;
      case "price_desc":
        rows.sort((a, b) => b.priceMinor - a.priceMinor);
        break;
      case "points_desc":
        rows.sort((a, b) => b.points - a.points);
        break;
      case "unit_asc":
        rows.sort((a, b) => a.unitPriceMinor - b.unitPriceMinor);
        break;
      default:
        // "Recommended": better unit price first, more sales break ties.
        rows.sort((a, b) => a.unitPriceMinor - b.unitPriceMinor || b.totalSold - a.totalSold);
    }
    return rows;
  },
});

// ─── Orders ──────────────────────────────────────────────────────────────────

export const createOrder = mutation({
  args: { packageId: v.id("pointPackages") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const pkg = await ctx.db.get(args.packageId);
    if (!pkg || !pkg.isActive) throw new Error("That package is no longer available.");
    const vendor = await ctx.db.get(pkg.vendorId);
    if (!vendor || vendor.status !== "approved") throw new Error("This vendor cannot take orders.");
    if (pkg.currency !== "NGN") throw new Error("Only NGN packages can be bought with wallet balance.");

    const amountNgn = pkg.priceMinor / 100;
    const now = Date.now();
    const orderId = await ctx.db.insert("pointOrders", {
      buyerId: userId,
      packageId: pkg._id,
      vendorId: pkg.vendorId,
      points: pkg.points,
      priceMinor: pkg.priceMinor,
      currency: pkg.currency,
      status: "escrow",
      createdAt: now,
      paidAt: now,
      escrowAt: now,
    });

    // Wallet debit happens after the order row exists, so a failed payment
    // leaves a cancelled audit trail instead of a phantom charge.
    try {
      await debitWallet(ctx, {
        userId,
        amountNgn,
        description: `Escrow — ${pkg.points.toLocaleString()} pts from ${vendor.businessName}`,
        type: "marketplace_purchase",
        referenceId: orderId,
        idempotencyKey: `point-order-${orderId}`,
        metadata: { orderId, packageId: pkg._id, points: pkg.points },
      } as never);
    } catch (error) {
      await ctx.db.patch(orderId, { status: "cancelled" });
      throw error;
    }

    await ctx.db.insert("notifications", {
      userId: vendor.userId,
      title: "New points order in escrow",
      message: `${pkg.points.toLocaleString()} pts sold for ₦${amountNgn.toLocaleString()}. Fulfil to release your payout.`,
      type: "marketplace.order",
      isRead: false,
      link: `/app/vendor`,
      createdAt: now,
    } as never);

    return { orderId };
  },
});

export const getMyOrder = query({
  args: { orderId: v.id("pointOrders") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const order = await ctx.db.get(args.orderId);
    if (!order) return null;

    const user = await ctx.db.get(userId);
    const isAdmin = user?.role === "admin";
    const buyer = await ctx.db.get(order.buyerId);
    const vendor = await ctx.db.get(order.vendorId);
    const vendorOwner = vendor ? vendor.userId === userId : false;
    if (order.buyerId !== userId && !vendorOwner && !isAdmin) return null;

    const pkg = await ctx.db.get(order.packageId);
    return {
      _id: order._id,
      status: order.status,
      points: order.points,
      priceMinor: order.priceMinor,
      currency: order.currency,
      createdAt: order.createdAt,
      paidAt: order.paidAt ?? null,
      escrowAt: order.escrowAt ?? null,
      fulfilledAt: order.fulfilledAt ?? null,
      creditedAt: order.creditedAt ?? null,
      disputedAt: order.disputedAt ?? null,
      disputeReason: order.disputeReason ?? null,
      buyerEmail: buyer?.email ?? null,
      buyerName: buyer?.name ?? null,
      viewer: order.buyerId === userId ? "buyer" : vendorOwner ? "vendor" : "admin",
      packageName: pkg?.name ?? "Point package",
      vendorName: vendor?.businessName ?? "Vendor",
      vendorVerified: vendor?.status === "approved",
      overdue: order.status === "escrow" && Date.now() - (order.paidAt ?? order.createdAt) > OVERDUE_MS,
    };
  },
});

/** Buyer: raise a dispute inside the allowed window. */
export const raiseDispute = mutation({
  args: { orderId: v.id("pointOrders"), reason: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found");
    if (order.buyerId !== userId) throw new Error("Only the buyer can dispute this order.");
    if (!["escrow", "fulfilled"].includes(order.status)) {
      throw new Error("This order can no longer be disputed.");
    }
    const reason = args.reason.trim();
    if (reason.length < 10) throw new Error("Describe the problem in at least 10 characters.");

    const overdue = Date.now() - (order.paidAt ?? order.createdAt) > OVERDUE_MS;
    if (order.status === "fulfilled" && !overdue) {
      throw new Error("This order was already fulfilled.");
    }

    await ctx.db.patch(order._id, {
      status: "disputed",
      disputedAt: Date.now(),
      disputeReason: reason,
    });
    await ctx.db.insert("auditLogs", {
      actorId: userId,
      action: "point_order.dispute",
      resource: "pointOrder",
      resourceId: order._id,
      reason,
      createdAt: Date.now(),
    });
    return { ok: true };
  },
});

/** Vendor releases escrow: points credited to the buyer, payout opened. */
export const fulfillOrder = mutation({
  args: { orderId: v.id("pointOrders") },
  handler: async (ctx, args) => {
    const { userId, vendor } = await requireApprovedVendor(ctx);
    const order = await ctx.db.get(args.orderId);
    if (!order || order.vendorId !== vendor._id) throw new Error("Order not found");
    if (order.status !== "escrow") throw new Error(`This order is ${order.status}.`);

    const buyer = await ctx.db.get(order.buyerId);
    if (!buyer) throw new Error("Buyer account not found");
    const now = Date.now();

    const balance = typeof buyer.pointsBalance === "number" ? buyer.pointsBalance : 0;
    const newBalance = balance + order.points;
    await ctx.db.patch(buyer._id, { pointsBalance: newBalance });
    await ctx.db.insert("pointLedger", {
      userId: buyer._id,
      amount: order.points,
      balanceAfter: newBalance,
      description: `Points purchased from ${vendor.businessName}`,
      type: "purchase",
      referenceId: order._id,
      createdAt: now,
    });

    await ctx.db.patch(order._id, {
      status: "credited",
      fulfilledAt: now,
      creditedAt: now,
      fulfilledBy: userId,
    });

    await ctx.db.insert("vendorPayouts", {
      vendorId: vendor._id,
      orderId: order._id,
      amountMinor: order.priceMinor,
      currency: order.currency,
      status: "pending",
      reference: `PO-${order._id.slice(-8).toUpperCase()}`,
      createdAt: now,
    });
    await ctx.db.patch(vendor._id, {
      earnings: vendor.earnings + order.priceMinor / 100,
      totalSales: vendor.totalSales + order.points,
    });

    return { ok: true };
  },
});

// ─── Vendor onboarding ───────────────────────────────────────────────────────

export const applyAsVendor = mutation({
  args: {
    businessName: v.string(),
    description: v.optional(v.string()),
    contactName: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    contactPhone: v.optional(v.string()),
    website: v.optional(v.string()),
    category: v.optional(v.string()),
    payoutMethod: v.optional(v.string()),
    payoutDetails: v.optional(v.string()),
    documentNames: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const businessName = args.businessName.trim();
    if (businessName.length < 2) throw new Error("Enter your business name.");
    if (!args.contactEmail?.includes("@")) throw new Error("Enter a contact email.");
    if (!args.payoutMethod) throw new Error("Choose a payout method.");
    if (!args.payoutDetails?.trim()) throw new Error("Add your payout account details.");

    const existing = await myVendor(ctx, userId);
    const now = Date.now();
    const payload = {
      businessName,
      description: args.description,
      contactName: args.contactName,
      contactEmail: args.contactEmail,
      contactPhone: args.contactPhone,
      website: args.website,
      category: args.category,
      payoutMethod: args.payoutMethod,
      payoutDetails: args.payoutDetails,
      documentNames: args.documentNames ?? [],
      status: "pending" as const,
      statusReason: undefined,
    };

    if (existing) {
      // Approved or suspended vendors cannot re-apply; rejected ones can.
      if (existing.status === "approved") throw new Error("Your vendor account is already approved.");
      if (existing.status === "suspended") throw new Error("Your vendor account is suspended. Contact support.");
      await ctx.db.patch(existing._id, payload);
      await ctx.db.insert("auditLogs", {
        actorId: userId,
        action: "vendor.reapply",
        resource: "vendor",
        resourceId: existing._id,
        createdAt: now,
      });
      return { id: existing._id, reapplied: true };
    }

    const id = await ctx.db.insert("vendors", {
      userId,
      ...payload,
      earnings: 0,
      totalSales: 0,
      createdAt: now,
    });
    await ctx.db.insert("auditLogs", {
      actorId: userId,
      action: "vendor.apply",
      resource: "vendor",
      resourceId: id,
      after: { businessName },
      createdAt: now,
    });
    return { id, reapplied: false };
  },
});

// ─── Vendor dashboard ────────────────────────────────────────────────────────

export const vendorOverview = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const vendor = await myVendor(ctx, userId);
    if (!vendor) return null;

    const listings = await ctx.db
      .query("pointPackages")
      .withIndex("by_vendor", (q) => q.eq("vendorId", vendor._id))
      .order("desc")
      .take(100);
    const orders = await ctx.db
      .query("pointOrders")
      .withIndex("by_vendor", (q) => q.eq("vendorId", vendor._id))
      .order("desc")
      .take(100);
    const payouts = await ctx.db
      .query("vendorPayouts")
      .withIndex("by_vendor", (q) => q.eq("vendorId", vendor._id))
      .order("desc")
      .take(50);

    const escrow = orders
      .filter((o) => ["escrow", "fulfilled", "disputed"].includes(o.status))
      .reduce((sum, o) => sum + o.priceMinor, 0);
    const pendingPayouts = payouts
      .filter((p) => p.status === "pending")
      .reduce((sum, p) => sum + p.amountMinor, 0);

    return {
      vendor: {
        _id: vendor._id,
        businessName: vendor.businessName,
        status: vendor.status,
        statusReason: vendor.statusReason ?? null,
        payoutMethod: vendor.payoutMethod ?? null,
        earnings: vendor.earnings,
        totalSales: vendor.totalSales,
        createdAt: vendor.createdAt,
      },
      listings: listings.map((l) => ({
        _id: l._id,
        name: l.name,
        points: l.points,
        priceMinor: l.priceMinor,
        currency: l.currency,
        isActive: l.isActive,
        totalSold: l.totalSold,
        createdAt: l.createdAt,
      })),
      orders: orders.slice(0, 20).map((o) => ({
        _id: o._id,
        points: o.points,
        priceMinor: o.priceMinor,
        currency: o.currency,
        status: o.status,
        createdAt: o.createdAt,
      })),
      payouts: payouts.map((p) => ({
        _id: p._id,
        amountMinor: p.amountMinor,
        currency: p.currency,
        status: p.status,
        reference: p.reference,
        createdAt: p.createdAt,
        paidAt: p.paidAt ?? null,
      })),
      stats: {
        activeListings: listings.filter((l) => l.isActive).length,
        listings: listings.length,
        orders: orders.length,
        escrowMinor: escrow,
        pendingPayoutsMinor: pendingPayouts,
        paidPayoutsMinor: payouts.filter((p) => p.status === "paid").reduce((s, p) => s + p.amountMinor, 0),
      },
    };
  },
});

export const createPackage = mutation({
  args: {
    name: v.string(),
    points: v.number(),
    priceNgn: v.number(),
  },
  handler: async (ctx, args) => {
    const { vendor } = await requireApprovedVendor(ctx);
    const name = args.name.trim();
    if (name.length < 3) throw new Error("Give the package a name.");
    if (!Number.isFinite(args.points) || args.points < 100) throw new Error("Minimum package is 100 points.");
    if (!Number.isFinite(args.priceNgn) || args.priceNgn < 100) throw new Error("Minimum price is ₦100.");

    const id = await ctx.db.insert("pointPackages", {
      vendorId: vendor._id,
      name,
      points: Math.round(args.points),
      priceMinor: Math.round(args.priceNgn * 100),
      currency: "NGN",
      isActive: true,
      totalSold: 0,
      createdAt: Date.now(),
    });
    return { id };
  },
});

export const updatePackage = mutation({
  args: {
    packageId: v.id("pointPackages"),
    name: v.optional(v.string()),
    points: v.optional(v.number()),
    priceNgn: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { vendor } = await requireApprovedVendor(ctx);
    const pkg = await ctx.db.get(args.packageId);
    if (!pkg || pkg.vendorId !== vendor._id) throw new Error("Listing not found");
    const patch: Partial<Doc<"pointPackages">> = {};
    if (args.name !== undefined) {
      if (args.name.trim().length < 3) throw new Error("Give the package a name.");
      patch.name = args.name.trim();
    }
    if (args.points !== undefined) {
      if (args.points < 100) throw new Error("Minimum package is 100 points.");
      patch.points = Math.round(args.points);
    }
    if (args.priceNgn !== undefined) {
      if (args.priceNgn < 100) throw new Error("Minimum price is ₦100.");
      patch.priceMinor = Math.round(args.priceNgn * 100);
    }
    await ctx.db.patch(pkg._id, patch);
    return { ok: true };
  },
});

export const setPackageActive = mutation({
  args: { packageId: v.id("pointPackages"), isActive: v.boolean() },
  handler: async (ctx, args) => {
    const { vendor } = await requireApprovedVendor(ctx);
    const pkg = await ctx.db.get(args.packageId);
    if (!pkg || pkg.vendorId !== vendor._id) throw new Error("Listing not found");
    await ctx.db.patch(pkg._id, { isActive: args.isActive });
    return { ok: true };
  },
});

export const deletePackage = mutation({
  args: { packageId: v.id("pointPackages") },
  handler: async (ctx, args) => {
    const { vendor } = await requireApprovedVendor(ctx);
    const pkg = await ctx.db.get(args.packageId);
    if (!pkg || pkg.vendorId !== vendor._id) throw new Error("Listing not found");
    const orders = await ctx.db
      .query("pointOrders")
      .withIndex("by_vendor", (q) => q.eq("vendorId", vendor._id))
      .take(100);
    if (orders.some((o) => o.packageId === pkg._id)) {
      // History references this listing; retire it instead of breaking the trail.
      await ctx.db.patch(pkg._id, { isActive: false });
      return { retired: true };
    }
    await ctx.db.delete(pkg._id);
    return { retired: false };
  },
});
