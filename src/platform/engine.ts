/**
 * Platform command surface for the five workspaces.
 *
 * Every function here is a thin, typed wrapper over the Turso-backed API. There
 * is no local balance arithmetic: the server prices the action, verifies the
 * ledger balance inside a transaction, charges idempotently, then the client
 * re-reads the authoritative snapshot.
 *
 * Mutations resolve to a `TransactionResult` so existing screens keep their
 * `result.ok` handling, while authentication throws `PlatformError`.
 */
import { ApiError, api, toDocument, toOrder, toShipment, toSite } from "./api";
import { clearSession, readDatabase, replaceDatabase, setCurrentUser, uid, type TransactionResult } from "./store";
import type {
  DocumentKind,
  LedgerType,
  Order,
  Shipment,
  ShipmentStatus,
  SitePlan,
  TenantSite,
  TravelDocument,
} from "./model";

export class PlatformError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PlatformError";
    this.code = code;
  }
}

export const PRICING = {
  shipment: { base: 120, perKg: 8, multiplier: { express: 1.6, economy: 1, freight: 0.75 } },
  document: { flight: 45, hotel: 45, invoice: 60, customs: 75, receipt: 25 } as Record<DocumentKind, number>,
  campaignPerRecipient: 2,
  siteSetup: { starter: 1_200, growth: 2_400, scale: 4_800 } as Record<SitePlan, number>,
  siteRenewal: { starter: 900, growth: 1_800, scale: 3_600 } as Record<SitePlan, number>,
  referral: 250,
};

function messageOf(error: unknown): string {
  if (error instanceof ApiError || error instanceof Error) return error.message;
  return "The operation could not be completed.";
}

function codeOf(error: unknown): string {
  if (error instanceof ApiError) return String(error.status);
  return "ERROR";
}

/* ── Snapshot hydration ──────────────────────────────────────────────────── */

/**
 * Loads the authoritative snapshot for the current session. Returns false when
 * the visitor is signed out (the API answers 401), so the shell can redirect
 * without showing an error.
 */
export async function hydrate(): Promise<boolean> {
  try {
    const { user, db } = await api.bootstrap();
    if (!user) {
      clearSession();
      return false;
    }
    setCurrentUser(user);
    replaceDatabase(db);
    return true;
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      clearSession();
      return false;
    }
    throw error;
  }
}

async function run<T>(work: () => Promise<T>): Promise<TransactionResult<T>> {
  try {
    const value = await work();
    return { ok: true, value };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) clearSession();
    return { ok: false, error: messageOf(error), code: codeOf(error) };
  }
}

/* ── Quotes (mirror the server's pricing) ────────────────────────────────── */

export function quoteShipment(weightKg: number, service: Shipment["service"]): number {
  const weight = Math.max(0.5, weightKg);
  const raw = (PRICING.shipment.base + weight * PRICING.shipment.perKg) * PRICING.shipment.multiplier[service];
  return Math.round(raw);
}

export function quoteCampaign(recipients: number): number {
  return Math.max(0, recipients) * PRICING.campaignPerRecipient;
}

/* ── Authentication ──────────────────────────────────────────────────────── */

function authError(error: unknown): PlatformError {
  if (error instanceof PlatformError) return error;
  if (error instanceof ApiError) return new PlatformError(String(error.status), error.message);
  return new PlatformError("ERROR", messageOf(error));
}

export async function signIn(email: string, password: string): Promise<{ token: string }> {
  try {
    const result = await api.login({ email: email.trim().toLowerCase(), password });
    const ok = await hydrate();
    if (!ok) throw new PlatformError("UNAUTHENTICATED", "The session could not be established.");
    return { token: result.token ?? "cookie-session" };
  } catch (error) {
    throw authError(error);
  }
}

export async function signUp(input: {
  name: string;
  email: string;
  password: string;
  referralCode?: string;
}): Promise<{ token: string }> {
  try {
    const result = await api.register({
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      password: input.password,
      referralCode: input.referralCode?.trim() || undefined,
    });
    const ok = await hydrate();
    if (!ok) throw new PlatformError("UNAUTHENTICATED", "The session could not be established.");
    return { token: result.token ?? "cookie-session" };
  } catch (error) {
    throw authError(error);
  }
}

export async function requestPasswordReset(email: string): Promise<{ devToken?: string }> {
  try {
    const result = await api.requestPasswordReset(email);
    return { devToken: result.devToken };
  } catch (error) {
    throw authError(error);
  }
}

export async function confirmPasswordReset(token: string, password: string): Promise<void> {
  try {
    await api.confirmPasswordReset(token, password);
  } catch (error) {
    throw authError(error);
  }
}

export async function signOut(): Promise<void> {
  try {
    await api.logout();
  } finally {
    clearSession();
  }
}

/* ── Public links ────────────────────────────────────────────────────────── */

export async function lookupPublicShipment(token: string): Promise<Shipment | null> {
  try {
    return await api.track(token);
  } catch {
    return null;
  }
}

export async function lookupPublicDocument(token: string): Promise<TravelDocument | null> {
  try {
    return await api.publicDocument(token);
  } catch {
    return null;
  }
}

/* ── Personal ────────────────────────────────────────────────────────────── */

/**
 * Requests a top-up. Points are credited only after an operator settles the
 * deposit — the client never mints a balance.
 */
