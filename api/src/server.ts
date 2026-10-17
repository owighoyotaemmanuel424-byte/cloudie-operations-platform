import { serve } from "@hono/node-server";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { SignJWT, jwtVerify } from "jose";
import { Pool, type QueryResultRow } from "pg";
import { promisify } from "node:util";
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const scrypt = promisify(scryptCallback);
const port = Number(process.env.PORT ?? 8787);
const databaseUrl = process.env.DATABASE_URL;
const jwtSecretValue = process.env.JWT_SECRET;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!jwtSecretValue || Buffer.byteLength(jwtSecretValue) < 32) throw new Error("JWT_SECRET must be at least 32 bytes");
const jwtSecret = new TextEncoder().encode(jwtSecretValue);
const pool = new Pool({
  connectionString: databaseUrl,
  max: Number(process.env.PG_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: ["localhost", "127.0.0.1", "::1"].includes(new URL(databaseUrl).hostname) ? undefined : { rejectUnauthorized: true },
});
pool.on("error", (error) => console.error("Unexpected idle PostgreSQL client error", error.message));

type User = { id: string; email: string; name: string | null; role: "admin" | "user" | "vendor"; is_suspended: boolean; is_terminated: boolean };
type Variables = { user: User };
const app = new Hono<{ Variables: Variables }>();
const origins = (process.env.CORS_ORIGINS ?? "http://localhost:5173").split(",").map((x) => x.trim()).filter(Boolean);

app.use("*", cors({
  origin: (origin) => origins.includes(origin) ? origin : "",
  credentials: true,
  allowHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"],
  allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  maxAge: 600,
}));
// Reject cross-origin unsafe requests. This complements SameSite cookies and the
// exact CORS allowlist; browser clients must send Origin on cookie-authenticated writes.
app.use("*", async (c, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method)) {
    const origin = c.req.header("origin");
    const hasCookie = Boolean(getCookie(c, "cloudie_session"));
    if ((origin && !origins.includes(origin)) || (hasCookie && !origin)) {
      return c.json({ error: "Cross-origin request rejected" }, 403);
    }
  }
  await next();
});
app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Cache-Control", "no-store");
});

function fail(c: Context, status: 400 | 401 | 403 | 404 | 409 | 429 | 500, message: string) {
  return c.json({ error: message }, status);
}
function tokenFrom(c: Context) {
  const header = c.req.header("authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7);
  return getCookie(c, "cloudie_session");
}
async function signToken(user: User, sessionId: string) {
  return new SignJWT({ email: user.email, role: user.role })
    .setProtectedHeader({ alg: "HS256" }).setSubject(user.id).setJti(sessionId)
    .setIssuedAt().setIssuer("cloudie-neon-api").setAudience("cloudie-web")
    .setExpirationTime("8h").sign(jwtSecret);
}
const auth: MiddlewareHandler<{ Variables: Variables }> = async (c, next) => {
  const token = tokenFrom(c);
  if (!token) return fail(c, 401, "Authentication required");
  let subject: string | undefined;
  let sessionId: string | undefined;
  try {
    const { payload } = await jwtVerify(token, jwtSecret, { issuer: "cloudie-neon-api", audience: "cloudie-web" });
    subject = payload.sub;
    sessionId = payload.jti;
  } catch {
    return fail(c, 401, "Invalid or expired session");
  }
  if (!subject || !sessionId) return fail(c, 401, "Invalid session");
  const activeSession = await pool.query(
    "SELECT id FROM api_sessions WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at > NOW()",
    [sessionId, subject],
  );
  if (activeSession.rowCount !== 1) return fail(c, 401, "Session expired or revoked");
  const result = await pool.query<User & QueryResultRow>(
    "SELECT id,email,name,role,is_suspended,is_terminated FROM app_users WHERE id=$1", [subject],
  );
  const user = result.rows[0];
  if (!user || user.is_suspended || user.is_terminated) return fail(c, 401, "Account unavailable");
  c.set("user", user);
  await next();
};
const adminOnly: MiddlewareHandler<{ Variables: Variables }> = async (c, next) => {
  if (c.get("user").role !== "admin") return fail(c, 403, "Administrator access required");
  await next();
};
const registerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email().max(254),
  password: z.string().min(12).max(128),
});
const loginSchema = z.object({ email: z.email().max(254), password: z.string().min(1).max(128) });
const uuid = () => randomBytes(16).toString("hex");
async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `scrypt:${salt.toString("hex")}:${derived.toString("hex")}`;
}
async function verifyPassword(password: string, encoded: string) {
  const [scheme, saltHex, hashHex] = encoded.split(":");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
async function setSession(c: Context, user: User) {
  const sessionId = uuid();
  const token = await signToken(user, sessionId);
  await pool.query(
    "INSERT INTO api_sessions (id,user_id,expires_at) VALUES ($1,$2,NOW()+INTERVAL '8 hours')",
    [sessionId, user.id],
  );
  setCookie(c, "cloudie_session", token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "Lax",
    path: "/", maxAge: 8 * 60 * 60,
  });
  return token;
}
async function readJson<T>(c: Context, schema: z.ZodType<T>) {
  const raw = await c.req.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  return parsed.success ? { data: parsed.data } : { error: parsed.error.flatten() };
}

