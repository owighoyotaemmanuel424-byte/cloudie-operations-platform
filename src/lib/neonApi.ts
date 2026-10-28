// Same-origin Vercel Functions are the default. Configure VITE_API_BASE_URL
// only when intentionally deploying the API on a separate trusted HTTPS origin.
const API_BASE_URL = ((import.meta.env.VITE_API_BASE_URL as string | undefined) || "").replace(/\/$/, "");

const TOKEN_KEY = "cloudie_api_token";
const USER_KEY = "cloudie_api_user";

export type NeonUser = {
  id: string;
  email: string;
  name: string | null;
  role: "admin" | "user" | "vendor";
  emailVerificationTime?: number | null;
  email_verified_at?: string | null;
  organization_name?: string | null;
  wallet_balance_ngn?: number;
  points_balance?: number;
};

export type NeonSession = { user: NeonUser; token?: string };

type ApiErrorBody = { error?: string; message?: string; details?: unknown };

export class NeonApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "NeonApiError";
    this.status = status;
  }
}

function baseUrl() {
  return API_BASE_URL;
}

function readCsrfCookie() {
  if (typeof document === "undefined") return null;
  const prefix = "cloudie_csrf=";
  const entry = document.cookie.split(";").map((value) => value.trim()).find((value) => value.startsWith(prefix));
  return entry ? decodeURIComponent(entry.slice(prefix.length)) : null;
}

// The session token is deliberately never read from browser storage. Same-origin
// requests authenticate with the server-issued HttpOnly cookie.
export function getNeonToken() {
  try { window.sessionStorage.removeItem(TOKEN_KEY); } catch { /* storage may be blocked */ }
  return null;
}

export function getCachedNeonUser(): NeonUser | null {
  try {
    const raw = window.sessionStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) as NeonUser : null;
  } catch { return null; }
}

function notifyAuthChange(user: NeonUser | null) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("cloudie-auth-change", { detail: { user } }));
  }
}

function saveSession(session: NeonSession) {
  try {
    window.sessionStorage.removeItem(TOKEN_KEY);
    window.sessionStorage.setItem(USER_KEY, JSON.stringify(session.user));
    notifyAuthChange(session.user);
  } catch {
    throw new Error("Your browser blocked session storage. Enable site storage and try again.");
  }
}

export function clearNeonSession() {
  try {
    window.sessionStorage.removeItem(TOKEN_KEY);
    window.sessionStorage.removeItem(USER_KEY);
    notifyAuthChange(null);
  } catch { /* storage may be unavailable */ }
}

async function ensureCsrfCookie() {
  if (readCsrfCookie()) return;
  try {
    await fetch(`${baseUrl()}/api/auth/csrf`, { method: "GET", credentials: "include" });
  } catch {
    // Token auth still works when cross-site cookies are blocked.
  }
}

export async function request<T>(path: string, init: RequestInit = {}, authenticated = true): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    await ensureCsrfCookie();
  }
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const token = authenticated ? getNeonToken() : null;
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const csrfToken = readCsrfCookie();
    if (csrfToken) headers.set("X-CSRF-Token", csrfToken);
  }
  const response = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers,
    credentials: "include",
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({})) as T & ApiErrorBody;
  if (!response.ok) {
    if (response.status === 401 && authenticated) {
      clearNeonSession();
    }
    throw new NeonApiError(body.error || body.message || `Request failed (${response.status})`, response.status);
  }
  return body;
}

