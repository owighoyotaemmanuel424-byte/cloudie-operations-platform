// Internal helpers for `demoSeed.ts`. They live outside the action's "use node"
// file because queries and mutations cannot share a file with a Node action.
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

const DAY = 86_400_000;

/** Existing password account for an email, so re-runs never duplicate users. */
export const findAccountByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const account = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) =>
        q.eq("provider", "password").eq("providerAccountId", args.email),
      )
      .first();
    return account ? { accountId: account._id, userId: account.userId } : null;
  },
});

type DemoStatus = "IN_TRANSIT" | "DELIVERED" | "CUSTOMS_CLEARANCE" | "OUT_FOR_DELIVERY";

type DemoShipment = {
  trackingNumber: string;
  status: DemoStatus;
  progress: number;
  serviceTypeName: string;
  packageDescription: string;
  totalWeight: number;
  daysAgo: number;
  recipient: {
    name: string;
    phone: string;
    email: string;
    address: string;
    city: string;
    state: string;
    country: string;
    postalCode: string;
  };
};

/**
 * Sample consignments. Amounts, names and addresses are obviously fictional —
 * a demo dataset that looks like a real customer's records would be a trap the
 * first time someone demonstrated the product.
 */
const DEMO_SHIPMENTS: DemoShipment[] = [
  {
    trackingNumber: "CLD-DEMO-1001",
    status: "IN_TRANSIT",
    progress: 55,
    serviceTypeName: "Express Air",
    packageDescription: "Sample carton — 2x document folders",
    totalWeight: 4.5,
    daysAgo: 3,
    recipient: {
      name: "Adaeze Okafor (Demo)",
      phone: "+234 800 000 0001",
      email: "adaeze.demo@example.com",
      address: "12 Demo Close",
      city: "Lagos",
      state: "Lagos",
      country: "Nigeria",
      postalCode: "101001",
    },
  },
  {
    trackingNumber: "CLD-DEMO-1002",
    status: "DELIVERED",
    progress: 100,
    serviceTypeName: "Standard Ground",
    packageDescription: "Sample parcel — printed manuals",
    totalWeight: 2.1,
    daysAgo: 12,
    recipient: {
      name: "Priya Raman (Demo)",
      phone: "+44 7000 000002",
      email: "priya.demo@example.com",
      address: "48 Sample Street",
      city: "Manchester",
      state: "Greater Manchester",
      country: "United Kingdom",
      postalCode: "M1 1AA",
    },
  },
  {
    trackingNumber: "CLD-DEMO-1003",
    status: "CUSTOMS_CLEARANCE",
    progress: 40,
    serviceTypeName: "Freight Consolidation",
    packageDescription: "Sample pallet — marketing collateral",
    totalWeight: 18,
    daysAgo: 1,
    recipient: {
      name: "Lucas Meyer (Demo)",
      phone: "+1 415 000 0003",
      email: "lucas.demo@example.com",
      address: "900 Demo Avenue",
      city: "San Francisco",
      state: "California",
      country: "United States",
      postalCode: "94110",
    },
  },
];

/** Shared sender block — the demo account's own details. */
const SENDER = {
  senderName: "Demo Customer",
  senderPhone: "+234 800 000 0000",
  senderEmail: "demo@cloudie.app",
  senderAddress: "1 Demo Plaza",
  senderCity: "Abuja",
  senderState: "FCT",
  senderCountry: "Nigeria",
  senderPostalCode: "900001",
};

/**
 * Fills the demo account with records the dashboard actually reads.
 *
 * Idempotent by marker: if the account already has wallet history the seed is
 * treated as done, so running the command twice never doubles a balance.
 */