app.get("/health", async (c) => {
  try {
    const result = await pool.query("SELECT 1 AS ok");
    return c.json({ ok: result.rows[0]?.ok === 1, service: "cloudie-neon-api", database: "connected", timestamp: new Date().toISOString() });
  } catch {
    return c.json({ ok: false, service: "cloudie-neon-api", database: "unavailable" }, 503);
  }
});
app.get("/api/health", (c) => c.redirect("/health", 307));

/**
 * Registration creates ordinary users only. It deliberately does not accept a role,
 * tenant, wallet balance, or admin flag from the client.
 */
app.post("/api/auth/register", async (c) => {
  const parsed = await readJson(c, registerSchema);
  if ("error" in parsed) return c.json({ error: "Invalid registration details", details: parsed.error }, 400);
  const email = parsed.data.email.trim().toLowerCase();
  const passwordHash = await hashPassword(parsed.data.password);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query<User & QueryResultRow>(
      `INSERT INTO app_users (id,name,email,role,password_hash) VALUES ($1,$2,$3,'user',$4)
       RETURNING id,email,name,role,is_suspended,is_terminated`,
      [uuid(), parsed.data.name, email, passwordHash],
    );
    const user = inserted.rows[0];
    const sessionId = uuid();
    const token = await signToken(user, sessionId);
    await client.query(
      "INSERT INTO api_sessions (id,user_id,expires_at) VALUES ($1,$2,NOW()+INTERVAL '8 hours')",
      [sessionId, user.id],
    );
    await client.query("COMMIT");
    setCookie(c, "cloudie_session", token, {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "Lax",
      path: "/", maxAge: 8 * 60 * 60,
    });
    return c.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } }, 201);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") return fail(c, 409, "An account with this email already exists");
    console.error("Registration failed", error instanceof Error ? error.message : "unknown");
    return fail(c, 500, "Unable to create account");
  } finally { client.release(); }
});

app.post("/api/auth/login", async (c) => {
  const parsed = await readJson(c, loginSchema);
  if ("error" in parsed) return fail(c, 400, "Invalid login details");
  const email = parsed.data.email.trim().toLowerCase();
  const result = await pool.query<User & QueryResultRow & { password_hash: string | null }>(
    "SELECT id,email,name,role,is_suspended,is_terminated,password_hash FROM app_users WHERE lower(email)=lower($1)", [email],
  );
  const user = result.rows[0];
  // Always pay the scrypt cost, even for missing accounts, malformed hashes, or disabled accounts.
  const dummyHash = "scrypt:" + "00".repeat(16) + ":" + "00".repeat(64);
  const passwordValid = await verifyPassword(parsed.data.password, user?.password_hash ?? dummyHash).catch(() => false);
  if (!user || !user.password_hash || !passwordValid || user.is_suspended || user.is_terminated) {
    return fail(c, 401, "Invalid email or password");
  }
  await setSession(c, user);
  return c.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});
app.post("/api/auth/logout", async (c) => {
  const token = tokenFrom(c);
  if (token) {
    try {
      const { payload } = await jwtVerify(token, jwtSecret, { issuer: "cloudie-neon-api", audience: "cloudie-web" });
      if (payload.jti) await pool.query("UPDATE api_sessions SET revoked_at=NOW() WHERE id=$1 AND revoked_at IS NULL", [payload.jti]);
    } catch {
      // Logout should still clear a malformed or expired cookie.
    }
  }
  deleteCookie(c, "cloudie_session", { path: "/" });
  return c.json({ ok: true });
});
app.get("/api/me", auth, (c) => {
  const user = c.get("user");
  return c.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});
app.get("/api/tenants", auth, async (c) => {
  const user = c.get("user");
  const result = user.role === "admin"
    ? await pool.query("SELECT id,site_name,display_name,subdomain,site_type,currency,country,is_active,created_at FROM tenant_sites ORDER BY created_at DESC LIMIT 200")
    : await pool.query(
      `SELECT s.id,s.site_name,s.display_name,s.subdomain,s.site_type,s.currency,s.country,s.is_active,s.created_at
       FROM tenant_sites s LEFT JOIN tenant_users tu ON tu.tenant_id=s.id
       WHERE s.owner_user_id=$1 OR tu.user_id=$1 ORDER BY s.created_at DESC LIMIT 200`, [user.id],
    );
  return c.json({ tenants: result.rows });
});
app.get("/api/admin/users", auth, adminOnly, async (c) => {
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 50), 1), 100);
  const result = await pool.query(
    "SELECT id,email,name,role,is_suspended,is_terminated,created_at FROM app_users ORDER BY created_at DESC LIMIT $1", [limit],
  );
  return c.json({ users: result.rows });
});
app.get("/api/wallet/ledger", auth, async (c) => {
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 50), 1), 100);
  const result = await pool.query(
    "SELECT id,amount_ngn,balance_after_ngn,description,transaction_type,reference,created_at FROM wallet_ledger WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2",
    [c.get("user").id, limit],
  );
  return c.json({ entries: result.rows });
});
app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((error, c) => {
  console.error("Unhandled API error", error.message);
  return c.json({ error: "Internal server error" }, 500);
});

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Cloudie Neon API listening on ${info.port}`);
});
let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  process.exit(0);
};
process.on("SIGTERM", () => { void shutdown(); });
process.on("SIGINT", () => { void shutdown(); });
