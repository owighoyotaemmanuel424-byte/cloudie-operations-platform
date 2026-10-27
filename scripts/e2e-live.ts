/**
 * Live end-to-end verification of the Neon API against the real DATABASE_URL.
 *
 * Registers a disposable user, exercises the migrated tables through the actual
 * Hono app (auth, sessions, notifications, catalog, orders, wallet, admin audit
 * logs, cookie/CSRF mode), then deletes every row it created. No production
 * secrets are printed; the JWT secret is ephemeral to this process.
 *
 * Usage: node --import tsx api/scripts/e2e-live.ts
 * Requires: DATABASE_URL in the environment.
 */
process.env.NODE_ENV = "test";
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = "e2e-ephemeral-" + "0123456789abcdef".repeat(4);
}

const { app, pool } = await import("../api/src/server.js");

const failures: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
}

async function call(path: string, init: RequestInit = {}) {
  const response = await app.request(path, init);
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    /* non-JSON */
  }
  return { status: response.status, body: body as Record<string, unknown> | null, headers: response.headers };
}

const stamp = Date.now();
const email = `neon-e2e-${stamp}@example.invalid`;

// ── 1. Registration against the live schema ────────────────────────────────
const reg = await call("/api/auth/register", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "Neon E2E", email, password: "e2e-password-123" }),
});
check("register creates account", reg.status === 201, `HTTP ${reg.status}`);
const token = (reg.body?.token as string | undefined) ?? "";
const userId = (reg.body?.user as { id?: string } | undefined)?.id ?? "";
check("register returns bearer token + user id", Boolean(token && userId));

// ── 2. Session-backed reads across migrated tables ─────────────────────────
const auth = { Authorization: `Bearer ${token}` };
const me = await call("/api/me", { headers: auth });
check("GET /api/me returns profile", me.status === 200 && ((me.body?.user as { email?: string } | undefined)?.email) === email, `HTTP ${me.status}`);

const notifications = await call("/api/notifications", { headers: auth });
check("GET /api/notifications (user_notifications)", notifications.status === 200 && Array.isArray(notifications.body?.notifications), `HTTP ${notifications.status}`);

const catalog = await call("/api/catalog", { headers: auth });
check("GET /api/catalog (catalog_products)", catalog.status === 200, `HTTP ${catalog.status}`);

const orders = await call("/api/orders", { headers: auth });
check("GET /api/orders (commerce_orders)", orders.status === 200, `HTTP ${orders.status}`);

const ledger = await call("/api/wallet/ledger", { headers: auth });
check("GET /api/wallet/ledger (wallet_ledger)", ledger.status === 200, `HTTP ${ledger.status}`);

const summary = await call("/api/wallet/summary", { headers: auth });
check("GET /api/wallet/summary (app_users balances)", summary.status === 200, `HTTP ${summary.status}`);

const tenants = await call("/api/tenants", { headers: auth });
check("GET /api/tenants (tenant_sites)", tenants.status === 200, `HTTP ${tenants.status}`);

// ── 3. Admin audit trail: write path + read path via the new table ─────────
await pool.query("UPDATE app_users SET role = 'admin' WHERE id = $1", [userId]);
const adminAuth = { Authorization: `Bearer ${token}` };
const update = await call(`/api/admin/users/${userId}`, {
  method: "PATCH",
  headers: { ...adminAuth, "Content-Type": "application/json" },
  // updateUserStatusSchema only accepts role/suspension fields; `name` would be
  // stripped and the handler would no-op before writing the audit row.
  body: JSON.stringify({ role: "admin", reason: "e2e audit-path verification" }),
});
check("PATCH /api/admin/users/:id (admin, writes audit log)", update.status === 200 || update.status === 204, `HTTP ${update.status}`);

const audit = await call("/api/admin/audit-logs?limit=10", { headers: adminAuth });
const logs = (audit.body?.logs as Array<{ action: string }> | undefined) ?? [];
check("GET /api/admin/audit-logs returns rows from admin_audit_logs", audit.status === 200 && logs.some((l) => l.action === "user.update"), `HTTP ${audit.status}, ${logs.length} rows`);

// ── 4. Cookie + CSRF mode against the live database ────────────────────────
const login = await call("/api/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" },
  body: JSON.stringify({ email, password: "e2e-password-123" }),
});
check("login issues session (cookie mode)", login.status === 200, `HTTP ${login.status}`);
const cookieHeader = login.headers.get("set-cookie") ?? "";
const sessionCookie = cookieHeader.split(";")[0] ?? "";
const csrfCookie = (cookieHeader.match(/cloudie_csrf=([^;]+)/) ?? [])[1] ?? "";
check("login sets HttpOnly session + CSRF cookies", sessionCookie.startsWith("cloudie_session=") && Boolean(csrfCookie));

const cookieNoCsrf = await call("/api/notifications/read-all", {
  method: "POST",
  headers: { Cookie: sessionCookie, Origin: "http://localhost:5173", "Content-Type": "application/json" },
});
check("cookie POST without CSRF token is rejected (403)", cookieNoCsrf.status === 403, `HTTP ${cookieNoCsrf.status}`);

const cookieWithCsrf = await call("/api/notifications/read-all", {
  method: "POST",
  headers: { Cookie: `${sessionCookie}; cloudie_csrf=${csrfCookie}`, Origin: "http://localhost:5173", "X-CSRF-Token": csrfCookie, "Content-Type": "application/json" },
});
check("cookie POST with matching CSRF token succeeds", cookieWithCsrf.status === 200 || cookieWithCsrf.status === 204, `HTTP ${cookieWithCsrf.status}`);

// ── 5. Duplicate registration + logout revocation ──────────────────────────
const dup = await call("/api/auth/register", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "Dup", email, password: "e2e-password-123" }),
});
check("duplicate registration rejected (409)", dup.status === 409, `HTTP ${dup.status}`);

const logout = await call("/api/auth/logout", {
  method: "POST",
  headers: { ...auth, "Content-Type": "application/json" },
});
check("logout succeeds", logout.status === 200 || logout.status === 204, `HTTP ${logout.status}`);

const afterLogout = await call("/api/me", { headers: auth });
check("revoked session is rejected after logout", afterLogout.status === 401, `HTTP ${afterLogout.status}`);

// ── 6. Cleanup: remove every row this script created ───────────────────────
await pool.query("DELETE FROM admin_audit_logs WHERE actor_user_id = $1 OR target_user_id = $1", [userId]);
await pool.query("DELETE FROM app_users WHERE id = $1", [userId]);
const leftover = await pool.query("SELECT COUNT(*)::int AS n FROM app_users WHERE id = $1", [userId]);
check("cleanup removed the test user (sessions cascade)", leftover.rows[0].n === 0);

await pool.end();

console.log(failures.length === 0 ? "\nE2E: all checks passed" : `\nE2E: ${failures.length} check(s) failed`);
if (failures.length > 0) process.exit(1);
