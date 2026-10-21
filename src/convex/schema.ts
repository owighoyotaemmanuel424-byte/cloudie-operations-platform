import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";
import type { VLiteral, Validator } from "convex/values";

/** Typed helper: tuple of v.literal() validators for spreading into v.union(). */
type LiteralTuple<T extends readonly string[]> = {
  [K in keyof T]: VLiteral<T[K]>;
};
const literals = <T extends readonly string[]>(values: T) =>
  values.map((s) => v.literal(s)) as unknown as LiteralTuple<T> & Validator<unknown>;

// ─── Roles ───
import { vtuCatalogTables } from "./vtuSchema/catalog";
import { vtuLedgerTables } from "./vtuSchema/ledger";
import { vtuProviderTables } from "./vtuSchema/providers";

// The VTU enums moved to `vtuSchema/types.ts` when the tables split out, and
// are re-exported here so every existing `from "./schema"` import keeps working
// untouched. Moving them was necessary rather than cosmetic: the table modules
// need the enums, and importing them back from this file would mean the file
// that imports the modules was imported by the modules.
export * from "./vtuSchema/types";

export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  VENDOR: "vendor",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.VENDOR),
);
export type Role = Infer<typeof roleValidator>;

// ─── Enums ───
export const SHIPMENT_STATUSES = [
  "pending",
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "failed",
  "cancelled",
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export const POINT_TX_TYPES = [
  "deposit",
  "purchase",
  "service_charge",
  "refund",
  "admin_adjustment",
  "referral_reward",
  "vendor_transaction",
  "marketplace_purchase",
  "shipment_creation",
  "tracking_update",
  "document_generation",
  "email_dispatch",
  "image_rendering",
  // VTU (airtime/data/cable/electricity/exam/betting). A purchase debits and a
  // failure reverses; both flow through this same ledger so VTU money is never
  // tracked by a second, parallel balance.
  "vtu_purchase",
  "vtu_refund",
] as const;
export type PointTxType = (typeof POINT_TX_TYPES)[number];
export const pointTxTypeValidator = v.union(...literals(POINT_TX_TYPES));

export const DOCUMENT_TYPES = [
  "flight",
  "hotel",
  "invoice",
  "customs",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const KYC_STATUSES = [
  "submitted",
  "under_review",
  "approved",
  "rejected",
  "resubmission_required",
] as const;
export type KycStatus = (typeof KYC_STATUSES)[number];

// ─── Native tracking platform enums (CRESTLINE) ───
export const TRACKING_STATUSES = [
  "CREATED",
  "BOOKED",
  "PICKED_UP",
  "PROCESSING",
  "AT_ORIGIN_FACILITY",
  "DEPARTED_ORIGIN",
  "IN_TRANSIT",
  "ARRIVED_DESTINATION_COUNTRY",
  "CUSTOMS_CLEARANCE",
  "CUSTOMS_CLEARED",
  "AT_DESTINATION_FACILITY",
  "OUT_FOR_DELIVERY",
  "DELIVERY_ATTEMPTED",
  "DELIVERED",
  "EXCEPTION",
  "ON_HOLD",
  "CANCELLED",
  "RETURNED",
] as const;
export type TrackingStatus = (typeof TRACKING_STATUSES)[number];
export const trackingStatusValidator = v.union(...literals(TRACKING_STATUSES));

export const LOCATION_TYPES = [
  "country",
  "state",
  "city",
  "warehouse",
  "airport",
  "sorting_center",
  "distribution_center",
  "customs_facility",
  "delivery_hub",
] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];
export const locationTypeValidator = v.union(...literals(LOCATION_TYPES));

export const FACILITY_TYPES = [
  "warehouse",
  "airport",
  "sorting_center",
  "distribution_center",
  "customs_facility",
  "delivery_hub",
] as const;
export type FacilityType = (typeof FACILITY_TYPES)[number];
export const facilityTypeValidator = v.union(...literals(FACILITY_TYPES));

export const ROUTE_STOP_STATUSES = [
  "pending",
  "arrived",
  "departed",
  "skipped",
] as const;
export type RouteStopStatus = (typeof ROUTE_STOP_STATUSES)[number];
export const routeStopStatusValidator = v.union(...literals(ROUTE_STOP_STATUSES));

export const SITE_TYPES = ["bank", "investment", "logistics", "ticketing", "business", "services"] as const;
export type SiteType = (typeof SITE_TYPES)[number];

export const ORDER_STATUSES = [
  "pending",
  "paid",
  "escrow",
  "completed",
  "refunded",
  "disputed",
  "cancelled",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

// ─── Schema ───
const schema = defineSchema(
  {
    ...authTables,

    users: defineTable({
      name: v.optional(v.string()),
      image: v.optional(v.string()),
      email: v.optional(v.string()),
      emailVerificationTime: v.optional(v.number()),
      isAnonymous: v.optional(v.boolean()),
      role: v.optional(roleValidator),
      // Authoritative customer wallet balance in NGN. Legacy pointsBalance remains temporarily for migration/backward compatibility.
      walletBalanceNgn: v.optional(v.number()),
      pointsBalance: v.optional(v.number()),
      referralCode: v.optional(v.string()),
      referredBy: v.optional(v.string()),
      isSuspended: v.optional(v.boolean()),
      isTerminated: v.optional(v.boolean()),
      terminatedAt: v.optional(v.number()),
      lastActiveAt: v.optional(v.number()),
      // Custom organization name the user issues their own documents under.
      organizationName: v.optional(v.string()),
      createdAt: v.optional(v.number()),
    })
      .index("email", ["email"])
      .index("by_role", ["role"])
      .index("referralCode", ["referralCode"])
      .index("by_createdAt", ["createdAt"]),

    /** Authoritative monetary wallet ledger. Amounts are NGN major units. */
    // Customer-facing service lifecycle records. These are intentionally separate
    // from marketplace orders: an order is a transaction; a service is something
    // the customer can keep managing, renewing, pausing or inspecting.
    serviceSubscriptions: defineTable({
      userId: v.id("users"),
      serviceKey: v.string(),
      name: v.string(),
      category: v.string(),
      status: v.union(
        v.literal("active"),
        v.literal("paused"),
        v.literal("cancelled"),
        v.literal("provisioning"),
      ),
      resourceId: v.optional(v.string()),
      resourceLabel: v.optional(v.string()),
      planLabel: v.optional(v.string()),
      usageLabel: v.optional(v.string()),
      renewalAt: v.optional(v.number()),
      metadata: v.optional(v.any()),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_user", ["userId", "updatedAt"])
      .index("by_user_and_status", ["userId", "status", "updatedAt"])
      .index("by_user_and_service", ["userId", "serviceKey"]),

    walletLedger: defineTable({
      userId: v.id("users"),
      amountNgn: v.number(),
      balanceAfterNgn: v.number(),
      description: v.string(),
      type: v.string(),
      reference: v.optional(v.string()),
      referenceId: v.optional(v.string()),
      idempotencyKey: v.optional(v.string()),
      metadata: v.optional(v.any()),
      createdAt: v.number(),
    })
      .index("by_user", ["userId", "createdAt"])
      .index("by_type", ["type", "createdAt"])
      .index("by_idempotency", ["idempotencyKey"])
      .index("by_reference", ["reference", "referenceId"])
      .index("by_createdAt", ["createdAt"]),

    /** Persistent financial risk cases. Cases are investigative records only; they never mutate funds. */
    platformSettings: defineTable({
      key: v.string(),
      value: v.any(),
      updatedAt: v.number(),
      updatedBy: v.optional(v.id("users")),
    }).index("by_key", ["key"]),

    riskCases: defineTable({
      userId: v.id("users"),
      score: v.number(),
      severity: v.string(),
      status: v.string(),
      reasons: v.array(v.string()),
      transactionCount: v.number(),
      debitTotal: v.number(),
      largestDebit: v.number(),
      assignedTo: v.optional(v.id("users")),
      notes: v.optional(v.array(v.object({
        authorId: v.id("users"),
        authorEmail: v.optional(v.string()),
        body: v.string(),
        createdAt: v.number(),
      }))),
      createdAt: v.number(),
      updatedAt: v.number(),
      resolvedAt: v.optional(v.number()),
    })
      .index("by_status", ["status", "updatedAt"])
      .index("by_severity", ["severity", "updatedAt"])
      .index("by_user", ["userId", "updatedAt"])
      .index("by_user_status", ["userId", "status"])
      .index("by_createdAt", ["createdAt"]),

    pointLedger: defineTable({
      userId: v.id("users"),
      amount: v.number(),
      balanceAfter: v.number(),
      description: v.string(),
      type: v.union(...literals(POINT_TX_TYPES)),
      reference: v.optional(v.string()),
      referenceId: v.optional(v.string()),
      idempotencyKey: v.optional(v.string()),
      metadata: v.optional(v.any()),
      createdAt: v.number(),
    })
      .index("by_user", ["userId", "createdAt"])
      .index("by_type", ["type", "createdAt"])
      .index("by_idempotency", ["idempotencyKey"])
      .index("by_createdAt", ["createdAt"]),

    shipments: defineTable({
      userId: v.id("users"),
      trackingNumber: v.string(),
      status: v.union(
        ...literals(SHIPMENT_STATUSES),
      ),
      senderName: v.string(),
      senderPhone: v.string(),
      senderEmail: v.string(),
      senderAddress: v.string(),
      senderCity: v.string(),
      senderState: v.string(),
      senderCountry: v.string(),
      senderPostalCode: v.string(),
      recipientName: v.string(),
      recipientPhone: v.string(),
      recipientEmail: v.string(),
      recipientAddress: v.string(),
      recipientCity: v.string(),
      recipientState: v.string(),
      recipientCountry: v.string(),
      recipientPostalCode: v.string(),
      packageDescription: v.string(),
      weight: v.number(),
      dimensions: v.optional(v.string()),
      serviceType: v.string(),
      estimatedDelivery: v.optional(v.number()),
      notes: v.optional(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_user", ["userId", "createdAt"])
      .index("by_tracking", ["trackingNumber"])
      .index("by_status", ["status"])
      .index("by_createdAt", ["createdAt"]),

    shipmentEvents: defineTable({
      shipmentId: v.id("shipments"),
      status: v.string(),
      location: v.optional(v.string()),
      description: v.string(),
      metadata: v.optional(v.any()),
      timestamp: v.number(),
    }).index("by_shipment", ["shipmentId", "timestamp"]),

    documents: defineTable({
      userId: v.id("users"),
      type: v.union(
        ...literals(DOCUMENT_TYPES),
      ),
      title: v.string(),
      data: v.any(),
      pointsCost: v.number(),
      priceNgn: v.optional(v.number()),
      createdAt: v.number(),
    }).index("by_user", ["userId", "createdAt"]),

    tenantSites: defineTable({
      ownerId: v.id("users"),
      siteName: v.string(),
      displayName: v.optional(v.string()),
      slug: v.optional(v.string()),
      subdomain: v.string(),
      siteType: v.union(v.literal("bank"), v.literal("investment"), v.literal("logistics"), v.literal("ticketing"), v.literal("business"), v.literal("services")),
      currency: v.optional(v.string()), // e.g. USD, GBP, EUR
      country: v.optional(v.string()),
      timezone: v.optional(v.string()),
      supportEmail: v.optional(v.string()),
      supportPhone: v.optional(v.string()),
      plan: v.optional(v.string()),
      // lifecycle: active | suspended | disabled | draft | archived
      lifecycleStatus: v.optional(v.string()),
      // banking feature toggles (inherit from tenantSite config)
      bankingEnabled: v.optional(v.boolean()),
      isActive: v.boolean(),
      renewalDate: v.optional(v.number()),
      /** Display font chosen in the Theme tab; validated against a client allowlist. */
      fontFamily: v.optional(v.string()),
      /** Recurring point charge for the site plan, billed on each renewal date. */
      monthlyPoints: v.optional(v.number()),
      // Branding + design kit applied from the template used at creation time.
      branding: v.optional(
        v.object({
          logo: v.optional(v.string()),
          primaryColor: v.optional(v.string()),
          accentColor: v.optional(v.string()),
          /** "light" | "dark" design mode for the customer app + admin console. */
          themeMode: v.optional(v.string()),
          surfaceColor: v.optional(v.string()),
          radius: v.optional(v.string()),
          tagline: v.optional(v.string()),
          heroHeadline: v.optional(v.string()),
          customerAppStyle: v.optional(v.string()),
          adminConsoleStyle: v.optional(v.string()),
          templateSlug: v.optional(v.string()),
        }),
      ),
      contactEmail: v.optional(v.string()),
      contactPhone: v.optional(v.string()),
      createdAt: v.number(),
    })
      .index("by_owner", ["ownerId"])
      .index("by_subdomain", ["subdomain"])
      .index("by_slug", ["slug", "siteType"]),

    kycRecords: defineTable({
      tenantId: v.id("tenantSites"),
      userId: v.id("users"),
      status: v.union(
        ...literals(KYC_STATUSES),
      ),
      fullName: v.string(),
      dateOfBirth: v.optional(v.string()),
      documentUrl: v.optional(v.string()), // legacy field, unused by the new flow
      storageFileId: v.optional(v.id("storageFiles")),
      documentName: v.optional(v.string()),
      /** Set by the tenant portal's liveness step before the record is filed. */
      livenessPassed: v.optional(v.boolean()),
      resubmissionCount: v.optional(v.number()),
      rejectionReason: v.optional(v.string()),
      notes: v.optional(v.string()),
      reviewedBy: v.optional(v.id("users")),
      reviewedAt: v.optional(v.number()),
      createdAt: v.number(),
      updatedAt: v.number(),
    }).index("by_tenant", ["tenantId", "createdAt"]).index("by_user", ["userId", "createdAt"]).index("by_status", ["status"]),

    tenantUsers: defineTable({
      tenantId: v.id("tenantSites"),
      userId: v.id("users"),
      role: v.string(),
      /** active | suspended — suspending blocks customer-portal sign-in without deleting history. */
      status: v.optional(v.string()),
      createdAt: v.number(),
    })
      .index("by_tenant", ["tenantId"])
      .index("by_tenant_and_user", ["tenantId", "userId"]),

    tenantLedger: defineTable({
      tenantId: v.id("tenantSites"),
      userId: v.id("users"),
      amount: v.number(),
      description: v.string(),
      type: v.string(),
      createdAt: v.number(),
    }).index("by_tenant", ["tenantId", "createdAt"]),

    /** Custom domains attached to a tenant site, verified by DNS TXT record. */
    tenantDomains: defineTable({
      tenantId: v.id("tenantSites"),
      domain: v.string(),
      /** DNS TXT value the owner must publish before verification can pass. */
      verificationToken: v.string(),
      // pending | verifying | verified | failed
      status: v.string(),
      attempts: v.number(),
      lastCheckedAt: v.optional(v.number()),
      lastError: v.optional(v.string()),
      verifiedAt: v.optional(v.number()),
      createdAt: v.number(),
    })
      .index("by_tenant", ["tenantId", "createdAt"])
      .index("by_domain", ["domain"]),

    // ─── Banking engine: beneficiaries, deposits, withdrawals, transfers, double-entry posts ───
    bankingBeneficiaries: defineTable({
      tenantId: v.id("tenantSites"),
      ownerUserId: v.id("users"),
      nickname: v.string(),
      accountNumber: v.string(),
      accountHolderName: v.optional(v.string()),
      accountType: v.optional(v.string()),
      isExternal: v.boolean(),
      // external bank details (opaque, not required for internal transfers)
      bankName: v.optional(v.string()),
      routingNumber: v.optional(v.string()),
      swiftCode: v.optional(v.string()),
      createdAt: v.number(),
    })
      .index("by_tenant_owner", ["tenantId", "ownerUserId", "createdAt"])
      .index("by_owner", ["ownerUserId"])
      .index("by_tenant", ["tenantId"]),

    bankingDeposits: defineTable({
      tenantId: v.id("tenantSites"),
      userId: v.id("users"),
      accountId: v.optional(v.id("tenantAccounts")),
      reference: v.string(),
      amountMinor: v.number(), // minor units (e.g. cents)
      currency: v.string(),
      status: v.union(
        v.literal("pending"),
        v.literal("processing"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("cancelled"),
        v.literal("reversed"),
      ),
      method: v.string(),
      description: v.optional(v.string()),
      idempotencyKey: v.optional(v.string()),
      reconciledLedgerGroupId: v.optional(v.string()),
      createdAt: v.number(),
      completedAt: v.optional(v.number()),
    })
      .index("by_tenant", ["tenantId", "createdAt"])
      .index("by_user", ["userId", "createdAt"])
      .index("by_reference", ["reference"])
      .index("by_idempotency", ["idempotencyKey"]),

    bankingWithdrawals: defineTable({
      tenantId: v.id("tenantSites"),
      userId: v.id("users"),
      accountId: v.id("tenantAccounts"),
      reference: v.string(),
      amountMinor: v.number(),
      feeMinor: v.number(),
      totalDebitMinor: v.number(), // = amountMinor + feeMinor
      currency: v.string(),
      destination: v.optional(v.string()),
      method: v.optional(v.string()),
      status: v.union(
        v.literal("pending"),
        v.literal("processing"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("cancelled"),
        v.literal("reversed"),
      ),
      description: v.optional(v.string()),
      idempotencyKey: v.optional(v.string()),
      ledgerGroupId: v.optional(v.string()),
      createdAt: v.number(),
      completedAt: v.optional(v.number()),
    })
      .index("by_tenant", ["tenantId", "createdAt"])
      .index("by_user", ["userId", "createdAt"])
      .index("by_account", ["accountId", "createdAt"])
      .index("by_reference", ["reference"])
      .index("by_idempotency", ["idempotencyKey"]),

    bankingTransfers: defineTable({
      tenantId: v.id("tenantSites"),
      initiatorUserId: v.id("users"),
      sourceAccountId: v.id("tenantAccounts"),
      destType: v.union(
        v.literal("internal_account"),
        v.literal("beneficiary"),
        v.literal("external"),
      ),
      destAccountId: v.optional(v.id("tenantAccounts")),
      beneficiaryId: v.optional(v.id("bankingBeneficiaries")),
      reference: v.string(),
      amountMinor: v.number(),
      feeMinor: v.number(),
      totalDebitMinor: v.number(),
      currency: v.string(),
      // fee/limit snapshot at transaction time (historical explainability)
      feeSnapshot: v.optional(v.any()),
      status: v.union(
        v.literal("pending"),
        v.literal("processing"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("cancelled"),
        v.literal("reversed"),
      ),
      description: v.optional(v.string()),
      idempotencyKey: v.optional(v.string()),
      ledgerGroupId: v.optional(v.string()),
      createdAt: v.number(),
      completedAt: v.optional(v.number()),
    })
      .index("by_tenant", ["tenantId", "createdAt"])
      .index("by_source_account", ["sourceAccountId", "createdAt"])
      .index("by_reference", ["reference"])
      .index("by_idempotency", ["idempotencyKey"]),

    // Double-entry ledger posts: every financial op is a group of balanced entries.
    bankingLedgerEntries: defineTable({
      tenantId: v.id("tenantSites"),
      groupId: v.string(), // journal / transaction group id
      relatedKind: v.union(
        v.literal("transfer"),
        v.literal("deposit"),
        v.literal("withdrawal"),
        v.literal("fee"),
        v.literal("reversal"),
        v.literal("adjustment"),
      ),
      relatedId: v.string(), // _id of the source entity (transfer/deposit/…)
      accountId: v.optional(v.id("tenantAccounts")),
      userId: v.optional(v.id("users")),
      // one of (debitMinor, creditMinor) is > 0; invariants: group debits == group credits.
      debitMinor: v.number(),
      creditMinor: v.number(),
      currency: v.string(),
      description: v.string(),
      idempotencyKey: v.optional(v.string()),
      createdAt: v.number(),
    })
      .index("by_tenant", ["tenantId", "createdAt"])
      .index("by_group", ["groupId", "createdAt"])
      .index("by_account", ["accountId", "createdAt"])
      .index("by_user", ["userId", "createdAt"])
      .index("by_idempotency", ["idempotencyKey"]),

    // Fee/limit config per tenant (audited; snapshot per TXN)
    bankingFeeConfig: defineTable({
      tenantId: v.id("tenantSites"),
      transferFeeMinor: v.number(),
      withdrawalFeeMinor: v.number(),
      depositFeeMinor: v.optional(v.number()),
      dailyTransferLimitMinor: v.optional(v.number()),
      dailyWithdrawalLimitMinor: v.optional(v.number()),
      perTransactionLimitMinor: v.optional(v.number()),
      minTransactionMinor: v.optional(v.number()),
      currency: v.string(),
      updatedBy: v.optional(v.id("users")),
      updatedAt: v.number(),
    }).index("by_tenant", ["tenantId"]),

    tenantAccounts: defineTable({
      tenantId: v.id("tenantSites"),
      userId: v.id("users"),
      accountType: v.union(v.literal("checking"), v.literal("savings"), v.literal("credit")),
      name: v.string(),
      balance: v.number(),
      accountNumber: v.string(),
      routingNumber: v.optional(v.string()),
      currency: v.optional(v.string()),
      isActive: v.boolean(),
      status: v.optional(
        v.union(
          v.literal("pending"),
          v.literal("active"),
          v.literal("frozen"),
          v.literal("suspended"),
          v.literal("closed"),
        ),
      ),
      balanceMinor: v.optional(v.number()), // authoritative integer cents
      availableBalanceMinor: v.optional(v.number()),
      ledgerBalanceMinor: v.optional(v.number()),
      createdAt: v.number(),
    })
      .index("by_tenant", ["tenantId", "createdAt"])
      .index("by_tenant_and_user", ["tenantId", "userId"])
      .index("by_account_number", ["accountNumber"]),

    bankingTemplates: defineTable({
      name: v.string(),
      bankName: v.string(),
      displayName: v.string(),
      slug: v.optional(v.string()),
      currency: v.string(),
      country: v.optional(v.string()),
      timezone: v.optional(v.string()),
      supportEmail: v.optional(v.string()),
      supportPhone: v.optional(v.string()),
      plan: v.optional(v.string()),
      primaryColor: v.optional(v.string()),
      accentColor: v.optional(v.string()),
      // ─── Modern design kit (applied to the tenant's customer app + admin console) ───
      /** "light" | "dark" */
      themeMode: v.optional(v.string()),
      surfaceColor: v.optional(v.string()),
      radius: v.optional(v.string()),
      tagline: v.optional(v.string()),
      heroHeadline: v.optional(v.string()),
      customerAppStyle: v.optional(v.string()),
      adminConsoleStyle: v.optional(v.string()),
      description: v.optional(v.string()),
      features: v.object({
        customerPortal: v.boolean(),
        accounts: v.boolean(),
        transfers: v.boolean(),
        deposits: v.boolean(),
        withdrawals: v.boolean(),
        kyc: v.boolean(),
        statements: v.boolean(),
        notifications: v.boolean(),
        auditLogging: v.boolean(),
        realtime: v.boolean(),
      }),
      createdBy: v.optional(v.id("users")),
      createdAt: v.number(),
      updatedAt: v.number(),
    }).index("by_name", ["name"]).index("by_slug", ["slug"]),

    vendors: defineTable({
      userId: v.id("users"),
      businessName: v.string(),
      description: v.optional(v.string()),
      contactEmail: v.optional(v.string()),
      contactPhone: v.optional(v.string()),
      category: v.optional(v.string()),
      website: v.optional(v.string()),
      supportingInfo: v.optional(v.string()),
      status: v.union(v.literal("pending"), v.literal("approved"), v.literal("suspended"), v.literal("rejected")),
      statusReason: v.optional(v.string()),
      earnings: v.number(),
      totalSales: v.number(),
      createdAt: v.number(),
      // Vendor onboarding (point marketplace). All optional so older rows stay valid.
      contactName: v.optional(v.string()),
      payoutMethod: v.optional(v.string()),
      payoutDetails: v.optional(v.string()),
      documentNames: v.optional(v.array(v.string())),
      reviewedAt: v.optional(v.number()),
    }).index("by_user", ["userId"]).index("by_status", ["status", "createdAt"]),

    /** Points-for-cash packages listed by verified vendors. */
    pointPackages: defineTable({
      vendorId: v.id("vendors"),
      name: v.string(),
      points: v.number(),
      /** Price the buyer pays, in minor units of `currency`. */
      priceMinor: v.number(),
      currency: v.string(),
      isActive: v.boolean(),
      totalSold: v.number(),
      createdAt: v.number(),
    })
      .index("by_vendor", ["vendorId"])
      .index("by_active", ["isActive"]),

    /** Point purchases held in escrow until the vendor fulfils. */
    pointOrders: defineTable({
      buyerId: v.id("users"),
      packageId: v.id("pointPackages"),
      vendorId: v.id("vendors"),
      points: v.number(),
      priceMinor: v.number(),
      currency: v.string(),
      // placed | paid | escrow | fulfilled | credited | disputed | cancelled | refunded
      status: v.string(),
      createdAt: v.number(),
      paidAt: v.optional(v.number()),
      escrowAt: v.optional(v.number()),
      fulfilledAt: v.optional(v.number()),
      creditedAt: v.optional(v.number()),
      disputedAt: v.optional(v.number()),
      disputeReason: v.optional(v.string()),
      fulfilledBy: v.optional(v.id("users")),
    })
      .index("by_buyer", ["buyerId", "createdAt"])
      .index("by_vendor", ["vendorId", "createdAt"]),

    /** Vendor payout ledger — credited when escrow settles. */
    vendorPayouts: defineTable({
      vendorId: v.id("vendors"),
      orderId: v.optional(v.id("pointOrders")),
      amountMinor: v.number(),
      currency: v.string(),
      // pending | paid | failed
      status: v.string(),
      reference: v.string(),
      createdAt: v.number(),
      paidAt: v.optional(v.number()),
    }).index("by_vendor", ["vendorId", "createdAt"]),

    marketplaceProducts: defineTable({
      vendorId: v.id("vendors"),
      name: v.string(),
      description: v.string(),
      pointsPrice: v.number(),
      /** Authoritative customer selling price in NGN. */
      priceNgn: v.optional(v.number()),
      category: v.string(),
      imageUrl: v.optional(v.string()),
      isActive: v.boolean(),
      isApproved: v.boolean(),
      totalSold: v.number(),
      createdAt: v.number(),
      // Optional external-provider fields. Kept optional so existing listings remain valid.
      provider: v.optional(v.string()),
      providerProductRef: v.optional(v.string()),
      providerCategoryId: v.optional(v.number()),
      providerCostNgn: v.optional(v.number()),
      providerAvailableQuantity: v.optional(v.number()),
      providerStatus: v.optional(v.string()),
      providerSyncedAt: v.optional(v.number()),
      providerMetadata: v.optional(v.any()),
    }).index("by_vendor", ["vendorId"]).index("by_category", ["category"]).index("by_provider_ref", ["provider", "providerProductRef"]),

    marketplaceOrders: defineTable({
      buyerId: v.id("users"),
      productId: v.id("marketplaceProducts"),
      vendorId: v.id("vendors"),
      quantity: v.number(),
      totalPoints: v.number(),
      /** Authoritative order total in NGN. */
      totalNgn: v.optional(v.number()),
      status: v.union(
        ...literals(ORDER_STATUSES),
      ),
      createdAt: v.number(),
      provider: v.optional(v.string()),
      providerOrderId: v.optional(v.string()),
      providerStatus: v.optional(v.string()),
      providerCostNgn: v.optional(v.number()),
      providerResponse: v.optional(v.any()),
      idempotencyKey: v.optional(v.string()),
      fulfilledItems: v.optional(v.any()),
      updatedAt: v.optional(v.number()),
    }).index("by_buyer", ["buyerId"]).index("by_vendor", ["vendorId"]).index("by_provider_order", ["provider", "providerOrderId"]).index("by_order_idempotency", ["idempotencyKey"]),

    disputes: defineTable({
      orderId: v.id("marketplaceOrders"),
      raisedBy: v.id("users"),
      reason: v.string(),
      priority: v.optional(v.union(v.literal("low"), v.literal("medium"), v.literal("high"), v.literal("critical"))),
      notes: v.optional(
        v.array(
          v.object({
            authorId: v.id("users"),
            authorEmail: v.optional(v.string()),
            text: v.string(),
            createdAt: v.number(),
          }),
        ),
      ),
      status: v.union(v.literal("open"), v.literal("under_review"), v.literal("resolved"), v.literal("closed")),
      resolution: v.optional(v.string()),
      resolvedBy: v.optional(v.id("users")),
      resolvedAt: v.optional(v.number()),
      createdAt: v.number(),
      updatedAt: v.number(),
    }).index("by_order", ["orderId"]).index("by_status", ["status", "createdAt"]),

    referrals: defineTable({
      referrerId: v.id("users"),
      referredUserId: v.id("users"),
      status: v.union(v.literal("pending"), v.literal("completed"), v.literal("rewarded")),
      rewardPoints: v.number(),
      rewardNgn: v.optional(v.number()),
      createdAt: v.number(),
    }).index("by_referrer", ["referrerId"]).index("by_referred", ["referredUserId"]),

    supportTickets: defineTable({
      userId: v.id("users"),
      ticketNumber: v.string(),
      subject: v.string(),
      category: v.string(),
      priority: v.union(v.literal("low"), v.literal("normal"), v.literal("high"), v.literal("urgent")),
      status: v.union(v.literal("open"), v.literal("pending"), v.literal("resolved"), v.literal("closed")),
      lastMessageAt: v.number(),
      lastMessageBy: v.string(),
      unreadForCustomer: v.number(),
      createdAt: v.number(),
      updatedAt: v.number(),
      resolvedAt: v.optional(v.number()),
    })
      .index("by_user", ["userId", "updatedAt"])
      .index("by_user_status", ["userId", "status", "updatedAt"])
      .index("by_ticketNumber", ["ticketNumber"])
      .index("by_status", ["status", "updatedAt"]),

    supportMessages: defineTable({
      ticketId: v.id("supportTickets"),
      senderId: v.id("users"),
      senderRole: v.string(),
      body: v.string(),
      createdAt: v.number(),
      readByCustomer: v.boolean(),
    })
      .index("by_ticket", ["ticketId", "createdAt"]),

    notifications: defineTable({
      userId: v.id("users"),
      title: v.string(),
      message: v.string(),
      type: v.string(),
      isRead: v.boolean(),
      link: v.optional(v.string()),
      metadata: v.optional(v.any()),
      createdAt: v.number(),
    }).index("by_user", ["userId", "isRead", "createdAt"]),

    auditLogs: defineTable({
      actorId: v.optional(v.id("users")),
      actorEmail: v.optional(v.string()),
      action: v.string(),
      resource: v.string(),
      resourceId: v.optional(v.string()),
      before: v.optional(v.any()),
      after: v.optional(v.any()),
      reason: v.optional(v.string()),
      ipAddress: v.optional(v.string()),
      userAgent: v.optional(v.string()),
      createdAt: v.number(),
    }).index("by_actor", ["actorId", "createdAt"]).index("by_action", ["action", "createdAt"]),

    assets: defineTable({
      userId: v.id("users"),
      name: v.string(),
      url: v.string(),
      type: v.string(),
      size: v.number(),
      folder: v.optional(v.string()),
      metadata: v.optional(v.any()),
      createdAt: v.number(),
    }).index("by_user", ["userId", "createdAt"]).index("by_createdAt", ["createdAt"]),

    emailCampaigns: defineTable({
      userId: v.id("users"),
      subject: v.string(),
      senderName: v.string(),
      content: v.string(),
      recipients: v.array(v.string()),
      status: v.union(v.literal("draft"), v.literal("scheduled"), v.literal("sent"), v.literal("failed")),
      scheduledAt: v.optional(v.number()),
      sentAt: v.optional(v.number()),
      totalRecipients: v.number(),
      pointsCost: v.number(),
      createdAt: v.number(),
    }).index("by_user", ["userId", "createdAt"]),

    emailDeliveries: defineTable({
      campaignId: v.id("emailCampaigns"),
      recipientEmail: v.string(),
      status: v.union(v.literal("pending"), v.literal("sent"), v.string()),
      sentAt: v.optional(v.number()),
    }).index("by_campaign", ["campaignId"]),

    // ─── Super Admin tables ───
    pointPricing: defineTable({
      /** Service key. Required, as before — the document engine and the admin
       *  pricing screen both read it. */
      service: v.string(),
      workspace: v.string(),
      /** VTU price override key, e.g. "airtime.mtn.1000". Optional and created
       *  EMPTY: VTU falls back to nairaPrice / ngnPerPoint until an admin sets
       *  one. A VTU override row also sets `service` to the same value. */
      serviceCode: v.optional(v.string()),
      /** VTU override enable flag. Undefined is treated as inactive. */
      active: v.optional(v.boolean()),
      /** Customer-facing catalog copy. Blank falls back to the platform default. */
      label: v.optional(v.string()),
      description: v.optional(v.string()),
      pointsCost: v.number(),
      /** Per-service price overrides. When unset the point rate is used. */
      priceNgn: v.optional(v.number()),
      priceUsd: v.optional(v.number()),
      isActive: v.boolean(),
      effectiveFrom: v.number(),
      updatedBy: v.optional(v.id("users")),
      updatedAt: v.number(),
    })
      .index("by_service", ["service"])
      .index("by_serviceCode", ["serviceCode"]),

    adminSettings: defineTable({
      key: v.string(),
      value: v.any(),
      category: v.string(),
      updatedBy: v.optional(v.id("users")),
      updatedAt: v.number(),
    }).index("by_key", ["key"]),

    /**
     * One-time bootstrap gate for ADMIN_SETUP_CODE claims.
     * The table is intentionally singleton-keyed and records consumption so
     * the deployment secret cannot be replayed to create additional admins.
     */
    adminBootstrapState: defineTable({
      key: v.string(),
      consumedAt: v.optional(v.number()),
      consumedBy: v.optional(v.id("users")),
    }).index("by_key", ["key"]),

    moderationFlags: defineTable({
      tenantId: v.id("tenantSites"),
      rule: v.string(),
      severity: v.union(v.literal("low"), v.literal("medium"), v.literal("high"), v.literal("critical")),
      status: v.union(v.literal("open"), v.literal("reviewing"), v.literal("resolved"), v.literal("dismissed")),
      details: v.optional(v.string()),
      reviewNotes: v.optional(v.string()),
      reviewedBy: v.optional(v.id("users")),
      reviewedAt: v.optional(v.number()),
      createdAt: v.number(),
      updatedAt: v.number(),
    }).index("by_tenant", ["tenantId"]).index("by_status", ["status", "createdAt"]),

    adminSessions: defineTable({
      adminId: v.id("users"),
      action: v.string(),
      ip: v.optional(v.string()),
      userAgent: v.optional(v.string()),
      createdAt: v.number(),
    }).index("by_admin", ["adminId", "createdAt"]),

    // ─── Native shipment tracking platform (CRESTLINE) ───
    // Internal location database — populated manually by admins. No geocoding APIs.
    trackingLocations: defineTable({
      name: v.string(),
      type: locationTypeValidator,
      country: v.string(),
      countryCode: v.string(),
      state: v.optional(v.string()),
      city: v.optional(v.string()),
      postalCode: v.optional(v.string()),
      address: v.optional(v.string()),
      latitude: v.optional(v.number()),
      longitude: v.optional(v.number()),
      timezone: v.optional(v.string()),
      isActive: v.boolean(),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_type", ["type"])
      .index("by_country", ["countryCode"])
      .index("by_active", ["isActive"]),

    trackingFacilities: defineTable({
      name: v.string(),
      code: v.string(),
      type: facilityTypeValidator,
      locationId: v.id("trackingLocations"),
      isActive: v.boolean(),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_code", ["code"])
      .index("by_location", ["locationId"])
      .index("by_type", ["type"]),

    trackingCarriers: defineTable({
      name: v.string(),
      code: v.string(),
      logo: v.optional(v.string()),
      isActive: v.boolean(),
      createdAt: v.number(),
    }).index("by_code", ["code"]),

    trackingServiceTypes: defineTable({
      name: v.string(),
      code: v.string(),
      description: v.string(),
      estimatedTransitDays: v.number(),
      isActive: v.boolean(),
    }).index("by_code", ["code"]),

    // Full tracking-native shipments. The legacy `shipments` table keeps working;
    // this is the source of truth for the native tracking platform.
    trackingShipments: defineTable({
      trackingNumber: v.string(),
      referenceNumber: v.optional(v.string()),
      status: trackingStatusValidator,
      progress: v.number(),
      carrierId: v.optional(v.id("trackingCarriers")),
      serviceTypeId: v.optional(v.id("trackingServiceTypes")),
      serviceTypeName: v.string(),
      senderId: v.optional(v.id("users")),
      recipientId: v.optional(v.id("users")),
      originLocationId: v.optional(v.id("trackingLocations")),
      destinationLocationId: v.optional(v.id("trackingLocations")),
      currentLocationId: v.optional(v.id("trackingLocations")),
      senderName: v.string(),
      senderPhone: v.string(),
      senderEmail: v.string(),
      senderAddress: v.string(),
      senderCity: v.string(),
      senderState: v.string(),
      senderCountry: v.string(),
      senderPostalCode: v.string(),
      recipientName: v.string(),
      recipientPhone: v.string(),
      recipientEmail: v.string(),
      recipientAddress: v.string(),
      recipientCity: v.string(),
      recipientState: v.string(),
      recipientCountry: v.string(),
      recipientPostalCode: v.string(),
      packageDescription: v.string(),
      totalWeight: v.number(),
      weightUnit: v.union(v.literal("kg"), v.literal("lb")),
      dimensions: v.optional(v.string()),
      declaredValue: v.optional(v.number()),
      currency: v.optional(v.string()),
      notes: v.optional(v.string()),
      estimatedDelivery: v.optional(v.number()),
      actualDelivery: v.optional(v.number()),
      shippedAt: v.optional(v.number()),
      deliveredAt: v.optional(v.number()),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_tracking", ["trackingNumber"])
      .index("by_status", ["status"])
      .index("by_createdAt", ["createdAt"])
      .index("by_sender", ["senderId", "createdAt"])
      .index("by_recipient", ["recipientId", "createdAt"])
      .searchIndex("search_tracking", { searchField: "trackingNumber" }),

    trackingEvents: defineTable({
      shipmentId: v.id("trackingShipments"),
      status: v.string(),
      title: v.string(),
      description: v.string(),
      locationId: v.optional(v.id("trackingLocations")),
      locationLabel: v.optional(v.string()),
      facilityId: v.optional(v.id("trackingFacilities")),
      eventTimestamp: v.number(),
      timezone: v.optional(v.string()),
      latitude: v.optional(v.number()),
      longitude: v.optional(v.number()),
      isPublic: v.boolean(),
      createdBy: v.optional(v.id("users")),
      createdAt: v.number(),
    }).index("by_shipment", ["shipmentId", "eventTimestamp"]),

    trackingPackages: defineTable({
      shipmentId: v.id("trackingShipments"),
      packageNumber: v.number(),
      trackingNumber: v.string(),
      description: v.string(),
      packageType: v.string(),
      weight: v.number(),
      dimensions: v.optional(v.string()),
      quantity: v.number(),
      barcodeData: v.string(),
      qrData: v.string(),
      createdAt: v.number(),
    }).index("by_shipment", ["shipmentId", "packageNumber"]),

    trackingRouteStops: defineTable({
      shipmentId: v.id("trackingShipments"),
      locationId: v.optional(v.id("trackingLocations")),
      facilityId: v.optional(v.id("trackingFacilities")),
      label: v.string(),
      sequence: v.number(),
      status: routeStopStatusValidator,
      arrivalAt: v.optional(v.number()),
      departureAt: v.optional(v.number()),
      notes: v.optional(v.string()),
      createdAt: v.number(),
    }).index("by_shipment", ["shipmentId", "sequence"]),

    // ─── Cloudie-owned storage abstraction ───
    // Metadata for every file Cloudie stores. Bytes live in the runtime's own
    // file storage; ALL authorization/ownership flows through this table.
    storageFiles: defineTable({
      storageId: v.id("_storage"),
      ownerId: v.id("users"),
      tenantId: v.optional(v.id("tenantSites")),
      kind: v.union(
        v.literal("kyc_document"),
        v.literal("pdf_document"),
        v.literal("image"),
        v.literal("generic"),
      ),
      originalName: v.string(),
      mimeType: v.string(),
      sizeBytes: v.number(),
      path: v.string(),
      // Virtual folder path within the owner's library ("" = root, "brand/logos").
      // Rows written before folders existed simply have no value → treated as root.
      folder: v.optional(v.string()),
      sha256: v.optional(v.string()),
      isDeleted: v.boolean(),
      createdAt: v.number(),
      deletedAt: v.optional(v.number()),
    })
      .index("by_owner", ["ownerId", "createdAt"])
      .index("by_tenant", ["tenantId"])
      .index("by_storage", ["storageId"]),

    // ─── Image studio: billed render jobs ───
    // Charged up-front (points → ledger), then completed with the stored PNG or
    // failed with an automatic refund, mirroring the email dispatch gate: money
    // is never kept for a result that was never delivered.
    imageRenderJobs: defineTable({
      userId: v.id("users"),
      status: v.union(v.literal("processing"), v.literal("succeeded"), v.literal("failed")),
      template: v.string(),
      params: v.any(),
      pointsCost: v.number(),
      fileId: v.optional(v.id("storageFiles")),
      error: v.optional(v.string()),
      createdAt: v.number(),
      completedAt: v.optional(v.number()),
    }).index("by_user", ["userId", "createdAt"]),

    // ─── Document engine: templates → versions → render → stored bytes ───
    // Schema-driven Cloudie templates. The renderer consumes a frozen
    // version snapshot (documentTemplateVersions.blocks) so a generated
    // document never changes appearance when the live template is edited.
    documentTemplates: defineTable({
      documentType: v.string(), // category key (banking_ui, flight_itinerary, …)
      name: v.string(),
      slug: v.string(),
      description: v.optional(v.string()),
      thumbnailUrl: v.optional(v.string()),
      renderer: v.optional(v.string()), // "svg"
      status: v.optional(v.string()), // draft | active | disabled | archived
      visibility: v.optional(v.string()), // public | unlisted | private
      // Legacy: kept for document metadata only. Watermark has been removed.
      sensitivity: v.optional(v.string()), // standard | sensitive (no longer renders a stamp)
      requiredCredits: v.optional(v.number()), // points charged per PDF render
      // FALSE makes every stage free — creation, re-render and the quote alike.
      // ABSENT MEANS BILLABLE, so every row written before this flag existed
      // keeps charging. Read only through `resolveDocumentCost`, which is what
      // stops the exemption from being applied at one stage and forgotten at
      // another. The VTU receipt is the reason it exists: documents the platform
      // owes the customer rather than sells them.
      billable: v.optional(v.boolean()),
      supportedFormats: v.optional(v.array(v.string())), // ["png", "pdf"]
      schema: v.optional(v.any()), // { fields: FieldDef[] }
      configuration: v.optional(v.any()), // { pages: TemplatePage[], background, renderScale }
      // Artwork traced from a customer upload (their own PDF/image turned into
      // a reusable template). Referenced, never inlined into the layout.
      artworkFileId: v.optional(v.id("storageFiles")),
      createdById: v.id("users"),
      tenantId: v.optional(v.id("tenantSites")),
      isActive: v.boolean(),
      currentVersion: v.number(),
      archivedAt: v.optional(v.number()),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_type", ["documentType"])
      .index("by_creator", ["createdById", "createdAt"])
      .index("by_slug", ["slug"])
      .index("by_status", ["status"]),

    documentTemplateVersions: defineTable({
      templateId: v.id("documentTemplates"),
      version: v.number(),
      title: v.string(),
      blocks: v.any(), // PdfBlock[] structure validated at render time
      pointsCost: v.number(),
      createdById: v.id("users"),
      createdAt: v.number(),
    })
      .index("by_template", ["templateId", "version"]),

    // Generated documents: DRAFT → RENDERING → COMPLETED → SHARED →
    // REVOKED / EXPIRED / ARCHIVED, with FAILED + RETRY for errors.
    // Shares use an unguessable 131-bit slug — never sequential IDs.
    renderedDocuments: defineTable({
      templateVersionId: v.id("documentTemplateVersions"),
      templateId: v.optional(v.id("documentTemplates")),
      templateVersion: v.optional(v.number()),
      ownerId: v.id("users"),
      tenantId: v.optional(v.id("tenantSites")),
      title: v.optional(v.string()),
      status: v.optional(v.string()),
      inputData: v.optional(v.any()),
      // Artifacts: legacy field kept for compatibility; image = PNG/JPEG page
      // raster; pdf = server-assembled PDF. All live in storageFiles.
      storageFileId: v.optional(v.id("storageFiles")),
      imageFileId: v.optional(v.id("storageFiles")),
      pdfFileId: v.optional(v.id("storageFiles")),
      fileName: v.string(),
      pageCount: v.number(),
      sizeBytes: v.number(),
      publicSlug: v.optional(v.string()),
      isPublic: v.optional(v.boolean()),
      expiresAt: v.optional(v.number()),
      revokedAt: v.optional(v.number()),
      viewCount: v.optional(v.number()),
      lastViewedAt: v.optional(v.number()),
      failureReason: v.optional(v.string()),
      metadata: v.optional(v.any()),
      pointsCost: v.number(), // total charged so far (ledger is authoritative)
      // Price of the MOST RECENT render, for display. `pointsCost` grows with
      // every re-render and is an accounting figure; this is what one render
      // costs, so a document re-rendered three times still reads as "40 pts".
      // Absent on documents created before per-render pricing was recorded.
      renderPrice: v.optional(v.number()),
      createdAt: v.number(),
      updatedAt: v.optional(v.number()),
    })
      .index("by_owner", ["ownerId", "createdAt"])
      .index("by_tenant", ["tenantId"])
      .index("by_version", ["templateVersionId", "createdAt"])
      .index("by_publicSlug", ["publicSlug"])
      .index("by_status", ["status"]),

    // ─── Customer uploads ───
    // Documents a customer already owns (PDFs and images) brought into their
    // workspace. Stored bytes live in storageFiles; this is the workspace
    // record (title, kind, provenance) the library lists.
    uploadedDocuments: defineTable({
      ownerId: v.id("users"),
      fileId: v.id("storageFiles"),
      title: v.string(),
      fileName: v.string(),
      kind: v.union(v.literal("pdf"), v.literal("image")),
      mimeType: v.string(),
      sizeBytes: v.number(),
      notes: v.optional(v.string()),
      isArchived: v.optional(v.boolean()),
      createdAt: v.number(),
      updatedAt: v.optional(v.number()),
    }).index("by_owner", ["ownerId", "createdAt"]),

    // ─── Rate limiting (no Redis: fixed windows persisted in Convex) ───
    rateLimitBuckets: defineTable({
      key: v.string(), // "public_view:<slug>" | "render:<userId>" | …
      windowStart: v.number(),
      count: v.number(),
    }).index("by_key_and_window", ["key", "windowStart"]),

    // ─── Cloudie email engine ───
    emailMessages: defineTable({
      to: v.string(),
      fromName: v.string(),
      subject: v.string(),
      textBody: v.string(),
      htmlBody: v.optional(v.string()),
      /** Delivery provider that carried the message (e.g. elastic_email). */
      provider: v.optional(v.string()),
      templateKey: v.optional(v.string()),
      userId: v.optional(v.id("users")),
      campaignId: v.optional(v.id("emailCampaigns")),
      jobId: v.optional(v.id("cloudieJobs")),
      status: v.union(
        v.literal("queued"),
        v.literal("sending"),
        v.literal("sent"),
        v.literal("failed"),
        v.literal("bounced"),
        v.literal("blocked_unsubscribed"),
      ),
      attempts: v.number(),
      maxAttempts: v.number(),
      nextAttemptAt: v.number(),
      lastError: v.optional(v.string()),
      providerMessageId: v.optional(v.string()),
      sentAt: v.optional(v.number()),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_status", ["status", "nextAttemptAt"])
      .index("by_campaign", ["campaignId"])
      .index("by_to", ["to", "createdAt"])
      .index("by_createdAt", ["createdAt"]),

    emailDeliveryLogs: defineTable({
      messageId: v.id("emailMessages"),
      event: v.union(
        v.literal("queued"),
        v.literal("send_attempt"),
        v.literal("sent"),
        v.literal("failed"),
        v.literal("bounced"),
        v.literal("blocked_unsubscribed"),
      ),
      detail: v.optional(v.string()),
      createdAt: v.number(),
    }).index("by_message", ["messageId", "createdAt"]),

    emailUnsubscribes: defineTable({
      email: v.string(),
      reason: v.optional(v.string()),
      createdAt: v.number(),
    }).index("by_email", ["email"]),

    // ─── Transactional email provider configuration (admin-managed) ───
    // Singleton row (single-tenant platform): the Elastic Email connection is
    // configured from the Admin Dashboard, not from per-deployment env files.
    // The API key is stored ONLY here and ONLY as an AES-256-GCM payload — it
    // is never returned to the browser, logged, or placed in a URL.
    emailSettings: defineTable({
      provider: v.string(), // "elastic_email"
      enabled: v.boolean(),
      /** Delivery transport: "api" (HTTP API key) | "smtp" (SMTP relay). */
      transport: v.optional(v.string()),
      /** Encrypted API key: "v1:<iv>.<tag>.<ciphertext>" (base64 components). */
      apiKeyEncrypted: v.optional(v.string()),
      /** Masked placeholder for the admin UI (bullets only — no key material). */
      apiKeyMasked: v.optional(v.string()),
      /** Where the live key actually comes from: dashboard | environment | none. */
      apiKeySource: v.optional(v.string()),
      // ── SMTP relay (alternative transport) ─────────────────────────────────
      smtpHost: v.optional(v.string()),
      smtpPort: v.optional(v.number()),
      smtpSecure: v.optional(v.boolean()),
      smtpUsername: v.optional(v.string()),
      /** SMTP password, sealed the same way as the API key (never returned). */
      smtpPasswordEncrypted: v.optional(v.string()),
      smtpPasswordMasked: v.optional(v.string()),
      /** dashboard | environment | none */
      smtpPasswordSource: v.optional(v.string()),
      fromEmail: v.string(),
      fromName: v.string(),
      replyToEmail: v.optional(v.string()),
      testRecipient: v.optional(v.string()),
      /** not_configured | disabled | unverified | connected | invalid_key | sender_error | provider_error */
      status: v.string(),
      statusMessage: v.optional(v.string()),
      lastVerifiedAt: v.optional(v.number()),
      lastTestAt: v.optional(v.number()),
      lastTestStatus: v.optional(v.string()),
      lastTestRecipient: v.optional(v.string()),
      lastTestMessage: v.optional(v.string()),
      lastError: v.optional(v.string()),
      lastErrorAt: v.optional(v.number()),
      updatedBy: v.optional(v.id("users")),
      updatedAt: v.number(),
    }).index("by_provider", ["provider"]),

    // Server-side key material (never exposed by any query). Used only to
    // bootstrap the email-credential encryption key when the deployment has no
    // EMAIL_CREDENTIAL_ENCRYPTION_KEY configured.
    systemSecrets: defineTable({
      name: v.string(),
      value: v.string(),
      createdAt: v.number(),
    }).index("by_name", ["name"]),

    // ─── Cloudie job system (Postgres-equivalent: Convex-owned DB queue) ───
    cloudieJobs: defineTable({
      type: v.string(),
      payload: v.any(),
      status: v.union(
        v.literal("queued"),
        v.literal("processing"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("dead"),
      ),
      attempts: v.number(),
      maxAttempts: v.number(),
      runAfter: v.number(),
      claimedAt: v.optional(v.number()),
      completedAt: v.optional(v.number()),
      failedAt: v.optional(v.number()),
      lastError: v.optional(v.string()),
      idempotencyKey: v.optional(v.string()),
      result: v.optional(v.any()),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_status", ["status", "runAfter"])
      .index("by_idempotency", ["idempotencyKey"])
      .index("by_type", ["type", "createdAt"]),

    // ─── Payments: the ONE intentional external integration (Paystack) ───
    paymentOrders: defineTable({
      orderNumber: v.string(),
      buyerId: v.id("users"),
      kind: v.union(v.literal("points_package"), v.literal("wallet_funding")),
      packageId: v.string(),
      points: v.number(),
      walletAmountNgn: v.optional(v.number()),
      amountSubunit: v.number(), // authoritative server-side amount (cents/kobo)
      currency: v.string(),
      status: v.union(
        v.literal("initialized"),
        v.literal("pending"),
        v.literal("paid"),
        v.literal("failed"),
        v.literal("abandoned"),
      ),
      paystackReference: v.optional(v.string()),
      accessCode: v.optional(v.string()),
      authorizationUrl: v.optional(v.string()),
      verifiedAt: v.optional(v.number()),
      paidAt: v.optional(v.number()),
      // What Paystack actually settled (subunit + currency) and how far it
      // drifted from the order's server-set expectation. Purely for audit.
      paidSubunit: v.optional(v.number()),
      paidCurrency: v.optional(v.string()),
      amountVariance: v.optional(v.number()),
      failureReason: v.optional(v.string()),
      creditedLedgerId: v.optional(v.id("pointLedger")),
      creditedWalletLedgerId: v.optional(v.id("walletLedger")),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_buyer", ["buyerId", "createdAt"])
      .index("by_reference", ["paystackReference"])
      .index("by_order", ["orderNumber"]),

    // Webhook event log: idempotency + replay protection
    paymentWebhookEvents: defineTable({
      eventId: v.string(),
      reference: v.string(),
      channel: v.string(),
      signatureValid: v.boolean(),
      processedAt: v.number(),
      duplicate: v.boolean(),
    }).index("by_event", ["eventId"]),

    // ─── Crypto provider abstraction (BLOCKED without infra) ───
    cryptoDeposits: defineTable({
      userId: v.id("users"),
      asset: v.string(),
      address: v.string(),
      expectedAmount: v.number(),
      receivedAmount: v.optional(v.number()),
      confirmations: v.number(),
      state: v.union(
        v.literal("awaiting_deposit"),
        v.literal("confirming"),
        v.literal("confirmed"),
        v.literal("failed"),
      ),
      txHash: v.optional(v.string()),
      normalizedEvent: v.optional(v.any()),
      idempotencyKey: v.optional(v.string()),
      creditedLedgerId: v.optional(v.id("pointLedger")),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_user", ["userId", "createdAt"])
      .index("by_state", ["state"]),

    // ─── KYC audit history (first-party review workflow) ───
    kycEvents: defineTable({
      kycId: v.id("kycRecords"),
      actorId: v.id("users"),
      action: v.string(),
      fromStatus: v.optional(v.string()),
      toStatus: v.optional(v.string()),
      reason: v.optional(v.string()),
      createdAt: v.number(),
    }).index("by_kyc", ["kycId", "createdAt"]),

    // ─── Banking finance: richer lifecycle on deposits/withdrawals (extra fields) ───
    bankingApiKeys: defineTable({
      tenantId: v.id("tenantSites"),
      scope: v.string(),
      keyHash: v.string(),
      isRevoked: v.boolean(),
      createdBy: v.optional(v.id("users")),
      createdAt: v.number(),
      revokedAt: v.optional(v.number()),
    }).index("by_tenant", ["tenantId"]),

    // ─── Notification preferences (Cloudie-owned delivery state) ───
    notificationPreferences: defineTable({
      userId: v.id("users"),
      inApp: v.boolean(),
      email: v.boolean(),
      shipmentEvents: v.boolean(),
      marketplaceEvents: v.boolean(),
      pointsEvents: v.boolean(),
      marketing: v.boolean(),
      updatedAt: v.number(),
    }).index("by_user", ["userId"]),

    bankingIdempotency: defineTable({
      key: v.string(),
      kind: v.string(),
      tenantId: v.optional(v.id("tenantSites")),
      actorId: v.optional(v.id("users")),
      resultType: v.optional(v.string()),
      resultId: v.optional(v.string()),
      createdAt: v.number(),
    })
      .index("by_key", ["key"])
      .index("by_tenant_and_kind", ["tenantId", "kind", "createdAt"]),

    // ─── VTU / bill payments ────────────────────────────────────────────
    // Defined in three modules under `vtuSchema/` and spread in here rather
    // than written inline. The reason is physical, not architectural: this
    // file was 66 KB, past the ~56 KB ceiling a file-edit tool can read, which
    // made the last dozen lines of it unreachable. Splitting it puts every VTU
    // table somewhere a reader and an editor can both reach.
    //
    // `defineSchema` is still called ONCE, on one object, so `dataModel` is
    // generated exactly as before and nothing downstream can tell the
    // difference. The order of these three spreads is presentational only —
    // a Convex schema is a map, not a sequence.
    ...vtuProviderTables,
    ...vtuLedgerTables,
    ...vtuCatalogTables,
  },
  {
    schemaValidation: false,
  },
);

export default schema;
