const API_BASE_URL = (import.meta.env.VITE_NEON_API_URL as string | undefined)?.replace(/\/$/, "");

const TOKEN_KEY = "cloudie_api_token";
const USER_KEY = "cloudie_api_user";

export type NeonUser = {
  id: string;
  email: string;
  name: string | null;
  role: "admin" | "user" | "vendor";
};

export type NeonSession = { user: NeonUser; token?: string };

type ApiErrorBody = { error?: string; message?: string; details?: unknown };

export class NeonApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "NeonApiError";
  }
}

function baseUrl() {
  if (!API_BASE_URL) {
    throw new Error("Neon API is not configured. Set VITE_NEON_API_URL to the Cloudie API base URL.");
  }
  return API_BASE_URL;
}

export function getNeonToken() {
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
    if (session.token) window.sessionStorage.setItem(TOKEN_KEY, session.token);
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
  if (token) headers.set("Authorization", `Bearer ${token}`);
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
};
