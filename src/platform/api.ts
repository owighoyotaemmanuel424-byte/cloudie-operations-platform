/**
 * Same-origin client for the Turso-backed Cloudie API.
 *
 * The browser never sees a database credential or an authoritative balance:
 * every read comes from `/api/platform/bootstrap` and every write goes through a
 * server route that validates ownership, price and balance inside a transaction.
 */
import type {
  Campaign,
  ChatMessage,
  DocumentKind,
  LedgerEntry,
  LedgerType,
  Notification,
  Order,
  Shipment,
  ShipmentEvent,
  SitePlan,
  TenantPortalUser,
  TenantSite,
  TravelDocument,
  User,
  Workspace,
} from "./model";
import { emptyDatabase, type Database } from "./store";

type Row = Record<string, any>;

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const CSRF_COOKIE = "cloudie_csrf";

function readCsrfCookie(): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${CSRF_COOKIE}=`;
  const entry = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix));
  return entry ? decodeURIComponent(entry.slice(prefix.length)) : null;
}

async function ensureCsrfCookie() {
  if (readCsrfCookie()) return;
  try {
    await fetch("/api/auth/csrf", { credentials: "include", cache: "no-store" });
  } catch {
    // Bearer/session cookie may still work; the server rejects if CSRF is missing.
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const writes = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
  if (writes) await ensureCsrfCookie();
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const csrf = writes ? readCsrfCookie() : null;
  if (csrf) headers.set("X-CSRF-Token", csrf);

  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "include",
    cache: "no-store",
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!response.ok) {
    throw new ApiError(body.error || body.message || `Request failed (${response.status})`, response.status);
  }
  return body as T;
}

/* ── Value mapping: SQL rows → the UI's domain model ─────────────────────── */

function ms(value: unknown, fallback = Date.now()): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value) {
    // SQLite CURRENT_TIMESTAMP is "YYYY-MM-DD HH:MM:SS" in UTC.
    const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
      ? `${value.replace(" ", "T")}Z`
      : value;
    const parsed = Date.parse(normalized);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function num(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function toUser(row: Row, referralCode: string | null): User {
  return {
    id: String(row.id),
    email: String(row.email ?? ""),
    name: String(row.name ?? row.email ?? "Account"),
    passwordHash: "",
    role: row.role === "admin" ? "admin" : "customer",
    points: num(row.points, num(row.points_balance, 0)),
    referralCode: String(row.referralCode ?? row.referral_code ?? referralCode ?? ""),
    referredBy: row.referredBy ?? row.referred_by ?? null,
    phone: row.phone ?? null,
    createdAt: ms(row.createdAt ?? row.created_at),
  };
}

function toEvent(row: Row, index: number): ShipmentEvent {
  return {
    id: String(row.id ?? `evt_${index}`),
    status: row.status,
    label: String(row.label ?? row.status ?? "Update"),
    location: String(row.location ?? ""),
    note: row.note ?? null,
    at: ms(row.at ?? row.occurred_at ?? row.created_at),
  };
}

function toShipment(row: Row): Shipment {
  const events = Array.isArray(row.events) ? row.events.map(toEvent) : [];
  return {
    id: String(row.id),
    code: String(row.code ?? row.tracking_number ?? ""),
    publicToken: String(row.public_token ?? row.publicToken ?? ""),
    userId: String(row.user_id ?? row.userId ?? ""),
    service: row.service ?? row.service_type ?? "economy",
    origin: String(row.origin ?? ""),
    destination: String(row.destination ?? ""),
    recipientName: String(row.recipient_name ?? row.recipientName ?? ""),
    recipientPhone: String(row.recipient_phone ?? row.recipientPhone ?? ""),
    contents: String(row.contents ?? ""),
    weightKg: num(row.weight_kg ?? row.weightKg ?? row.weight),
    declaredValue: num(row.declared_value ?? row.declaredValue),
    costPoints: num(row.cost_points ?? row.costPoints),
    status: row.status ?? "registered",
    createdAt: ms(row.created_at ?? row.createdAt),
    events,
  };
}

function toDocument(row: Row): TravelDocument {
  return {
    id: String(row.id),
    publicToken: String(row.public_token ?? row.publicToken ?? ""),
    userId: String(row.user_id ?? row.userId ?? ""),
    kind: (row.kind ?? row.document_type ?? "flight") as DocumentKind,
    title: String(row.title ?? "Document"),
    passenger: String(row.passenger ?? ""),
    reference: String(row.reference ?? ""),
    lines: parseArray<{ label: string; value: string }>(row.lines),
    total: row.total === null || row.total === undefined ? null : num(row.total),
    currency: String(row.currency ?? "NGN"),
    pointsCharged: num(row.points_charged ?? row.pointsCharged),
    createdAt: ms(row.created_at ?? row.createdAt),
  };
}

function toLedger(row: Row): LedgerEntry {
  return {
    id: String(row.id),
    userId: String(row.user_id ?? row.userId ?? ""),
    type: (row.kind ?? "credit") as LedgerType,
    points: num(row.points),
    balanceAfter: num(row.balance_after ?? row.balanceAfter),
    reason: String(row.description ?? row.reason ?? "Ledger entry"),
    workspace: (row.workspace ?? "personal") as Workspace,
    reference: row.reference ?? null,
    createdAt: ms(row.created_at ?? row.createdAt),
  };
}

function toPortalUser(row: Row): TenantPortalUser {
  return {
    id: String(row.id),
    name: String(row.name ?? row.email ?? ""),
    email: String(row.email ?? ""),
    role: row.role ?? "viewer",
    invitedAt: ms(row.invited_at ?? row.invitedAt),
  };
}

function toSite(row: Row): TenantSite {
  return {
    id: String(row.id),
    userId: String(row.owner_user_id ?? row.userId ?? ""),
    name: String(row.site_name ?? row.name ?? "Portal"),
    slug: String(row.slug ?? row.subdomain ?? ""),
    plan: (row.plan ?? "starter") as SitePlan,
    status: row.status ?? (num(row.is_active, 1) ? "live" : "suspended"),
    kycRequired: Boolean(num(row.kyc_required, 0)),
    kycLevel: row.kyc_level === "enhanced" ? "enhanced" : "basic",
    bankingEnabled: Boolean(num(row.banking_enabled, 0)),
    investmentEnabled: Boolean(num(row.investment_enabled, 0)),
    renewalPoints: num(row.renewal_points),
    renewsAt: row.renews_at ? ms(row.renews_at) : Date.now() + 30 * 86_400_000,
    users: Array.isArray(row.users) ? row.users.map(toPortalUser) : [],
    createdAt: ms(row.created_at ?? row.createdAt),
  };
}

function toCampaign(row: Row): Campaign {
  return {
    id: String(row.id),
    userId: String(row.user_id ?? row.userId ?? ""),
    template: String(row.template ?? ""),
    subject: String(row.subject ?? ""),
    body: String(row.body ?? ""),
    recipients: parseArray<string>(row.recipients),
    pointsCharged: num(row.points_charged),
    status: (row.status === "sent" ? "sent" : row.status === "failed" ? "failed" : row.status === "partial" ? "partial" : "queued") as Campaign["status"],
    sentAt: ms(row.created_at ?? row.sentAt),
    opens: num(row.opens),
    deliveryState: (row.delivery_state ?? row.deliveryState ?? row.status ?? "queued") as Campaign["deliveryState"],
    sentCount: num(row.sent_count ?? row.sentCount),
    failedCount: num(row.failed_count ?? row.failedCount),
    deliveryError: row.last_error ?? row.deliveryError ?? null,
  };
}

function toOrder(row: Row): Order {
  return {
    id: String(row.id),
    userId: String(row.user_id ?? row.userId ?? ""),
    listingId: String(row.listing_id ?? row.listingId ?? ""),
    vendor: String(row.vendor ?? ""),
    title: String(row.title ?? ""),
    points: num(row.points),
    status: row.status ?? "vendor_contacted",
    createdAt: ms(row.created_at ?? row.createdAt),
  };
}

function toMessage(row: Row): ChatMessage {
  return {
    id: String(row.id),
    orderId: String(row.order_id ?? row.orderId ?? ""),
    from: row.sender === "vendor" ? "vendor" : "customer",
    body: String(row.body ?? ""),
    at: ms(row.created_at ?? row.at),
  };
}

function toNotification(row: Row): Notification {
  return {
    id: String(row.id),
    userId: String(row.user_id ?? row.userId ?? ""),
    workspace: (row.workspace ?? "personal") as Workspace,
    title: String(row.title ?? ""),
    body: String(row.body ?? ""),
    read: Boolean(num(row.read, row.read_at ? 1 : 0)),
    at: ms(row.created_at ?? row.at),
  };
}

export type Bootstrap = { user: User | null; db: Database };

export function mapBootstrap(raw: Row): Bootstrap {
  const userRow = raw.user ?? null;
  if (!userRow) return { user: null, db: emptyDatabase() };
  const user = toUser(userRow, null);
  const referrals = Array.isArray(raw.referrals) ? raw.referrals : [];
  const db: Database = {
    ...emptyDatabase(),
    users: [
      user,
      ...referrals.map((row: Row, index: number) => ({
        ...toUser(row, user.referralCode),
        id: `referral_${index}`,
        referredBy: user.referralCode,
      })),
    ],
    ledger: (raw.ledger ?? []).map(toLedger),
    shipments: (raw.shipments ?? []).map(toShipment),
    documents: (raw.documents ?? []).map(toDocument),
    sites: (raw.sites ?? []).map(toSite),
    campaigns: (raw.campaigns ?? []).map(toCampaign),
    orders: (raw.orders ?? []).map(toOrder),
    messages: (raw.messages ?? []).map(toMessage),
    notifications: (raw.notifications ?? []).map(toNotification),
    settings: {
      brandName: "Cloudie",
      supportEmail: "desk@cloudie.africa",
      usdRate: 1650,
    },
  };
  return { user, db };
}

export const api = {
  request,

  async login(input: { email: string; password: string }) {
    return request<{ user: Row; token?: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  async register(input: { name: string; email: string; password: string; referralCode?: string }) {
    return request<{ user: Row; token?: string }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  async logout() {
    return request<{ ok: boolean }>("/api/auth/logout", { method: "POST", body: "{}" });
  },

  async requestPasswordReset(email: string) {
    return request<{ ok: boolean; message?: string; devToken?: string }>("/api/auth/password-reset/request", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  },

  async confirmPasswordReset(token: string, password: string) {
    return request<{ ok: boolean }>("/api/auth/password-reset/confirm", {
      method: "POST",
      body: JSON.stringify({ token, password }),
    });
  },

  async bootstrap() {
    return mapBootstrap(await request<Row>("/api/platform/bootstrap"));
  },

  async deposit(packId: string) {
    return request<{ deposit: { points: number; status: string } }>("/api/platform/points/deposit", {
      method: "POST",
      body: JSON.stringify({ packId }),
    });
  },

  async createShipment(input: Row) {
    return request<{ shipment: Row }>("/api/platform/shipments", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  async advanceShipment(id: string, input: { status: string; location?: string; note?: string }) {
    return request<{ shipment: Row }>(`/api/platform/shipments/${encodeURIComponent(id)}/advance`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },

  async track(token: string) {
    const body = await request<{ shipment: Row }>(`/api/platform/track/${encodeURIComponent(token)}`);
    return toShipment(body.shipment);
  },

  async createDocument(input: Row) {
    return request<{ document: Row }>("/api/platform/documents", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  async publicDocument(token: string) {
    const body = await request<{ document: Row }>(`/api/platform/documents/${encodeURIComponent(token)}`);
    return toDocument(body.document);
  },

  async createOrder(listingId: string) {
    return request<{ order: Row }>("/api/platform/orders", {
      method: "POST",
      body: JSON.stringify({ listingId }),
    });
  },

  async postOrderMessage(orderId: string, body: string) {
    return request<{ ok: boolean }>(`/api/platform/orders/${encodeURIComponent(orderId)}/messages`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
  },

  async sendCampaign(input: Row) {
    return request<{ campaign: Row }>("/api/platform/campaigns", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  async deployTenant(input: Row) {
    return request<{ tenant: Row }>("/api/platform/tenants", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  async updateTenant(id: string, patch: Row) {
    return request<{ ok: boolean }>(`/api/platform/tenants/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  },

  async renewTenant(id: string) {
    return request<{ ok: boolean }>(`/api/platform/tenants/${encodeURIComponent(id)}/renew`, {
      method: "POST",
      body: "{}",
    });
  },

  async invitePortalUser(id: string, input: { name: string; email: string; role: string }) {
    return request<{ ok: boolean }>(`/api/platform/tenants/${encodeURIComponent(id)}/users`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  async removePortalUser(id: string, portalUserId: string) {
    return request<{ ok: boolean }>(
      `/api/platform/tenants/${encodeURIComponent(id)}/users/${encodeURIComponent(portalUserId)}`,
      { method: "DELETE" },
    );
  },

  async markAllNotificationsRead() {
    return request<{ ok: boolean }>("/api/platform/notifications/read-all", { method: "POST", body: "{}" });
  },

  async updateProfile(input: { name?: string; phone?: string }) {
    return request<{ ok: boolean }>("/api/platform/profile", { method: "PATCH", body: JSON.stringify(input) });
  },

  async listPendingDeposits() {
    const body = await request<{ deposits: Row[] }>("/api/platform/admin/deposits?status=pending");
    return body.deposits ?? [];
  },

  async settleDeposit(id: string) {
    return request<{ ok: boolean }>(`/api/platform/admin/deposits/${encodeURIComponent(id)}/settle`, {
      method: "POST",
      body: "{}",
    });
  },

  async refundLedgerGroup(input: { groupId: string; reason?: string }) {
    return request<{ ok: boolean }>("/api/platform/admin/refund", {
      method: "POST",
      body: JSON.stringify({ groupId: input.groupId, reason: input.reason }),
    });
  },

  async listAuditLogs(limit = 50) {
    const body = await request<{ logs: Row[] }>(`/api/admin/audit-logs?limit=${Math.min(100, Math.max(1, Math.floor(limit)))}`);
    return body.logs ?? [];
  },
};

/** Shared by the engine so every workspace renders the same mapped shapes. */
export { toDocument, toOrder, toShipment, toSite };
