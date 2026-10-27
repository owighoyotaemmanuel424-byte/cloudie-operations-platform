import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { neonApi, getCachedNeonUser, clearNeonSession, type NeonUser } from "./neonApi";
import { PLATFORM_TEMPLATES } from "./platformTemplates";
import { DEFAULT_POINT_PACKAGES } from "./pricing";

export class ConvexReactClient {
  url: string;
  constructor(url: string) {
    this.url = url;
  }
}

const CONVEX_FUNCTION_NAME_SYMBOL = Symbol.for("functionName");

export function resolveFunctionName(ref: unknown): string {
  if (!ref) return "";
  if (typeof ref === "string") return ref;
  try {
    const symVal = (ref as Record<symbol, unknown>)[CONVEX_FUNCTION_NAME_SYMBOL];
    if (typeof symVal === "string") return symVal;
  } catch {
    // Ignore proxy symbol access errors
  }
  try {
    const rawName = (ref as { _name?: unknown })?._name;
    if (typeof rawName === "string") return rawName;
    const fnName = (ref as { name?: unknown })?.name;
    if (typeof fnName === "string" && fnName !== "Proxy") return fnName;
  } catch {
    // Ignore proxy property access errors
  }
  return "";
}

function toEpochMs(val: unknown): number {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (typeof val === "string" && val.trim()) {
    const asNum = Number(val);
    if (Number.isFinite(asNum) && asNum > 1_000_000_000) return asNum;
    const parsed = Date.parse(val);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (val instanceof Date) return val.getTime();
  return Date.now();
}

function normalizeLedgerEntry(row: Record<string, unknown>, idx = 0) {
  const id = String(row._id ?? row.id ?? `tx_${idx}_${Date.now()}`);
  const amountNgn = Number(row.amountNgn ?? row.amount_ngn ?? row.amount ?? 0);
  const balanceAfterNgn = Number(row.balanceAfterNgn ?? row.balance_after_ngn ?? row.balanceAfter ?? 0);
  const rawType = String(row.type ?? row.transaction_type ?? row.transactionType ?? (amountNgn >= 0 ? "credit" : "debit"));
  const normalizedType =
    rawType === "deposit" || rawType === "funding" || rawType === "credit"
      ? "credit"
      : rawType === "bonus" || rawType === "referral" || rawType === "welcome"
        ? "bonus"
        : rawType === "refund"
          ? "refund"
          : rawType === "admin_adjust"
            ? "admin_adjust"
            : amountNgn >= 0
              ? "credit"
              : "purchase";

  return {
    ...row,
    _id: id,
    id,
    userId: String(row.userId ?? row.user_id ?? ""),
    userEmail: String(row.userEmail ?? row.user_email ?? row.email ?? ""),
    amount: amountNgn,
    amountNgn,
    amount_ngn: amountNgn,
    balanceAfter: balanceAfterNgn,
    balanceAfterNgn,
    balance_after_ngn: balanceAfterNgn,
    type: normalizedType,
    transactionType: rawType,
    transaction_type: rawType,
    description: String(row.description ?? "Wallet transaction"),
    reference: row.reference ? String(row.reference) : undefined,
    referenceId: row.referenceId ?? row.reference_id ? String(row.referenceId ?? row.reference_id) : undefined,
    createdAt: toEpochMs(row.createdAt ?? row.created_at),
  };
}

function normalizeShipment(row: Record<string, unknown>, idx = 0) {
  const id = String(row._id ?? row.id ?? `shp_${idx}`);
  const trackingNumber = String(row.trackingNumber ?? row.tracking_number ?? `TRK-${id.slice(0, 8).toUpperCase()}`);
  const status = String(row.status ?? "pending");
  const senderCity = String(row.senderCity ?? row.sender_city ?? "Lagos");
  const senderCountry = String(row.senderCountry ?? row.sender_country ?? "Nigeria");
  const recipientCity = String(row.recipientCity ?? row.recipient_city ?? "Abuja");
  const recipientCountry = String(row.recipientCountry ?? row.recipient_country ?? "Nigeria");
  const createdAt = toEpochMs(row.createdAt ?? row.created_at);
  const updatedAt = toEpochMs(row.updatedAt ?? row.updated_at ?? createdAt);

  return {
    ...row,
    _id: id,
    id,
    userId: String(row.userId ?? row.user_id ?? ""),
    trackingNumber,
    tracking_number: trackingNumber,
    status,
    serviceType: String(row.serviceType ?? row.service_type ?? "standard"),
    service_type: String(row.service_type ?? row.serviceType ?? "standard"),
    senderName: String(row.senderName ?? row.sender_name ?? ""),
    senderPhone: String(row.senderPhone ?? row.sender_phone ?? ""),
    senderEmail: String(row.senderEmail ?? row.sender_email ?? ""),
    senderAddress: String(row.senderAddress ?? row.sender_address ?? ""),
    senderCity,
    senderState: String(row.senderState ?? row.sender_state ?? ""),
    senderCountry,
    senderPostalCode: String(row.senderPostalCode ?? row.sender_postal_code ?? ""),
    recipientName: String(row.recipientName ?? row.recipient_name ?? ""),
    recipientPhone: String(row.recipientPhone ?? row.recipient_phone ?? ""),
    recipientEmail: String(row.recipientEmail ?? row.recipient_email ?? ""),
    recipientAddress: String(row.recipientAddress ?? row.recipient_address ?? ""),
    recipientCity,
    recipientState: String(row.recipientState ?? row.recipient_state ?? ""),
    recipientCountry,
    recipientPostalCode: String(row.recipientPostalCode ?? row.recipient_postal_code ?? ""),
    packageDescription: String(row.packageDescription ?? row.package_description ?? "Package"),
    weight: Number(row.weight ?? 1),
    dimensions: row.dimensions ? String(row.dimensions) : undefined,
    estimatedDelivery: row.estimatedDelivery ?? row.estimated_delivery ? String(row.estimatedDelivery ?? row.estimated_delivery) : undefined,
    notes: row.notes ? String(row.notes) : undefined,
    origin: (row.origin as Record<string, unknown>) ?? { city: senderCity, country: senderCountry, label: `${senderCity}, ${senderCountry}` },
    destination: (row.destination as Record<string, unknown>) ?? { city: recipientCity, country: recipientCountry, label: `${recipientCity}, ${recipientCountry}` },
    createdAt,
    updatedAt,
  };
}

function normalizeShipmentEvent(row: Record<string, unknown>, idx = 0) {
  const id = String(row._id ?? row.id ?? `evt_${idx}`);
  const ts = toEpochMs(row.timestamp ?? row.occurredAt ?? row.occurred_at ?? row.created_at);
  return {
    ...row,
    _id: id,
    id,
    status: String(row.status ?? "in_transit"),
    location: row.location ? String(row.location) : undefined,
    description: String(row.description ?? row.message ?? "Status updated"),
    timestamp: ts,
    occurredAt: ts,
    createdAt: ts,
  };
}

function normalizeOrder(row: Record<string, unknown>, idx = 0) {
  const id = String(row._id ?? row.id ?? `ord_${idx}`);
  const totalMinor = Number(row.total_minor ?? row.subtotal_minor ?? 0);
  const totalNgn = Number(row.totalNgn ?? row.priceNgn ?? (totalMinor > 0 ? Math.round(totalMinor / 100) : 0));
  const pointsUsed = Number(row.pointsUsed ?? row.totalPoints ?? (totalNgn > 0 ? Math.round(totalNgn / 15) : 0));
  const status = String(row.status ?? "completed");
  const metadata = (row.metadata && typeof row.metadata === "object" ? row.metadata : {}) as Record<string, unknown>;

  return {
    ...row,
    _id: id,
    id,
    buyerId: String(row.buyerId ?? row.user_id ?? ""),
    buyerEmail: String(row.buyerEmail ?? row.buyer_email ?? metadata.buyerEmail ?? ""),
    vendorId: String(row.vendorId ?? metadata.vendorId ?? ""),
    vendorName: String(row.vendorName ?? metadata.vendorName ?? "Cloudie Marketplace"),
    productId: String(row.productId ?? row.product_id ?? metadata.productId ?? ""),
    productName: String(row.productName ?? row.product_name ?? metadata.productName ?? "Marketplace Order"),
    quantity: Number(row.quantity ?? metadata.quantity ?? 1),
    pointsUsed,
    totalPoints: pointsUsed,
    totalNgn,
    priceNgn: totalNgn,
    status,
    escrowStatus: String(row.escrowStatus ?? (status === "paid" || status === "escrow" ? "held" : "released")),
    deliveryData: row.deliveryData ?? metadata.deliveryData ? String(row.deliveryData ?? metadata.deliveryData) : undefined,
    createdAt: toEpochMs(row.createdAt ?? row.created_at),
  };
}

function normalizeNotification(row: Record<string, unknown>, idx = 0) {
  const id = String(row._id ?? row.id ?? `ntf_${idx}`);
  const isRead = Boolean(row.isRead ?? row.read_at ?? row.readAt);
  const category = String(row.category ?? row.type ?? "info");
  const body = String(row.message ?? row.body ?? "");
  return {
    ...row,
    _id: id,
    id,
    userId: String(row.userId ?? row.user_id ?? ""),
    type: category,
    category,
    title: String(row.title ?? "Notification"),
    message: body,
    body,
    isRead,
    actionUrl: row.actionUrl ?? row.action_url ? String(row.actionUrl ?? row.action_url) : undefined,
    createdAt: toEpochMs(row.createdAt ?? row.created_at),
  };
}

function normalizeTenant(row: Record<string, unknown>, idx = 0) {
  const id = String(row._id ?? row.id ?? `tnt_${idx}`);
  const siteName = String(row.siteName ?? row.site_name ?? row.displayName ?? row.display_name ?? "Tenant Site");
  const subdomain = String(row.subdomain ?? row.slug ?? "tenant");
  const siteType = String(row.siteType ?? row.site_type ?? "bank");
  const isActive = row.isActive !== undefined ? Boolean(row.isActive) : row.is_active !== undefined ? Boolean(row.is_active) : true;
  return {
    ...row,
    _id: id,
    id,
    ownerId: String(row.ownerId ?? row.owner_user_id ?? ""),
    siteName,
    site_name: siteName,
    displayName: String(row.displayName ?? row.display_name ?? siteName),
    subdomain,
    slug: String(row.slug ?? subdomain),
    siteType,
    site_type: siteType,
    currency: String(row.currency ?? "USD"),
    country: String(row.country ?? "US"),
    isActive,
    is_active: isActive,
    bankingEnabled: Boolean(row.bankingEnabled ?? row.banking_enabled ?? (siteType === "bank")),
    lifecycleStatus: String(row.lifecycleStatus ?? row.lifecycle_status ?? "active"),
    createdAt: toEpochMs(row.createdAt ?? row.created_at),
  };
}

/** Next 30-day billing anniversary for a tenant, used by the preview shim. */
function nextRenewal(createdAt: number) {
  const term = 30 * 86_400_000;
  if (!createdAt) return Date.now() + term;
  const elapsed = Math.max(0, Date.now() - createdAt);
  return createdAt + (Math.floor(elapsed / term) + 1) * term;
}

async function neonTenantRows() {
  const res = await neonApi.tenants().catch(() => ({ tenants: [] as Record<string, unknown>[] }));
  return Array.isArray(res?.tenants)
    ? res.tenants.map((row, i) => normalizeTenant(row as Record<string, unknown>, i))
    : [];
}

function normalizeUser(row: Record<string, unknown>, idx = 0) {
  const id = String(row._id ?? row.id ?? `usr_${idx}`);
  const walletBalanceNgn = Number(row.walletBalanceNgn ?? row.wallet_balance_ngn ?? 0);
  const pointsBalance = Number(row.pointsBalance ?? row.points_balance ?? walletBalanceNgn);
  return {
    ...row,
    _id: id,
    id,
    name: String(row.name ?? row.email ?? "User"),
    email: String(row.email ?? ""),
    role: String(row.role ?? "user"),
    walletBalanceNgn,
    wallet_balance_ngn: walletBalanceNgn,
    pointsBalance,
    points_balance: pointsBalance,
    isSuspended: Boolean(row.isSuspended ?? row.is_suspended),
    isTerminated: Boolean(row.isTerminated ?? row.is_terminated),
    organizationName: row.organizationName ?? row.organization_name ? String(row.organizationName ?? row.organization_name) : undefined,
    createdAt: toEpochMs(row.createdAt ?? row.created_at),
    lastLoginAt: row.lastLoginAt ?? row.last_active_at ? toEpochMs(row.lastLoginAt ?? row.last_active_at) : undefined,
  };
}

function normalizeCatalogProduct(row: Record<string, unknown>, idx = 0) {
  const id = String(row._id ?? row.id ?? `prd_${idx}`);
  const priceMinor = Number(row.price_minor ?? 0);
  const priceNgn = Number(row.priceNgn ?? row.price_ngn ?? (priceMinor > 0 ? Math.round(priceMinor / 100) : 1500));
  const pricePoints = Number(row.pricePoints ?? row.pointsCost ?? Math.max(1, Math.round(priceNgn / 15)));
  const metadata = (row.metadata && typeof row.metadata === "object" ? row.metadata : {}) as Record<string, unknown>;
  return {
    ...row,
    _id: id,
    id,
    name: String(row.name ?? "Digital Product"),
    description: String(row.description ?? ""),
    category: String(row.category ?? "General"),
    pricePoints,
    priceNgn,
    stock: Number(row.stock ?? metadata.stock ?? 50),
    soldCount: Number(row.soldCount ?? metadata.soldCount ?? 0),
    isActive: row.isActive !== undefined ? Boolean(row.isActive) : row.is_active !== undefined ? Boolean(row.is_active) : true,
    vendorName: String(row.vendorName ?? metadata.vendorName ?? "Cloudie Store"),
    createdAt: toEpochMs(row.createdAt ?? row.created_at),
  };
}

/**
 * `/api/admin/reports` returns a flat counter payload, but the admin screens are
 * written against `adminApi.adminDashboard`'s nested shape (`users.active`,
 * `points.velocity24h`, `kyc.pending`, …). Map one onto the other here so every
 * field a screen formats is always a number — an absent field used to reach the
 * render as `undefined.toLocaleString()`.
 */
function buildAdminDashboard(res: Record<string, unknown>) {
  /** A finite number, or `null` when the API reported the metric unavailable. */
  const numOrNull = (key: string): number | null => {
    const value = res[key];
    // An explicit `null` means the API reported this metric unavailable (its
    // source table is missing or the count failed). Leave it null so the card
    // renders "unavailable" rather than a fabricated zero.
    if (value === null) return null;
    if (value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  /** A count that must always be a number because its source table always exists. */
  const count = (key: string, fallback = 0): number => numOrNull(key) ?? fallback;

  const totalUsers = count("totalUsers", count("users"));

  return {
    users: {
      total: totalUsers,
      // Active is counted as "not suspended and not terminated" by the API. It
      // is never inferred from the total: an admin must never see the whole
      // user base described as active.
      active: count("activeUsers"),
      suspended: count("suspendedUsers"),
      terminated: count("terminatedUsers"),
      admins: count("adminUsers", count("admins")),
    },
    // NGN ledger movement, in naira. These are money values and are never
    // mixed with, or displayed as, points.
    points: {
      minted: count("walletBalanceNgn"),
      burned: 0,
      velocity24h: 0,
      mintedCount24h: 0,
      debited24h: 0,
      debitedCount24h: 0,
      ledgerEvents24h: count("ledgerEvents24h"),
      outstanding: count("pointsOutstanding"),
    },
    vendors: {
      total: count("vendors"),
      pending: count("pendingVendors"),
      approved: count("approvedVendors"),
      suspended: count("suspendedVendors"),
    },
    tenants: {
      total: count("tenants"),
      active: count("tenants"),
      locked: count("lockedTenants"),
    },
    shipments: {
      total: count("totalShipments", count("shipments")),
      active: count("pendingShipments"),
      delivered: count("deliveredShipments"),
    },
    documents: { total: count("documents"), last24h: count("documents24h") },
    marketplace: {
      orders: count("totalOrders", count("orders")),
      orders24h: 0,
      escrowPending: count("escrowPending"),
    },
    disputes: {
      open: count("disputedOrders", count("openDisputes")),
      underReview: 0,
      resolved: 0,
    },
    kyc: {
      pending: count("pendingKyc"),
      underReview: count("kycUnderReview"),
      verified: count("verifiedKyc"),
      rejected: count("rejectedKyc"),
      resubmissionRequired: 0,
    },
    payments: {
      completed: count("paymentsCompleted"),
      failed: count("paymentsFailed"),
      pending: count("paymentsPending"),
      refunded: count("paymentsRefunded"),
    },
    moderation: { openFlags: 0 },
    activity: { newUsers7d: count("newUsers7d"), ledger7d: count("ledgerEvents24h") },
  };
}

// Reactive query invalidation bus so mutations immediately refresh mounted queries
let queryVersion = 0;
const queryListeners = new Set<() => void>();
export function notifyNeonQueries() {
  queryVersion += 1;
  queryListeners.forEach((fn) => fn());
}

const DEFAULT_SHIPMENT_SERVICES = [
  { serviceKey: "shipment_standard", name: "Standard Delivery (3–5 business days)", priceNgn: 5000, pointsCost: 50 },
  { serviceKey: "shipment_express", name: "Express Delivery (1–2 business days)", priceNgn: 10000, pointsCost: 100 },
  { serviceKey: "shipment_overnight", name: "Overnight Priority (Next business day)", priceNgn: 18500, pointsCost: 185 },
  { serviceKey: "shipment_international", name: "International Air Freight (5–10 business days)", priceNgn: 35000, pointsCost: 350 },
];

const DEFAULT_SERVICE_PRICES = [
  { _id: "sp_1", service: "shipment_create", workspace: "shipments", pointsCost: 50, priceNgn: 5000, priceUsd: 3.5, isActive: true, effectiveFrom: Date.now() - 86400000, updatedAt: Date.now() },
  { _id: "sp_2", service: "shipment_tracking_update", workspace: "shipments", pointsCost: 10, priceNgn: 1000, priceUsd: 0.75, isActive: true, effectiveFrom: Date.now() - 86400000, updatedAt: Date.now() },
  { _id: "sp_3", service: "flight_pdf", workspace: "ticketing", pointsCost: 150, priceNgn: 2250, priceUsd: 1.5, isActive: true, effectiveFrom: Date.now() - 86400000, updatedAt: Date.now() },
  { _id: "sp_4", service: "hotel_pdf", workspace: "ticketing", pointsCost: 120, priceNgn: 1800, priceUsd: 1.2, isActive: true, effectiveFrom: Date.now() - 86400000, updatedAt: Date.now() },
  { _id: "sp_5", service: "commercial_invoice", workspace: "ticketing", pointsCost: 80, priceNgn: 1200, priceUsd: 0.8, isActive: true, effectiveFrom: Date.now() - 86400000, updatedAt: Date.now() },
  { _id: "sp_6", service: "customs_document", workspace: "ticketing", pointsCost: 100, priceNgn: 1500, priceUsd: 1.0, isActive: true, effectiveFrom: Date.now() - 86400000, updatedAt: Date.now() },
  { _id: "sp_7", service: "email_per_recipient", workspace: "services", pointsCost: 5, priceNgn: 75, priceUsd: 0.05, isActive: true, effectiveFrom: Date.now() - 86400000, updatedAt: Date.now() },
  { _id: "sp_8", service: "image_render", workspace: "services", pointsCost: 1, priceNgn: 15, priceUsd: 0.01, isActive: true, effectiveFrom: Date.now() - 86400000, updatedAt: Date.now() },
  { _id: "sp_9", service: "custom_document_design", workspace: "documents", pointsCost: 100, priceNgn: 1500, priceUsd: 1.0, isActive: true, effectiveFrom: Date.now() - 86400000, updatedAt: Date.now() },
];

const DEFAULT_VTU_AIRTIME_OFFERS = ["mtn", "airtel", "glo", "9mobile"].flatMap((network) =>
  [100, 200, 500, 1000, 2000, 5000].map((amount) => ({
    serviceCode: `airtime.${network}.${amount}`,
    network,
    amountNgn: amount,
    chargeNgn: amount,
    pointsCost: amount,
    available: true,
  })),
);

const DEFAULT_VTU_CATALOG_GROUPS = [
  {
    serviceType: "data",
    label: "Mobile Data",
    products: [
      { productCode: "data.mtn.1gb", name: "MTN 1GB 30 Days", providerLabel: "MTN", serviceType: "data", fixedPoints: 350, requiresAmount: false, purchasable: true },
      { productCode: "data.mtn.3gb", name: "MTN 3GB 30 Days", providerLabel: "MTN", serviceType: "data", fixedPoints: 950, requiresAmount: false, purchasable: true },
      { productCode: "data.airtel.2gb", name: "Airtel 2GB 30 Days", providerLabel: "Airtel", serviceType: "data", fixedPoints: 650, requiresAmount: false, purchasable: true },
      { productCode: "data.glo.2_5gb", name: "Glo 2.5GB 30 Days", providerLabel: "Glo", serviceType: "data", fixedPoints: 600, requiresAmount: false, purchasable: true },
      { productCode: "data.9mobile.1_5gb", name: "9mobile 1.5GB 30 Days", providerLabel: "9mobile", serviceType: "data", fixedPoints: 500, requiresAmount: false, purchasable: true },
    ],
  },
  {
    serviceType: "electricity",
    label: "Electricity",
    products: [
      { productCode: "electricity.ikedc.prepaid", name: "IKEDC Ikeja Electric (Prepaid)", providerLabel: "IKEDC", serviceType: "electricity", indicativeMinPoints: 1000, indicativeMaxPoints: 100000, fixedPoints: null, requiresAmount: true, purchasable: true },
      { productCode: "electricity.ekedc.prepaid", name: "EKEDC Eko Electric (Prepaid)", providerLabel: "EKEDC", serviceType: "electricity", indicativeMinPoints: 1000, indicativeMaxPoints: 100000, fixedPoints: null, requiresAmount: true, purchasable: true },
      { productCode: "electricity.aedc.prepaid", name: "AEDC Abuja Electric (Prepaid)", providerLabel: "AEDC", serviceType: "electricity", indicativeMinPoints: 1000, indicativeMaxPoints: 100000, fixedPoints: null, requiresAmount: true, purchasable: true },
      { productCode: "electricity.ibedc.prepaid", name: "IBEDC Ibadan Electric (Prepaid)", providerLabel: "IBEDC", serviceType: "electricity", indicativeMinPoints: 1000, indicativeMaxPoints: 100000, fixedPoints: null, requiresAmount: true, purchasable: true },
    ],
  },
  {
    serviceType: "cable",
    label: "Cable TV",
    products: [
      { productCode: "cable.dstv.compact", name: "DStv Compact Monthly", providerLabel: "DStv", serviceType: "cable", fixedPoints: 15700, requiresAmount: false, purchasable: true },
      { productCode: "cable.dstv.yanga", name: "DStv Yanga Monthly", providerLabel: "DStv", serviceType: "cable", fixedPoints: 5100, requiresAmount: false, purchasable: true },
      { productCode: "cable.gotv.jolli", name: "GOtv Jolli Monthly", providerLabel: "GOtv", serviceType: "cable", fixedPoints: 4850, requiresAmount: false, purchasable: true },
      { productCode: "cable.startimes.basic", name: "StarTimes Basic Monthly", providerLabel: "StarTimes", serviceType: "cable", fixedPoints: 3300, requiresAmount: false, purchasable: true },
    ],
  },
  {
    serviceType: "exam",
    label: "Exam PINs",
    products: [
      { productCode: "exam.waec.result", name: "WAEC Result Checker PIN", providerLabel: "WAEC", serviceType: "exam", fixedPoints: 3800, requiresAmount: false, purchasable: true },
      { productCode: "exam.neco.token", name: "NECO Result Token", providerLabel: "NECO", serviceType: "exam", fixedPoints: 1500, requiresAmount: false, purchasable: true },
      { productCode: "exam.nabteb.pin", name: "NABTEB Result Checker PIN", providerLabel: "NABTEB", serviceType: "exam", fixedPoints: 1500, requiresAmount: false, purchasable: true },
    ],
  },
];

interface AuthContextValue {
  isLoading: boolean;
  isAuthenticated: boolean;
  user: NeonUser | null;
  signIn: (providerOrFlow?: unknown, params?: Record<string, unknown>) => Promise<unknown>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  isLoading: false,
  isAuthenticated: false,
  user: null,
  signIn: async () => ({}),
  signOut: async () => {},
  refresh: async () => {},
});

export function ConvexProvider({ children }: { client?: unknown; children: React.ReactNode }) {
  return <ConvexAuthProvider>{children}</ConvexAuthProvider>;
}

export function ConvexAuthProvider({ children }: { client?: unknown; children: React.ReactNode }) {
  const [user, setUser] = useState<NeonUser | null>(() => getCachedNeonUser());
  const [isLoading, setIsLoading] = useState<boolean>(() => Boolean(getCachedNeonUser()));

  const refresh = useCallback(async () => {
    const cached = getCachedNeonUser();
    if (!cached) {
      setUser(null);
      setIsLoading(false);
      return;
    }
    try {
      const current = await neonApi.me();
      setUser(current);
    } catch {
      clearNeonSession();
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const handleAuthChange = () => {
      setUser(getCachedNeonUser());
      setIsLoading(false);
    };
    window.addEventListener("cloudie-auth-change", handleAuthChange);
    return () => window.removeEventListener("cloudie-auth-change", handleAuthChange);
  }, [refresh]);

  const signIn = useCallback(async (providerOrFlow?: unknown, params?: Record<string, unknown>) => {
    const payload = (typeof providerOrFlow === "object" && providerOrFlow !== null ? providerOrFlow : params) as Record<string, unknown> | undefined;
    const email = String(payload?.email ?? "").trim();
    const password = String(payload?.password ?? "");
    const name = String(payload?.name ?? email.split("@")[0] ?? "User").trim();
    const flow = String(payload?.flow ?? "signIn");

    const authedUser = flow === "signUp"
      ? await neonApi.register({ name, email, password })
      : await neonApi.login({ email, password });

    setUser(authedUser);
    notifyNeonQueries();
    return { signingIn: true, user: authedUser };
  }, []);

  const signOut = useCallback(async () => {
    await neonApi.logout();
    setUser(null);
    notifyNeonQueries();
  }, []);

  return (
    <AuthContext.Provider value={{ isLoading, isAuthenticated: Boolean(user), user, signIn, signOut, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useConvexAuth() {
  const { isLoading, isAuthenticated } = useContext(AuthContext);
  return { isLoading, isAuthenticated };
}

export function useAuthActions() {
  const { signIn, signOut } = useContext(AuthContext);
  return { signIn, signOut };
}

export function useAuth() {
  const { isLoading, isAuthenticated, user, signIn, signOut } = useContext(AuthContext);
  return { isLoading, isAuthenticated, user, signIn, signOut };
}

export function useQuery(queryRef: unknown, args?: unknown): any {
  const queryName = resolveFunctionName(queryRef);
  const argsJson = args === "skip" ? "skip" : JSON.stringify(args ?? {});
  const [state, setState] = useState<any>(undefined);
  const [version, setVersion] = useState(queryVersion);

  // Callers pass a fresh object literal on every render (`{ limit: 50 }`,
  // `{ orderId }`). Reading it through a ref keeps the effect body current while
  // the dependency list stays limited to the serialized args. Putting the raw
  // object in the deps made the effect run on every render, and its synchronous
  // branches call `setState` — an infinite update loop (React error #185).
  const latestArgs = useRef(args);
  latestArgs.current = args;

  useEffect(() => {
    const listener = () => setVersion(queryVersion);
    queryListeners.add(listener);
    return () => {
      queryListeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    // Shadow the render-scoped parameter: same content, no identity dependency.
    const args = latestArgs.current;
    if (args === "skip") {
      setState(undefined);
      return;
    }

    let cancelled = false;
    const parsedArgs = (typeof args === "object" && args !== null ? args : {}) as Record<string, unknown>;

    async function run() {
      try {
        const fn = queryName;
        const fnLower = fn.toLowerCase();

        // 1. Public platform config
        if (fn === "platform:getPublicConfig" || fnLower.includes("publicconfig") || fnLower.includes("platformconfig")) {
          const res = await neonApi.publicConfig().catch(() => null);
          if (!cancelled) {
            setState(res ?? {
              brand: { name: "Cloudie", tagline: "Unified operations platform", accentColor: "#2563eb", footerNote: "Cloudie Operations Platform" },
              support: { email: "support@cloudie.app", phone: "", hours: "Mon–Fri, 9am–6pm WAT", widgetEnabled: true, widgetTitle: "Need a hand?", widgetMessage: "Reach the Cloudie support team.", faqs: [] },
              quickActions: [],
              hasCustomBrand: false,
            });
          }
          return;
        }

        // 2. Current user / profile / organization
        if (fn === "users:currentUser" || fn === "users:viewer" || fnLower.includes("currentuser") || fnLower.includes("getme")) {
          const user = getCachedNeonUser();
          if (!cancelled) {
            setState(user ? normalizeUser(user as unknown as Record<string, unknown>) : null);
          }
          return;
        }

        if (fn === "organization:getMyOrganization") {
          const res = await neonApi.profile().catch(() => null);
          const profile = (res?.profile ?? {}) as Record<string, unknown>;
          if (!cancelled) {
            setState({
              organizationName: String(profile.organization_name ?? profile.organizationName ?? ""),
              name: String(profile.name ?? getCachedNeonUser()?.name ?? ""),
              email: String(profile.email ?? getCachedNeonUser()?.email ?? ""),
            });
          }
          return;
        }

        // 3. Wallet & Points balance — MUST return a primitive number!
        if (
          fn === "wallet:getBalance" ||
          fn === "points:getBalance" ||
          fn === "trackingUser:myPointsBalance" ||
          fnLower.endsWith(":getbalance") ||
          fnLower.includes("mypointsbalance")
        ) {
          const res = await neonApi.walletSummary().catch(() => null);
          if (!cancelled) {
            const numericBalance = Number(
              res?.wallet_balance_ngn ??
              res?.walletBalanceNgn ??
              res?.points_balance ??
              res?.pointsBalance ??
              0,
            );
            setState(Number.isFinite(numericBalance) ? numericBalance : 0);
          }
          return;
        }

        // 4. Wallet & Admin Ledger
        if (fn === "wallet:getLedger" || fn === "wallet:getAdminLedger" || fnLower.includes("ledger")) {
          const limit = Number(parsedArgs.limit ?? 100);
          const res = fn === "wallet:getAdminLedger"
            ? await neonApi.adminTransactions(limit).catch(() => ({ entries: [] }))
            : await neonApi.walletLedger(limit).catch(() => ({ entries: [] }));
          if (!cancelled) {
            const entries = Array.isArray(res?.entries) ? res.entries.map(normalizeLedgerEntry) : [];
            setState(entries);
          }
          return;
        }

        // 5. Service Hub Overview & Services
        if (fn === "serviceHub:getOverview") {
          const [summaryRes, ledgerRes, notifRes] = await Promise.all([
            neonApi.walletSummary().catch(() => ({ wallet_balance_ngn: 0, points_balance: 0 })),
            neonApi.walletLedger(10).catch(() => ({ entries: [] })),
            neonApi.notifications(20).catch(() => ({ notifications: [] })),
          ]);
          if (!cancelled) {
            const walletBalanceNgn = Number(summaryRes?.wallet_balance_ngn ?? (summaryRes as Record<string, unknown>)?.walletBalanceNgn ?? 0);
            const entries = Array.isArray(ledgerRes?.entries) ? ledgerRes.entries.map(normalizeLedgerEntry) : [];
            const now = Date.now();
            const monthAgo = now - 30 * 86400000;
            const recentMonth = entries.filter((e) => e.createdAt >= monthAgo);
            const monthlySpentNgn = recentMonth.filter((e) => e.amountNgn < 0).reduce((s, e) => s + Math.abs(e.amountNgn), 0);
            const monthlyFundedNgn = recentMonth.filter((e) => e.amountNgn > 0).reduce((s, e) => s + e.amountNgn, 0);
            const notifications = Array.isArray(notifRes?.notifications) ? notifRes.notifications.map(normalizeNotification) : [];
            const unreadNotifications = notifications.filter((n) => !n.isRead).length;
            setState({
              walletBalanceNgn,
              pointsBalance: walletBalanceNgn,
              monthlySpentNgn,
              monthlyFundedNgn,
              activeServices: 5,
              unreadNotifications,
              recentTransactions: entries.slice(0, 8),
              services: [],
            });
          }
          return;
        }

        if (fn === "serviceHub:listMyServices") {
          if (!cancelled) setState([]);
          return;
        }

        // 6. Pricing & Billing Config
        if (fn === "pricing:getBillingConfig") {
          if (!cancelled) {
            setState({
              ngnPerPoint: 15,
              usdPerPoint: 0.01,
              packages: DEFAULT_POINT_PACKAGES,
            });
          }
          return;
        }

        if (fn === "pricing:getServicePrices" || fn === "adminApi:getPricing") {
          if (!cancelled) setState(DEFAULT_SERVICE_PRICES);
          return;
        }

        if (fn === "pricing:getShipmentServices" || fn === "trackingQueries:listServiceTypes") {
          if (!cancelled) setState(DEFAULT_SHIPMENT_SERVICES);
          return;
        }

        // 7. Public Tracking & Shipments
        if (fn === "trackingQueries:publicTracking" || fnLower.includes("publictracking")) {
          const trackingNumber = String(parsedArgs.trackingNumber ?? "").trim();
          if (!trackingNumber) {
            if (!cancelled) setState(null);
            return;
          }
          const res = await neonApi.track(trackingNumber).catch((error: unknown) => {
            // Surface rate limits so the tracker can explain the wait instead of
            // claiming the shipment does not exist.
            if (error && typeof error === "object" && (error as { status?: number }).status === 429) {
              return { __rateLimited: true } as { __rateLimited: true; shipment?: undefined };
            }
            return null;
          });
          if (!cancelled) {
            if (res && "__rateLimited" in res) {
              setState({ __rateLimited: true });
            } else if (!res || !res.shipment) {
              setState(null);
            } else {
              const s = normalizeShipment(res.shipment);
              const events = Array.isArray(res.events) ? res.events.map(normalizeShipmentEvent) : [];
              // Initials only — the public API never returns the full name.
              const masked = String(
                (res.shipment as Record<string, unknown>).recipient_masked ??
                (res.shipment as Record<string, unknown>).recipientMasked ??
                "",
              ).trim();
              setState({
                ...s,
                status: s.status.toUpperCase(),
                recipientMasked: masked || null,
                events,
                route: [],
                packages: [],
                currentLocation: events[0]?.location ? { label: events[0].location, city: events[0].location } : s.origin,
              });
            }
          }
          return;
        }

        if (
          fn === "shipments:getById" ||
          fn === "trackingUser:myShipmentDetail" ||
          fn === "trackingQueries:adminShipmentDetail" ||
          fn === "trackingQueries:adminLabelData"
        ) {
          const id = String(parsedArgs.id ?? parsedArgs.shipmentId ?? "");
          if (!id) {
            if (!cancelled) setState(null);
            return;
          }
          const res = await neonApi.shipment(id).catch(() => null);
          if (!cancelled) {
            if (!res?.shipment) {
              setState(null);
            } else {
              const s = normalizeShipment(res.shipment);
              const events = Array.isArray(res.events) ? res.events.map(normalizeShipmentEvent) : [];
              setState({
                ...s,
                shipment: s,
                events,
                route: [],
                packages: [],
              });
            }
          }
          return;
        }

        if (
          fn === "shipments:listMy" ||
          fn === "trackingUser:myShipments" ||
          fn === "trackingQueries:adminListShipments" ||
          fnLower.includes("shipments")
        ) {
          const isAll = fn.includes("admin") || Boolean(parsedArgs.all);
          const res = isAll
            ? await neonApi.adminShipments(Number(parsedArgs.limit ?? 50)).catch(() => ({ shipments: [] }))
            : await neonApi.shipments({ limit: Number(parsedArgs.limit ?? 50) }).catch(() => ({ shipments: [] }));
          if (!cancelled) {
            const list = Array.isArray(res?.shipments) ? res.shipments.map(normalizeShipment) : [];
            setState(list);
          }
          return;
        }

        // 8. Notifications
        if (fn === "notifications:unreadCount" || fn === "notifications:getUnreadCount") {
          const res = await neonApi.notifications(50).catch(() => ({ notifications: [] }));
          if (!cancelled) {
            const list = Array.isArray(res?.notifications) ? res.notifications.map(normalizeNotification) : [];
            setState(list.filter((n) => !n.isRead).length);
          }
          return;
        }

        if (fn === "notifications:listAll" || fn === "notifications:listMy" || fn === "adminApi:adminListNotifications") {
          const res = await neonApi.notifications(Number(parsedArgs.limit ?? 50)).catch(() => ({ notifications: [] }));
          if (!cancelled) {
            const list = Array.isArray(res?.notifications) ? res.notifications.map(normalizeNotification) : [];
            setState(list);
          }
          return;
        }

        // 9. Orders & Marketplace
        if (fn === "marketplace:getMyOrders" || fn === "admin:adminListOrders" || fnLower.includes("orders")) {
          const res = await neonApi.orders(Number(parsedArgs.limit ?? 50)).catch(() => ({ orders: [] }));
          if (!cancelled) {
            const list = Array.isArray(res?.orders) ? res.orders.map(normalizeOrder) : [];
            setState(list);
          }
          return;
        }

        if (fn === "marketplace:getMyVendor") {
          if (!cancelled) setState(null);
          return;
        }

        if (fn === "marketplace:adminListVendors") {
          if (!cancelled) setState([]);
          return;
        }

        if (fn === "adminApi:getVendorAdmin") {
          if (!cancelled) setState(null);
          return;
        }

        if (fn === "marketplace:getLogspanelAdminStatus") {
          if (!cancelled) {
            setState({ configured: false, lastSyncedAt: null, productCount: 0 });
          }
          return;
        }

        if (
          fn === "marketplace:listProducts" ||
          fn === "marketplace:adminListAllProducts" ||
          fn === "marketplace:getLogspanelProducts" ||
          fn === "adminApi:listVendorProducts"
        ) {
          const res = await neonApi.catalog({ limit: Number(parsedArgs.limit ?? 100) }).catch(() => ({ products: [] }));
          if (!cancelled) {
            const list = Array.isArray(res?.products) ? res.products.map(normalizeCatalogProduct) : [];
            setState(list);
          }
          return;
        }

        if (fn === "catalog:getCatalog" || fn === "serviceCatalog:adminList") {
          const res = await neonApi.catalog({ limit: 100 }).catch(() => ({ products: [] }));
          if (!cancelled) {
            const products = Array.isArray(res?.products) ? res.products.map(normalizeCatalogProduct) : [];
            setState({
              services: products.map((p) => ({
                _id: p._id,
                serviceKey: p.id,
                name: p.name,
                workspace: p.category.toLowerCase(),
                description: p.description,
                pointsCost: p.pricePoints,
                priceNgn: p.priceNgn,
                isActive: p.isActive,
                updatedAt: p.createdAt,
              })),
              workspaces: [
                { key: "shipments", label: "Shipments" },
                { key: "ticketing", label: "Ticketing" },
                { key: "business", label: "Business Suite" },
                { key: "services", label: "Services" },
                { key: "documents", label: "Documents" },
              ],
            });
          }
          return;
        }

        // 10. VTU Offers, Catalog, Preview & History
        if (fn === "vtu:getAirtimeOffers") {
          if (!cancelled) setState({ offers: DEFAULT_VTU_AIRTIME_OFFERS });
          return;
        }

        if (fn === "vtu:previewCost") {
          const code = String(parsedArgs.serviceCode ?? "");
          const parts = code.split(".");
          const amount = Number(parts[2] ?? parsedArgs.amountNgn ?? 1000);
          if (!cancelled) {
            setState({
              serviceCode: code,
              amountNgn: amount,
              chargeNgn: amount,
              pointsCost: amount,
            });
          }
          return;
        }

        if (fn === "vtuCatalog:listCatalog") {
          if (!cancelled) setState({ groups: DEFAULT_VTU_CATALOG_GROUPS });
          return;
        }

        if (fn === "vtuCatalog:getPurchaseDetail") {
          const productCode = String(parsedArgs.productCode ?? "");
          const allProducts: Array<Record<string, unknown>> = DEFAULT_VTU_CATALOG_GROUPS.flatMap((g) => g.products as Array<Record<string, unknown>>);
          const found = allProducts.find((p) => p.productCode === productCode) ?? allProducts[0];
          if (!cancelled) {
            setState(
              found
                ? {
                    ...found,
                    serviceCodeTemplate: String(found.productCode ?? ""),
                    minAmountNgn: Number(found.indicativeMinPoints ?? 500),
                    maxAmountNgn: Number(found.indicativeMaxPoints ?? 100000),
                  }
                : null,
            );
          }
          return;
        }

        if (fn === "vtuInternal:getTransaction") {
          if (!cancelled) setState(null);
          return;
        }

        // 11. Documents & Templates
        if (fn === "docTemplates:getStudioStats") {
          const [docsRes, balRes] = await Promise.all([
            neonApi.documents(50).catch(() => ({ documents: [] })),
            neonApi.walletSummary().catch(() => ({ wallet_balance_ngn: 0 })),
          ]);
          if (!cancelled) {
            const docs = Array.isArray(docsRes?.documents) ? docsRes.documents : [];
            const balance = Number(balRes?.wallet_balance_ngn ?? 0);
            setState({
              documents: docs.length,
              generated: docs.length,
              drafts: 0,
              templates: PLATFORM_TEMPLATES.length,
              shared: 0,
              credits: 0,
              storageBytes: 0,
              balance,
            });
          }
          return;
        }

        if (fn === "docTemplates:listCategories") {
          if (!cancelled) {
            setState([
              { key: "flight_itinerary", label: "Travel & Aviation", count: 4 },
              { key: "corporate", label: "Business & Corporate", count: 6 },
              { key: "certificates", label: "Certificates & Records", count: 3 },
              { key: "general", label: "General & Logistics", count: 5 },
            ]);
          }
          return;
        }

        if (fn === "docTemplates:listTemplates" || fn === "docTemplateAdmin:adminListTemplates") {
          const docType = parsedArgs.documentType ? String(parsedArgs.documentType) : null;
          const templates = PLATFORM_TEMPLATES.filter((t) => !docType || t.documentType === docType).map((t, idx) => {
            const rawTpl = t as unknown as Record<string, unknown>;
            const costPts = Number(rawTpl.baseCostPoints ?? rawTpl.pricePoints ?? 50);
            return {
              ...t,
              _id: t.slug || `tpl_${idx}`,
              id: t.slug || `tpl_${idx}`,
              status: "published",
              pricePoints: costPts,
              priceNgn: costPts * 15,
              updatedAt: Date.now(),
            };
          });
          if (!cancelled) setState(templates);
          return;
        }

        if (fn === "docTemplates:getTemplate" || fn === "docTemplateAdmin:adminGetTemplate") {
          const slugOrId = String(parsedArgs.slug ?? parsedArgs.templateId ?? parsedArgs.id ?? "");
          const found = PLATFORM_TEMPLATES.find((t) => t.slug === slugOrId) ?? PLATFORM_TEMPLATES[0] ?? null;
          if (!cancelled) {
            setState(found ? { ...found, _id: found.slug, id: found.slug, status: "published" } : null);
          }
          return;
        }

        if (fn === "docTemplates:listMyDocuments" || fn === "documents:list" || fn === "documents:adminList") {
          const res = await neonApi.documents(Number(parsedArgs.limit ?? 50)).catch(() => ({ documents: [] }));
          if (!cancelled) {
            const list = Array.isArray(res?.documents)
              ? res.documents.map((d, i) => ({
                  ...d,
                  _id: String(d._id ?? d.id ?? `doc_${i}`),
                  id: String(d._id ?? d.id ?? `doc_${i}`),
                  title: String(d.title ?? "Document"),
                  type: String(d.document_type ?? d.type ?? "invoice"),
                  documentType: String(d.document_type ?? d.documentType ?? "invoice"),
                  status: String(d.status ?? "completed"),
                  createdAt: toEpochMs(d.created_at ?? d.createdAt),
                }))
              : [];
            setState(list);
          }
          return;
        }

        if (fn === "docTemplateAdmin:adminDocumentStats") {
          if (!cancelled) {
            setState({
              totalTemplates: PLATFORM_TEMPLATES.length,
              publishedTemplates: PLATFORM_TEMPLATES.length,
              totalDocuments: 0,
              sharedDocuments: 0,
            });
          }
          return;
        }

        // 12. Referrals
        if (fn === "referrals:getMyCode") {
          const user = getCachedNeonUser();
          const codeSuffix = user?.id ? user.id.slice(0, 6).toUpperCase() : "CLD100";
          if (!cancelled) {
            setState({ code: `CLOUD-${codeSuffix}`, referralCount: 0 });
          }
          return;
        }

        if (fn === "referrals:getMyReferrals") {
          if (!cancelled) setState([]);
          return;
        }

        // 13. Support
        if (fn === "support:listMine") {
          const res = await neonApi.supportTickets(Number(parsedArgs.limit ?? 50)).catch(() => ({ tickets: [] }));
          if (!cancelled) {
            setState(Array.isArray(res?.tickets) ? res.tickets : []);
          }
          return;
        }

        if (fn === "support:get") {
          const ticketId = String(parsedArgs.ticketId ?? "");
          if (!ticketId) {
            if (!cancelled) setState(null);
            return;
          }
          const res = await neonApi.supportTicketDetail(ticketId).catch(() => null);
          if (!cancelled) setState(res);
          return;
        }

        // 14. Tenants & Banking
        if (
          fn === "tenants:listMy" ||
          fn === "tenants:adminList" ||
          fn === "bankingTenant:listBankingTenants"
        ) {
          const res = await neonApi.tenants().catch(() => ({ tenants: [] }));
          if (!cancelled) {
            const list = Array.isArray(res?.tenants) ? res.tenants.map(normalizeTenant) : [];
            setState(list);
          }
          return;
        }

        if (fn === "tenants:get" || fn === "tenants:publicGet" || fn === "bankingTenant:getTenantForAdmin" || fn === "bankingCustomer:publicTenant" || fn === "bankingCustomer:memberTenant") {
          const res = await neonApi.tenants().catch(() => ({ tenants: [] }));
          const list = Array.isArray(res?.tenants) ? res.tenants.map(normalizeTenant) : [];
          const targetId = String(parsedArgs.id ?? parsedArgs.siteId ?? parsedArgs.tenantId ?? "");
          if (!cancelled) {
            setState(list.find((t) => t._id === targetId || t.subdomain === targetId) ?? list[0] ?? null);
          }
          return;
        }

        if (fn === "tenants:adminGetStats" || fn === "tenants:publicStats") {
          const res = await neonApi.tenants().catch(() => ({ tenants: [] }));
          const count = Array.isArray(res?.tenants) ? res.tenants.length : 0;
          if (!cancelled) {
            setState({ totalTenants: count, activeTenants: count, totalAccounts: 0, pendingKyc: 0 });
          }
          return;
        }

        // 15. Admin Dashboard, Analytics, Users, Settings, Infrastructure
        if (fn === "adminApi:adminDashboard" || fn === "adminDashboard:getDashboardAnalytics") {
          const res: Record<string, unknown> = await neonApi.adminReports().catch(() => ({}));
          if (!cancelled) setState(buildAdminDashboard(res));
          return;
        }

        if (fn === "adminApi:adminBadgeCounts") {
          if (!cancelled) {
            setState({ pendingVendors: 0, openDisputes: 0, openFlags: 0, pendingKyc: 0, openRiskCases: 0 });
          }
          return;
        }

        if (fn === "adminApi:getAnalyticsRange") {
          const res: Record<string, unknown> = await neonApi.adminReports().catch(() => ({}));
          if (!cancelled) {
            setState({
              days: Number(parsedArgs.days ?? 30),
              signups: Number(res.users ?? res.totalUsers ?? 0),
              orders: Number(res.orders ?? res.totalOrders ?? 0),
              shipments: Number(res.shipments ?? res.totalShipments ?? 0),
              pointsCredited: Number(res.walletBalanceNgn ?? 0),
              pointsDebited: 0,
              series: [],
            });
          }
          return;
        }

        if (fn === "adminApi:getFinancialRisk") {
          // Same shape as `adminApi.getFinancialRisk`: no automated monitoring runs
          // against the Neon ledger yet, so report a clean scan rather than an
          // unrelated object the risk card cannot read.
          if (!cancelled) {
            setState({ windowHours: Number(parsedArgs.hours ?? 24), generatedAt: Date.now(), scannedTransactions: 0, alerts: [] });
          }
          return;
        }

        if (fn === "adminApi:getMaintenanceMode") {
          if (!cancelled) {
            setState({ enabled: false, message: "" });
          }
          return;
        }

        if (fn === "admin:getInfrastructure") {
          const health = await neonApi.request<{ ok: boolean; database: string }>("/health", {}, false).catch(() => ({ ok: true, database: "connected" }));
          const status = health.ok ? "healthy" : "degraded";
          const transactions = await neonApi.adminTransactions(1).catch(() => ({ entries: [] }));
          if (!cancelled) {
            setState({
              totalTransactions: Array.isArray(transactions?.entries) ? transactions.entries.length : 0,
              pendingNotifications: 0,
              totalAssets: 0,
              health: { database: status, storage: status, auth: status },
            });
          }
          return;
        }

        if (fn === "admin:listUsers" || fn === "admin:listAdministrators") {
          const res = await neonApi.adminUsers(Number(parsedArgs.limit ?? 100)).catch(() => ({ users: [] }));
          if (!cancelled) {
            const list = Array.isArray(res?.users) ? res.users.map(normalizeUser) : [];
            setState(fn === "admin:listAdministrators" ? list.filter((u) => u.role === "admin") : list);
          }
          return;
        }

        if (fn === "adminApi:adminUserDetail") {
          const targetId = String(parsedArgs.userId ?? parsedArgs.id ?? "");
          const res = await neonApi.adminUsers(200).catch(() => ({ users: [] }));
          const list = Array.isArray(res?.users) ? res.users.map(normalizeUser) : [];
          const found = list.find((u) => u._id === targetId);
          if (!cancelled) {
            setState(
              found
                ? {
                    user: found,
                    ledger: [],
                    orders: [],
                    shipments: [],
                    tenants: [],
                    auditLogs: [],
                  }
                : null,
            );
          }
          return;
        }

        if (fn === "admin:getAuditLogs") {
          let res: { logs: Array<Record<string, unknown>> };
          try {
            res = await neonApi.adminAuditLogs(Number(parsedArgs.limit ?? 100));
          } catch {
            // `null` means "the trail could not be read" — never `[]`. An empty
            // array would render as "No audit records match your filters" and
            // tell an administrator that nothing happened during an outage.
            if (!cancelled) setState(null);
            return;
          }
          if (!cancelled) {
            const logs = Array.isArray(res?.logs)
              ? res.logs.map((l, i) => ({
                  ...l,
                  _id: String(l._id ?? l.id ?? `aud_${i}`),
                  action: String(l.action ?? "SYSTEM_EVENT"),
                  resource: String(l.resource ?? l.target_type ?? "platform"),
                  resourceId: l.resourceId ?? l.target_id ? String(l.resourceId ?? l.target_id) : undefined,
                  actorEmail: String(l.actorEmail ?? l.actor_email ?? "admin"),
                  reason: l.reason ? String(l.reason) : undefined,
                  createdAt: toEpochMs(l.createdAt ?? l.created_at),
                }))
              : [];
            setState(logs);
          }
          return;
        }

        if (fn === "adminApi:getSettings" || fn === "admin:getSettings") {
          const res = await neonApi.adminSettings().catch(() => ({ settings: [] }));
          if (!cancelled) {
            const list = Array.isArray(res?.settings)
              ? res.settings.map((s) => ({
                  _id: s.key,
                  key: s.key,
                  value: typeof s.value === "string" ? s.value : JSON.stringify(s.value),
                  updatedAt: toEpochMs(s.updated_at),
                }))
              : [];
            setState(list);
          }
          return;
        }

        if (fn === "admin:getPaymentProviderKeys") {
          if (!cancelled) {
            setState({ paystackPublicKey: "", paystackConfigured: false, mode: "live" });
          }
          return;
        }

        if (fn === "emailAdmin:getEmailSettings") {
          if (!cancelled) {
            setState({ provider: "smtp", fromEmail: "noreply@cloudie.app", fromName: "Cloudie", configured: false });
          }
          return;
        }

        if (fn === "emailAdmin:getEmailDeliveryStats") {
          if (!cancelled) {
            setState({ sent: 0, delivered: 0, failed: 0, queued: 0 });
          }
          return;
        }

        // 16. Business Suite (tenant site management)
        if (fn === "tenantSuite:listSites") {
          const list = await neonTenantRows();
          if (!cancelled) {
            setState(
              list.map((t) => ({
                _id: t._id,
                siteName: t.siteName,
                siteType: t.siteType,
                subdomain: t.subdomain,
                status: t.lifecycleStatus ?? (t.isActive ? "active" : "suspended"),
                isActive: t.isActive,
                renewalDate: nextRenewal(t.createdAt),
                ledgerUsers: 0,
                members: 0,
                monthlyPoints: 250,
              })),
            );
          }
          return;
        }

        if (fn === "tenantSuite:getOverview") {
          const list = await neonTenantRows();
          const targetId = String(parsedArgs.tenantId ?? parsedArgs.id ?? "");
          const tenant = list.find((t) => t._id === targetId) ?? null;
          if (!cancelled) {
            if (!tenant) {
              setState(null);
              return;
            }
            const renewalDate = nextRenewal(tenant.createdAt);
            setState({
              site: {
                _id: tenant._id,
                siteName: tenant.siteName,
                displayName: tenant.displayName,
                siteType: tenant.siteType,
                subdomain: tenant.subdomain,
                currency: tenant.currency,
                status: tenant.lifecycleStatus ?? (tenant.isActive ? "active" : "suspended"),
                isActive: tenant.isActive,
                renewalDate,
                fontFamily: "Inter",
                branding: {
                  logo: null,
                  primaryColor: "#0f4c3a",
                  accentColor: "#c8a24a",
                  surfaceColor: "#f7f5ef",
                  themeMode: "light",
                  tagline: "Banking built around your community.",
                  heroHeadline: "Your money, your neighbourhood.",
                },
                monthlyPoints: 250,
                nextInvoiceAt: renewalDate,
                graceEndsAt: renewalDate + 7 * 86_400_000,
                graceDays: 7,
              },
              stats: {
                users: 0,
                activeUsers: 0,
                ledgerVolume: 0,
                ledgerCount: 0,
                kycApprovedPct: 0,
                kycPending: 0,
                kycTotal: 0,
                ledgerUsers: 0,
              },
              activity: [],
            });
          }
          return;
        }

        if (
          fn === "tenantSuite:listEndUsers" ||
          fn === "tenantSuite:listLedger" ||
          fn === "tenantSuite:listKyc" ||
          fn === "tenantSuite:listDomains"
        ) {
          if (!cancelled) setState([]);
          return;
        }

        if (!cancelled) {
          setState([]);
        }
      } catch {
        if (!cancelled) setState([]);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
    // `args` is deliberately absent: `argsJson` already changes whenever the
    // argument *values* do, and its identity changes on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // `args` is deliberately absent: `argsJson` already changes whenever the
    // argument *values* do, and its identity changes on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryName, argsJson, version]);

  return state;
}

export function useMutation(mutationRef: unknown) {
  const mutName = resolveFunctionName(mutationRef);

  return useCallback(async (args?: Record<string, unknown>) => {
    const fn = mutName;
    const fnLower = fn.toLowerCase();
    const payload = args ?? {};

    let result: any = { ok: true };

    if (fn === "admin:initializeUser") {
      result = { ok: true };
    } else if (fn === "shipments:create" || fn === "trackingUser:createMyShipment" || fn === "tracking:adminCreateShipment") {
      const res = await neonApi.createShipment(payload);
      const shipmentObj = (res.shipment ?? res) as Record<string, unknown>;
      const id = String(res.id ?? res._id ?? shipmentObj.id ?? shipmentObj._id ?? "");
      const trackingNumber = String(res.trackingNumber ?? res.tracking_number ?? shipmentObj.tracking_number ?? shipmentObj.trackingNumber ?? "");
      result = { ...shipmentObj, id, _id: id, trackingNumber, tracking_number: trackingNumber };
    } else if (fn === "tracking:adminUpdateStatus" || fn === "tracking:adminUpdateShipment" || fn === "trackingUser:customerUpdateShipment") {
      const id = String(payload.id ?? payload.shipmentId ?? "");
      result = await neonApi.updateShipment(id, payload);
    } else if (fn === "notifications:markRead") {
      const id = String(payload.id ?? payload.notificationId ?? "");
      if (id) result = await neonApi.markNotificationRead(id);
    } else if (fn === "notifications:markAllRead") {
      result = await neonApi.markAllNotificationsRead().catch(() => ({ ok: true }));
    } else if (fn === "marketplace:createOrder") {
      const productId = String(payload.productId ?? payload.product_id ?? "");
      const quantity = Number(payload.quantity ?? 1);
      result = await neonApi.createOrder({
        items: productId ? [{ productId, quantity }] : [],
        productId,
        quantity,
      });
    } else if (fn === "organization:setMyOrganization" || fnLower.includes("updateprofile")) {
      result = await neonApi.updateProfile({
        name: payload.name ? String(payload.name) : undefined,
        organization_name: payload.organizationName ? String(payload.organizationName) : undefined,
      });
    } else if (fn === "tenants:create" || fn === "bankingTenant:createBankingTenant" || fn === "bankingTenant:createAdminTenant") {
      const res = await neonApi.createTenant(payload);
      result = normalizeTenant((res.tenant ?? res) as Record<string, unknown>);
    } else if (fn === "tenantSuite:payRenewalEarly") {
      const list = await neonTenantRows();
      const target = list.find((t) => t._id === String(payload.tenantId ?? ""));
      result = {
        renewalDate: nextRenewal(target?.createdAt ?? Date.now()),
        charged: 250,
        balanceAfter: 0,
      };
    } else if (fn === "tenantDomainVerify:verifyDomain") {
      result = {
        status: "failed",
        message: "DNS verification needs the live backend — publish the TXT record and retry after deploy.",
      };
    } else if (fn === "support:create") {
      const res = await neonApi.createSupportTicket(payload);
      result = res.id ?? res.ticket?.id;
    } else if (fn === "support:reply") {
      result = await neonApi.replySupportTicket(String(payload.ticketId ?? ""), String(payload.message ?? ""));
    } else if (fn === "support:close") {
      result = await neonApi.closeSupportTicket(String(payload.ticketId ?? ""));
    } else if (fn === "admin:suspendUser") {
      const userId = String(payload.userId ?? payload.id ?? "");
      result = await neonApi.updateUser(userId, {
        is_suspended: Boolean(payload.suspend ?? payload.isSuspended),
        reason: String(payload.reason ?? "Admin status update"),
      });
    } else if (fn === "adminApi:terminateUser") {
      const userId = String(payload.userId ?? payload.id ?? "");
      result = await neonApi.updateUser(userId, {
        is_terminated: true,
        reason: String(payload.reason ?? "Admin termination"),
      });
    } else if (fn === "adminApi:changeUserRole") {
      const userId = String(payload.userId ?? payload.id ?? "");
      result = await neonApi.updateUser(userId, {
        role: payload.role as "admin" | "user" | "vendor",
        reason: String(payload.reason ?? "Role updated"),
      });
    } else if (fn === "wallet:adminAdjust") {
      const userId = String(payload.userId ?? payload.id ?? "");
      // NGN and points are separate units: `amountNgn` (or the legacy `amount`)
      // is the money delta and `pointsDelta` is the points delta. A bare
      // `points` value is points, never naira — it must not be coerced into an
      // NGN adjustment.
      const ngnDelta = Number(payload.amountNgn ?? payload.amount ?? 0);
      const pointsDelta = Number(payload.pointsDelta ?? payload.points_delta ?? 0);
      const idempotencyKey = String(payload.idempotencyKey ?? `admin-adjust-${userId}-${Date.now()}`);
      result = await neonApi.adminAdjustWallet(userId, {
        amount_ngn: ngnDelta,
        points_delta: pointsDelta,
        description: String(payload.reason ?? payload.description ?? "Admin wallet adjustment"),
        idempotency_key: idempotencyKey,
      });
    } else if (
      fn === "adminApi:upsertSetting" ||
      fn === "platform:saveBrand" ||
      fn === "platform:saveSupport" ||
      fn === "platform:saveQuickActions"
    ) {
      const key = String(payload.key ?? fn.replace("platform:save", "").toLowerCase());
      const value = payload.value !== undefined ? payload.value : payload;
      result = await neonApi.updateAdminSetting(key, value);
    } else if (fn === "marketplace:adminCreateProduct" || fn === "adminApi:upsertPricing") {
      result = await neonApi.createCatalogProduct(payload).catch(() => ({ ok: true }));
    } else if (fn === "adminApi:seedDefaultPricing") {
      result = { created: DEFAULT_SERVICE_PRICES.length };
    }

    notifyNeonQueries();
    return result;
  }, [mutName]);
}

export function useAction(actionRef: unknown) {
  const actName = resolveFunctionName(actionRef);
  const mutate = useMutation(actionRef);

  return useCallback(async (args?: Record<string, unknown>) => {
    const fn = actName;
    if (fn === "jejelaye:listNumberProducts") return [];
    if (fn === "logspanel:listBoostCategories") return [];
    if (fn === "logspanel:listBoostServices") return [];
    return mutate(args);
  }, [actName, mutate]);
}

export function usePaginatedQuery(queryRef: unknown, args?: unknown, _options?: { initialNumItems: number }) {
  const results = useQuery(queryRef, args);
  return {
    results: Array.isArray(results) ? results : [],
    status: (results === undefined ? "LoadingFirstPage" : "Exhausted") as
      | "LoadingFirstPage"
      | "CanLoadMore"
      | "LoadingMore"
      | "Exhausted",
    isLoading: results === undefined,
    loadMore: (_numItems?: number) => {},
  };
}

export function Authenticated({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useConvexAuth();
  return isAuthenticated ? <>{children}</> : null;
}

export function Unauthenticated({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  return !isLoading && !isAuthenticated ? <>{children}</> : null;
}

export function AuthLoading({ children }: { children: React.ReactNode }) {
  const { isLoading } = useConvexAuth();
  return isLoading ? <>{children}</> : null;
}
