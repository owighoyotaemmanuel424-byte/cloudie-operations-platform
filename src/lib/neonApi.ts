const API_BASE_URL = (import.meta.env.VITE_NEON_API_URL as string | undefined)?.replace(/\/$/, "");
const SAME_ORIGIN_API = import.meta.env.VITE_NEON_API_SAME_ORIGIN === "true";
const COOKIE_ONLY_SESSIONS = import.meta.env.VITE_NEON_COOKIE_ONLY === "true";

const TOKEN_KEY = "cloudie_api_token";
const USER_KEY = "cloudie_api_user";
// Truthy marker lets existing auth bootstrap call /api/me while the browser sends its HttpOnly cookie.
const COOKIE_SESSION_MARKER = "__cloudie_cookie_session__";

export type NeonUser = {
  id: string;
  email: string;
  name: string | null;
  role: "admin" | "user" | "vendor";
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
  if (API_BASE_URL) return API_BASE_URL;
  if (SAME_ORIGIN_API) return "";
  throw new Error("Neon API is not configured. Set VITE_NEON_API_URL or enable VITE_NEON_API_SAME_ORIGIN after configuring the same-origin API gateway.");
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

async function request<T>(path: string, init: RequestInit = {}, authenticated = true): Promise<T> {
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
  async tenants() {
    return request<{ tenants: Array<Record<string, unknown>> }>("/api/tenants");
  },
  async adminUsers(limit = 50) {
    return request<{ users: Array<Record<string, unknown>> }>(`/api/admin/users?limit=${Math.min(100, Math.max(1, Math.floor(limit)))}`);
  },
  async walletLedger(limit = 50) {
    return request<{ entries: Array<Record<string, unknown>> }>(`/api/wallet/ledger?limit=${Math.min(100, Math.max(1, Math.floor(limit)))}`);
  },
  async profile() {
    return request<{ profile: Record<string, unknown> }>("/api/profile");
  },
  async notifications(limit = 50) {
    return request<{ notifications: Array<Record<string, unknown>> }>(`/api/notifications?limit=${Math.min(100, Math.max(1, Math.floor(limit)))}`);
  },
  async orders(limit = 50) {
    return request<{ orders: Array<Record<string, unknown>> }>(`/api/orders?limit=${Math.min(100, Math.max(1, Math.floor(limit)))}`);
  },
  async catalog(input: { tenantId?: string; limit?: number } = {}) {
    const query = new URLSearchParams();
    query.set("limit", String(Math.min(100, Math.max(1, Math.floor(input.limit ?? 50)))));
    if (input.tenantId) query.set("tenantId", input.tenantId);
    return request<{ products: Array<Record<string, unknown>> }>(`/api/catalog?${query.toString()}`);
  },
};
