const API_BASE_URL = ((import.meta.env.VITE_NEON_API_URL as string | undefined) ?? "").replace(/\/$/, "");
const SAME_ORIGIN_API = import.meta.env.VITE_NEON_API_SAME_ORIGIN === "true";
const COOKIE_ONLY_SESSIONS = import.meta.env.VITE_NEON_COOKIE_ONLY === "true";

const TOKEN_KEY = "cloudie_api_token";
const USER_KEY = "cloudie_api_user";
const COOKIE_SESSION_MARKER = "__cloudie_cookie_session__";

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
  if (COOKIE_ONLY_SESSIONS && !SAME_ORIGIN_API) throw new Error("Cookie-only sessions require the same-origin API gateway.");
  if (SAME_ORIGIN_API) return "";
  if (!API_BASE_URL) throw new Error("Neon API is not configured. Set VITE_NEON_API_URL or enable the same-origin API gateway.");
  return API_BASE_URL;
}

function readCsrfCookie() {
  if (typeof document === "undefined") return null;
  const prefix = "cloudie_csrf=";
  const entry = document.cookie.split(";").map((value) => value.trim()).find((value) => value.startsWith(prefix));
  return entry ? decodeURIComponent(entry.slice(prefix.length)) : null;
}

export function getNeonToken() {
  if (COOKIE_ONLY_SESSIONS) return COOKIE_SESSION_MARKER;
  try { return window.sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function getCachedNeonUser(): NeonUser | null {
  try {
    const raw = window.sessionStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) as NeonUser : null;
  } catch { return null; }
}

function saveSession(session: NeonSession) {
  try {
    if (session.token && !COOKIE_ONLY_SESSIONS) window.sessionStorage.setItem(TOKEN_KEY, session.token);
    else window.sessionStorage.removeItem(TOKEN_KEY);
    window.sessionStorage.setItem(USER_KEY, JSON.stringify(session.user));
  } catch {
    throw new Error("Your browser blocked session storage. Enable site storage and try again.");
  }
}

export function clearNeonSession() {
  try {
    window.sessionStorage.removeItem(TOKEN_KEY);
    window.sessionStorage.removeItem(USER_KEY);
  } catch { /* storage may be unavailable */ }
}

async function ensureCsrfCookie() {
  if (!SAME_ORIGIN_API || readCsrfCookie()) return;
  const response = await fetch(`${baseUrl()}/api/auth/csrf`, {
    method: "GET", credentials: "include", cache: "no-store", headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new NeonApiError("Unable to initialize secure session. Please retry.", response.status);
}

async function request<T>(path: string, init: RequestInit = {}, authenticated = true): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && SAME_ORIGIN_API) await ensureCsrfCookie();
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const token = authenticated ? getNeonToken() : null;
  if (token && token !== COOKIE_SESSION_MARKER) headers.set("Authorization", `Bearer ${token}`);
  if (["POST", "PUT", "PATCH", "DELETE"].includes((init.method ?? "GET").toUpperCase())) {
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
  if (!response.ok) throw new NeonApiError(body.error || body.message || `Request failed (${response.status})`, response.status);
  return body;
}

export const neonApi = {
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
    try { window.sessionStorage.setItem(USER_KEY, JSON.stringify(result.user)); } catch { /* optional cache */ }
    return result.user;
  },
  async logout() {
    try { await request<{ ok: boolean }>("/api/auth/logout", { method: "POST", body: "{}" }); }
    finally { clearNeonSession(); }
  },
  async publicConfig() {
    return request<{
      brand: { name: string; tagline: string; accentColor: string; footerNote: string; logoUrl?: string };
      support: { email: string; phone: string; hours: string; widgetEnabled: boolean; widgetTitle: string; widgetMessage: string; faqs: Array<{ question: string; answer: string }> };
      quickActions: Array<{ kind?: string; label: string }>;
      hasCustomBrand: boolean;
    }>("/api/public-config", {}, false);
  },
  async tenants() {
    return request<{ tenants: Array<Record<string, unknown>> }>("/api/tenants");
  },
  async profile() {
    return request<{ profile: Record<string, unknown> }>("/api/profile");
  },
  async updateProfile(input: { name?: string; organization_name?: string }) {
    return request<{ profile: Record<string, unknown> }>("/api/profile", { method: "PATCH", body: JSON.stringify(input) });
  },
  async walletSummary() {
    return request<{ wallet_balance_ngn: number; points_balance: number; currency: string }>("/api/wallet/summary");
  },
  async walletLedger(limit = 50) {
    return request<{ entries: Array<Record<string, unknown>> }>(`/api/wallet/ledger?limit=${Math.min(100, Math.max(1, Math.floor(limit)))}`);
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
    return request<{ shipment: Record<string, unknown> }>("/api/shipments", { method: "POST", body: JSON.stringify(input) });
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
    return request<{ products: Array<Record<string, unknown>> }>(`/api/catalog?${query.toString()}`);
  },
  async orders(limit = 50) {
    return request<{ orders: Array<Record<string, unknown>> }>(`/api/orders?limit=${Math.min(100, Math.max(1, Math.floor(limit)))}`);
  },
  async createOrder(input: { items: Array<{ productId: string; quantity: number }>; currency?: string }) {
    return request<{ order: Record<string, unknown>; items: Array<Record<string, unknown>> }>("/api/orders", { method: "POST", body: JSON.stringify(input) });
  },
  async notifications(limit = 50) {
    return request<{ notifications: Array<Record<string, unknown>> }>(`/api/notifications?limit=${Math.min(100, Math.max(1, Math.floor(limit)))}`);
  },
  async markNotificationRead(id: string) {
    return request<{ ok: boolean }>(`/api/notifications/${encodeURIComponent(id)}/read`, { method: "PATCH", body: "{}" });
  },
  async adminUsers(limit = 50) {
    return request<{ users: Array<Record<string, unknown>> }>(`/api/admin/users?limit=${Math.min(100, Math.max(1, Math.floor(limit)))}`);
  },
  async updateUser(id: string, input: { role?: "admin" | "user" | "vendor"; is_suspended?: boolean; is_terminated?: boolean }) {
    return request<{ user: Record<string, unknown> }>(`/api/admin/users/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) });
  },
  async adminShipments(limit = 50) {
    return request<{ shipments: Array<Record<string, unknown>> }>(`/api/admin/shipments?limit=${Math.min(100, Math.max(1, Math.floor(limit)))}`);
  },
  async adminReports() {
    return request<{ totalUsers: number; totalShipments: number; totalOrders: number; pendingShipments: number }>("/api/admin/reports");
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