export const seedDemoData = internalMutation({
  args: { userId: v.id("users"), email: v.string() },
  handler: async (ctx, args) => {
    const userId = args.userId;
    const now = Date.now();

    const existingLedger = await ctx.db
      .query("walletLedger")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    if (existingLedger) {
      return { seeded: false as const, reason: "already_seeded" as const };
    }

    const user = await ctx.db.get(userId);
    if (!user) throw new Error("USER_NOT_FOUND");

    // ── Wallet: one funded deposit, then a service charge, so the ledger reads
    // as history rather than a single synthetic number. The final balance in
    // `walletBalanceNgn` always equals the last `balanceAfterNgn`.
    const openingBalance = 250_000;
    const serviceCharge = 7_500;
    const closingBalance = openingBalance - serviceCharge;

    await ctx.db.insert("walletLedger", {
      userId,
      amountNgn: openingBalance,
      balanceAfterNgn: openingBalance,
      description: "Demo opening balance",
      type: "deposit",
      reference: "DEMO-OPENING",
      createdAt: now - 14 * DAY,
    });
    await ctx.db.insert("walletLedger", {
      userId,
      amountNgn: -serviceCharge,
      balanceAfterNgn: closingBalance,
      description: "Document rendering — 3 pages",
      type: "service_charge",
      reference: "DEMO-DOC-001",
      createdAt: now - 2 * DAY,
    });

    // ── Points: the older credit balance the workspace still shows alongside
    // the wallet. Same discipline — every row carries its running balance.
    await ctx.db.insert("pointLedger", {
      userId,
      amount: 2_500,
      balanceAfter: 2_500,
      description: "Demo service credits",
      type: "deposit",
      reference: "DEMO-POINTS-OPENING",
      createdAt: now - 14 * DAY,
    });
    await ctx.db.insert("pointLedger", {
      userId,
      amount: -100,
      balanceAfter: 2_400,
      description: "Shipment created · CLD-DEMO-1001",
      type: "shipment_creation",
      reference: "CLD-DEMO-1001",
      createdAt: now - 3 * DAY,
    });

    await ctx.db.patch(userId, {
      walletBalanceNgn: closingBalance,
      pointsBalance: 2_400,
      organizationName: "Northwind Freight (Demo)",
      ...(user.referralCode === undefined
        ? { referralCode: "DEMO-CLOUDIE" }
        : {}),
      ...(user.createdAt === undefined ? { createdAt: now - 14 * DAY } : {}),
      lastActiveAt: now,
    });

    // ── Shipments + a public timeline each, so tracking has something to show.
    const shipmentIds: Id<"trackingShipments">[] = [];
    for (const shipment of DEMO_SHIPMENTS) {
      const created = now - shipment.daysAgo * DAY;
      const shipmentId = await ctx.db.insert("trackingShipments", {
        trackingNumber: shipment.trackingNumber,
        status: shipment.status,
        progress: shipment.progress,
        serviceTypeName: shipment.serviceTypeName,
        senderId: userId,
        ...SENDER,
        senderEmail: args.email,
        recipientName: shipment.recipient.name,
        recipientPhone: shipment.recipient.phone,
        recipientEmail: shipment.recipient.email,
        recipientAddress: shipment.recipient.address,
        recipientCity: shipment.recipient.city,
        recipientState: shipment.recipient.state,
        recipientCountry: shipment.recipient.country,
        recipientPostalCode: shipment.recipient.postalCode,
        packageDescription: shipment.packageDescription,
        totalWeight: shipment.totalWeight,
        weightUnit: "kg" as const,
        currency: "NGN",
        createdAt: created,
        updatedAt: created + DAY,
        shippedAt: created + DAY / 2,
        ...(shipment.status === "DELIVERED"
          ? { deliveredAt: created + 2 * DAY, actualDelivery: created + 2 * DAY }
          : { estimatedDelivery: now + 3 * DAY }),
      });
      shipmentIds.push(shipmentId);

      await ctx.db.insert("trackingEvents", {
        shipmentId,
        status: "CREATED",
        title: "Shipment record created",
        description: "Consignment registered in the demo workspace.",
        locationLabel: "Abuja, Nigeria",
        eventTimestamp: created,
        isPublic: true,
        createdBy: userId,
        createdAt: created,
      });
      await ctx.db.insert("trackingEvents", {
        shipmentId,
        status: shipment.status,
        title:
          shipment.status === "DELIVERED"
            ? "Delivered"
            : shipment.status === "CUSTOMS_CLEARANCE"
              ? "Held for customs clearance"
              : "In transit",
        description: "Status recorded for the demo shipment.",
        locationLabel: `${shipment.recipient.city}, ${shipment.recipient.country}`,
        eventTimestamp: created + DAY,
        isPublic: true,
        createdBy: userId,
        createdAt: created + DAY,
      });
    }

    // ── Notifications: two unread so the bell badge has a real count.
    await ctx.db.insert("notifications", {
      userId,
      title: "Demo workspace ready",
      message: "Your sample shipments, balance and ledger have been created.",
      type: "system",
      isRead: false,
      link: "/dashboard",
      createdAt: now - 3_600_000,
    });
    await ctx.db.insert("notifications", {
      userId,
      title: "Shipment CLD-DEMO-1003 needs clearance",
      message: "This sample consignment is held for customs clearance.",
      type: "shipment",
      isRead: false,
      link: "/shipments",
      createdAt: now - 2 * 3_600_000,
    });
    await ctx.db.insert("notifications", {
      userId,
      title: "Document rendering complete",
      message: "Invoice sample rendered — 7,500 NGN charged to your demo wallet.",
      type: "document",
      isRead: true,
      link: "/documents",
      createdAt: now - 2 * DAY,
    });

    // ── Two active services, so "My services" is not an empty state.
    await ctx.db.insert("serviceSubscriptions", {
      userId,
      serviceKey: "shipment-tracking",
      name: "Shipment tracking",
      category: "Logistics",
      status: "active",
      planLabel: "Demo plan",
      usageLabel: "3 of 10 consignments used",
      renewalAt: now + 18 * DAY,
      createdAt: now - 14 * DAY,
      updatedAt: now - 2 * DAY,
    });
    await ctx.db.insert("serviceSubscriptions", {
      userId,
      serviceKey: "document-studio",
      name: "Document studio",
      category: "Documents",
      status: "active",
      planLabel: "Demo plan",
      usageLabel: "Unlimited templates",
      renewalAt: now + 18 * DAY,
      createdAt: now - 14 * DAY,
      updatedAt: now - 2 * DAY,
    });

    return {
      seeded: true as const,
      shipments: shipmentIds.length,
      walletBalanceNgn: closingBalance,
      points: 2_400,
      notifications: 3,
      services: 2,
    };
  },
});

/** Audit trail entry for the demo account creation. */
export const recordSeedAudit = internalMutation({
  args: { userId: v.id("users"), email: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert("auditLogs", {
      actorId: args.userId,
      actorEmail: args.email,
      action: "DEMO_SEEDED",
      resource: "user",
      resourceId: args.userId,
      after: { email: args.email, role: "user" },
      createdAt: Date.now(),
    });
    return { ok: true };
  },
});