export async function buyPoints(pack: {
  id: string;
  label: string;
  points: number;
  bonus: number;
  crypto: string;
}): Promise<TransactionResult<{ pending: boolean; points: number }>> {
  return run(async () => {
    const result = await api.deposit(pack.id);
    await hydrate();
    return { pending: result.deposit.status === "pending", points: result.deposit.points };
  });
}

export async function purchaseListing(listing: {
  id: string;
  vendor: string;
  title: string;
  points: number;
}): Promise<TransactionResult<Order>> {
  return run(async () => {
    const result = await api.createOrder(listing.id);
    await hydrate();
    return toOrder(result.order);
  });
}

export async function postChatMessage(orderId: string, body: string): Promise<TransactionResult<true>> {
  return run(async () => {
    await api.postOrderMessage(orderId, body);
    await hydrate();
    return true as const;
  });
}

export async function buyPointsOffline(): Promise<never> {
  throw new PlatformError("UNAVAILABLE", "Cash purchases are not available.");
}

/* ── Shipments ───────────────────────────────────────────────────────────── */

export async function createShipment(input: {
  origin: string;
  destination: string;
  recipientName: string;
  recipientPhone: string;
  contents: string;
  weightKg: number;
  declaredValue: number;
  service: Shipment["service"];
}): Promise<TransactionResult<Shipment>> {
  return run(async () => {
    const result = await api.createShipment({ ...input, idempotencyKey: uid("ship") });
    await hydrate();
    return toShipment(result.shipment);
  });
}

export async function advanceShipment(
  shipmentId: string,
  input: { status: ShipmentStatus; location: string; note?: string },
): Promise<TransactionResult<Shipment>> {
  return run(async () => {
    const result = await api.advanceShipment(shipmentId, input);
    await hydrate();
    return toShipment(result.shipment);
  });
}

/* ── Ticketing ───────────────────────────────────────────────────────────── */

export async function createDocument(input: {
  kind: DocumentKind;
  title: string;
  passenger: string;
  reference: string;
  lines: { label: string; value: string }[];
  total: number | null;
  currency: string;
}): Promise<TransactionResult<TravelDocument>> {
  return run(async () => {
    const result = await api.createDocument({ ...input, idempotencyKey: uid("doc") });
    await hydrate();
    return toDocument(result.document);
  });
}

/* ── Business suite ──────────────────────────────────────────────────────── */

export async function deploySite(input: {
  name: string;
  slug: string;
  plan: SitePlan;
  kycRequired: boolean;
  kycLevel: "basic" | "enhanced";
  bankingEnabled: boolean;
  investmentEnabled: boolean;
}): Promise<TransactionResult<TenantSite>> {
  return run(async () => {
    const result = await api.deployTenant({ ...input, idempotencyKey: uid("site") });
    await hydrate();
    const created = readDatabase().sites.find((site) => site.id === result.tenant.id);
    if (created) return created;
    return toSite({ ...result.tenant, users: [] });
  });
}

export async function renewSite(siteId: string): Promise<TransactionResult<true>> {
  return run(async () => {
    await api.renewTenant(siteId);
    await hydrate();
    return true as const;
  });
}

export async function updateSiteConfig(
  siteId: string,
  patch: Partial<{
    kycRequired: boolean;
    kycLevel: "basic" | "enhanced";
    bankingEnabled: boolean;
    investmentEnabled: boolean;
    status: "live" | "pending_renewal" | "suspended";
  }>,
): Promise<TransactionResult<true>> {
  return run(async () => {
    await api.updateTenant(siteId, patch);
    await hydrate();
    return true as const;
  });
}

export async function invitePortalUser(
  siteId: string,
  input: { name: string; email: string; role: "staff" | "viewer" },
): Promise<TransactionResult<true>> {
  return run(async () => {
    await api.invitePortalUser(siteId, input);
    await hydrate();
    return true as const;
  });
}

export async function removePortalUser(siteId: string, portalUserId: string): Promise<TransactionResult<true>> {
  return run(async () => {
    await api.removePortalUser(siteId, portalUserId);
    await hydrate();
    return true as const;
  });
}

/* ── Services ────────────────────────────────────────────────────────────── */

export async function sendCampaign(input: {
  template: string;
  subject: string;
  body: string;
  recipients: string[];
}): Promise<TransactionResult<true>> {
  return run(async () => {
    await api.sendCampaign({ ...input, idempotencyKey: uid("camp") });
    await hydrate();
    return true as const;
  });
}

/* ── Notifications & profile ─────────────────────────────────────────────── */

export async function markNotificationsRead(): Promise<TransactionResult<true>> {
  return run(async () => {
    await api.markAllNotificationsRead();
    await hydrate();
    return true as const;
  });
}

export async function updateProfile(patch: { name?: string; phone?: string }): Promise<TransactionResult<true>> {
  return run(async () => {
    await api.updateProfile(patch);
    await hydrate();
    return true as const;
  });
}

/* ── Admin console ───────────────────────────────────────────────────────── */

export async function listPendingDeposits() {
  return api.listPendingDeposits();
}

export async function settleDeposit(depositId: string): Promise<TransactionResult<true>> {
  return run(async () => {
    await api.settleDeposit(depositId);
    await hydrate();
    return true as const;
  });
}

export async function refundLedgerGroup(input: { groupId: string; reason?: string }): Promise<TransactionResult<true>> {
  return run(async () => {
    await api.refundLedgerGroup(input);
    await hydrate();
    return true as const;
  });
}

export async function listAuditLogs(limit = 50) {
  return api.listAuditLogs(limit);
}

export type { LedgerType };