export const neonApi = {
  request,
  async register(input: { name: string; email: string; password: string }) {
    const result = await request<NeonSession>("/api/auth/register", { method: "POST", body: JSON.stringify(input) }, false);
    saveSession(result);
    return result.user;
  },
  async login(input: { email: string; password: string }) {
    const result = await request<NeonSession>("/api/auth/login", { method: "POST", body: JSON.stringify(input) }, false);
    saveSession(result);
    return result.user;
  },
  async me() {
    const result = await request<{ user: NeonUser }>("/api/me");
    try {
      window.sessionStorage.setItem(USER_KEY, JSON.stringify(result.user));
      notifyAuthChange(result.user);
    } catch { /* optional cache */ }
    return result.user;
  },
  async logout() {
    try { await request<{ ok: boolean }>("/api/auth/logout", { method: "POST", body: "{}" }); }
    finally { clearNeonSession(); }
  },
  async publicConfig() {
    return request<{
      brand: { name: string; tagline: string; accentColor: string; footerNote: string };
      support: { email: string; phone: string; hours: string; widgetEnabled: boolean; widgetTitle: string; widgetMessage: string; faqs: Array<{ question: string; answer: string }> };
      quickActions: Array<{ label: string; href: string }>;
      hasCustomBrand: boolean;
    }>("/api/public-config", {}, false);
  },
  async tenants() {
    return request<{ tenants: Array<Record<string, unknown>> }>("/api/tenants");
  },
  async createTenant(input: Record<string, unknown>) {
    return request<{ tenant: Record<string, unknown> }>("/api/tenants", { method: "POST", body: JSON.stringify(input) });
  },
  async profile() {
    return request<{ profile: Record<string, unknown> }>("/api/profile");
  },
  async updateProfile(input: { name?: string; organization_name?: string; organizationName?: string }) {
    return request<{ profile: Record<string, unknown> }>("/api/profile", { method: "PATCH", body: JSON.stringify(input) });
  },
  async walletSummary() {
    return request<{ wallet_balance_ngn: number; points_balance: number; walletBalanceNgn?: number; pointsBalance?: number; currency: string }>("/api/wallet/summary");
  },
  async walletLedger(limit = 50) {
    return request<{ entries: Array<Record<string, unknown>> }>(`/api/wallet/ledger?limit=${Math.min(100, Math.max(1, Math.floor(limit)))}`);
  },
  async serviceHubOverview() {
    return request<Record<string, unknown>>("/api/service-hub/overview");
  },
  async shipments(options: { all?: boolean; limit?: number } = {}) {
    const query = new URLSearchParams();
    if (options.all) query.set("all", "true");
    if (options.limit) query.set("limit", String(options.limit));
    return request<{ shipments: Array<Record<string, unknown>> }>(`/api/shipments?${query.toString()}`);
  },
  async shipment(id: string) {
    return request<{ shipment: Record<string, unknown>; events: Array<Record<string, unknown>> }>(`/api/shipments/${encodeURIComponent(id)}`);
  },
  async createShipment(input: Record<string, unknown>) {
    return request<{ id?: string; _id?: string; tracking_number?: string; trackingNumber?: string; shipment?: Record<string, unknown> }>("/api/shipments", { method: "POST", body: JSON.stringify(input) });
  },
  async updateShipment(id: string, input: Record<string, unknown>) {
    return request<{ shipment: Record<string, unknown> }>(`/api/shipments/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) });
  },
  async track(trackingNumber: string) {
    return request<{ shipment: Record<string, unknown>; events: Array<Record<string, unknown>> }>(`/api/tracking/${encodeURIComponent(trackingNumber)}`, {}, false);
  },
  async catalog(input: { tenantId?: string; limit?: number } = {}) {
    const query = new URLSearchParams();
    query.set("limit", String(Math.min(100, Math.max(1, Math.floor(input.limit ?? 50)))));
    if (input.tenantId) query.set("tenantId", input.tenantId);
    return request<{ products: Array<Record<string, unknown>> }>(`/api/catalog?${query.toString()}`, {}, false);
  },
  async orders(limit = 50) {
    return request<{ orders: Array<Record<string, unknown>> }>(`/api/orders?limit=${Math.min(100, Math.max(1, Math.floor(limit)))}`);
  },
  async createOrder(input: { items?: Array<{ productId: string; quantity: number }>; productId?: string; product_id?: string; quantity?: number; currency?: string }) {
    return request<{ order: Record<string, unknown>; items?: Array<Record<string, unknown>> }>("/api/orders", { method: "POST", body: JSON.stringify(input) });
  },
  async notifications(limit = 50) {
    return request<{ notifications: Array<Record<string, unknown>>; unreadCount?: number }>(`/api/notifications?limit=${Math.min(100, Math.max(1, Math.floor(limit)))}`);
  },
  async markNotificationRead(id: string) {
    return request<{ ok: boolean }>(`/api/notifications/${encodeURIComponent(id)}/read`, { method: "PATCH", body: "{}" });
  },
  async markAllNotificationsRead() {
    return request<{ ok: boolean }>("/api/notifications/read-all", { method: "POST", body: "{}" });
  },
  async documents(limit = 50) {
    return request<{ documents: Array<Record<string, unknown>> }>(`/api/documents?limit=${Math.min(100, Math.max(1, Math.floor(limit)))}`);
  },
  async createDocument(input: Record<string, unknown>) {
    return request<{ document: Record<string, unknown> }>("/api/documents", { method: "POST", body: JSON.stringify(input) });
  },
  async supportTickets(limit = 50) {
    return request<{ tickets: Array<Record<string, unknown>> }>(`/api/support/tickets?limit=${Math.min(100, Math.max(1, Math.floor(limit)))}`);
  },
  async supportTicketDetail(id: string) {
    return request<{ ticket: Record<string, unknown>; messages: Array<Record<string, unknown>> }>(`/api/support/tickets/${encodeURIComponent(id)}`);
  },
  async createSupportTicket(input: Record<string, unknown>) {
    return request<{ id: string; ticket: Record<string, unknown> }>("/api/support/tickets", { method: "POST", body: JSON.stringify(input) });
  },
  async replySupportTicket(id: string, message: string) {
    return request<{ ok: boolean }>(`/api/support/tickets/${encodeURIComponent(id)}/reply`, { method: "POST", body: JSON.stringify({ message }) });
  },
  async closeSupportTicket(id: string) {
    return request<{ ok: boolean }>(`/api/support/tickets/${encodeURIComponent(id)}/close`, { method: "POST", body: "{}" });
  },
  async adminUsers(limit = 50) {
    return request<{ users: Array<Record<string, unknown>> }>(`/api/admin/users?limit=${Math.min(100, Math.max(1, Math.floor(limit)))}`);
  },
  async adminUserDetail(id: string) {
    return request<Record<string, unknown>>(`/api/admin/users/${encodeURIComponent(id)}`);
  },
  async updateUser(id: string, input: { role?: "admin" | "user" | "vendor"; is_suspended?: boolean; is_terminated?: boolean; reason?: string }) {
    return request<{ user: Record<string, unknown> }>(`/api/admin/users/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) });
  },
  async adminAdjustWallet(id: string, input: { amount_ngn: number; description: string; idempotency_key?: string }) {
    return request<{ balance_after_ngn: string | number }>(`/api/admin/users/${encodeURIComponent(id)}/wallet-adjust`, { method: "POST", body: JSON.stringify(input) });
  },
  async adminShipments(limit = 50) {
    return request<{ shipments: Array<Record<string, unknown>> }>(`/api/admin/shipments?limit=${Math.min(100, Math.max(1, Math.floor(limit)))}`);
  },
  async adminReports() {
    return request<Record<string, unknown>>("/api/admin/reports");
  },
  async adminTransactions(limit = 50) {
    return request<{ entries: Array<Record<string, unknown>> }>(`/api/admin/transactions?limit=${Math.min(100, Math.max(1, Math.floor(limit)))}`);
  },
  async adminAuditLogs(limit = 50) {
    return request<{ logs: Array<Record<string, unknown>> }>(`/api/admin/audit-logs?limit=${Math.min(100, Math.max(1, Math.floor(limit)))}`);
  },
  async adminSettings() {
    return request<{ settings: Array<{ key: string; value: unknown; updated_at: string }> }>("/api/admin/settings");
  },
  async updateAdminSetting(key: string, value: unknown) {
    return request<{ ok: boolean }>("/api/admin/settings", { method: "POST", body: JSON.stringify({ key, value }) });
  },
  async createCatalogProduct(input: Record<string, unknown>) {
    return request<{ product: Record<string, unknown> }>("/api/admin/catalog", { method: "POST", body: JSON.stringify(input) });
  },
  async updateCatalogProduct(id: string, input: Record<string, unknown>) {
    return request<{ product: Record<string, unknown> }>(`/api/admin/catalog/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) });
  },
  async deleteCatalogProduct(id: string) {
    return request<{ ok: boolean }>(`/api/admin/catalog/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
};

