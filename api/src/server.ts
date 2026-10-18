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

export const pool = new Pool({
  connectionString: databaseUrl,
  max: Number(process.env.PG_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: ["localhost", "127.0.0.1", "::1"].includes(new URL(databaseUrl).hostname) ? undefined : { rejectUnauthorized: true },
});
pool.on("error", (error: Error) => console.error("Unexpected idle PostgreSQL client error", error.message));

type User = { id: string; email: string; name: string | null; role: "admin" | "user" | "vendor"; is_suspended: boolean; is_terminated: boolean };
type Variables = { user: User };
export const app = new Hono<{ Variables: Variables }>();

const isProduction = process.env.NODE_ENV === "production";
const defaultOrigins = [
  "https://cloudie.wuaze.com",
  ...(isProduction ? [] : ["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:5173"]),
];
const envOrigins = (process.env.CORS_ORIGINS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const configuredOrigins = new Set([...defaultOrigins, ...envOrigins]);

function isAllowedOrigin(origin: string | undefined): boolean {
  // Allow only exact, operator-configured origins. Do not trust shared-host suffixes:
  // unrelated tenants can control subdomains on those platforms.
  return Boolean(origin && configuredOrigins.has(origin));
}

app.use("*", cors({
  origin: (origin) => isAllowedOrigin(origin) ? origin : "",
  credentials: true,
  allowHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"],
  allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  maxAge: 600,
}));

// Protect cookie-authenticated state changes with origin validation and a
// double-submit CSRF token. Bearer clients remain supported during migration.
app.use("*", async (c, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method)) {
    const origin = c.req.header("origin");
    const hasCookie = Boolean(getCookie(c, "cloudie_session"));
    const usesBearer = c.req.header("authorization")?.startsWith("Bearer ") ?? false;
    if ((origin && !isAllowedOrigin(origin)) || (hasCookie && !origin)) {
      return c.json({ error: "Cross-origin request rejected" }, 403);
    }
    if (hasCookie && !usesBearer) {
      const cookieToken = getCookie(c, "cloudie_csrf");
      const headerToken = c.req.header("x-csrf-token");
      const cookieBytes = cookieToken ? Buffer.from(cookieToken, "utf8") : null;
      const headerBytes = headerToken ? Buffer.from(headerToken, "utf8") : null;
      if (!cookieBytes || !headerBytes || cookieBytes.length !== headerBytes.length ||
          !timingSafeEqual(cookieBytes, headerBytes)) {
        return c.json({ error: "CSRF validation failed" }, 403);
      }
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

function setCsrfCookie(c: Context) {
  setCookie(c, "cloudie_csrf", randomBytes(32).toString("hex"), {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Lax",
    path: "/",
    maxAge: 8 * 60 * 60,
  });
}

function fail(c: Context, status: 400 | 401 | 403 | 404 | 409 | 429 | 500, message: string) {
  return c.json({ error: message }, status);
}

function parseLimit(raw: string | undefined, fallback = 50, maximum = 100) {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function tokenFrom(c: Context) {
  const header = c.req.header("authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7);
  return getCookie(c, "cloudie_session");
}

async function signToken(user: User, sessionId: string) {
  return new SignJWT({ email: user.email, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setJti(sessionId)
    .setIssuedAt()
    .setIssuer("cloudie-neon-api")
    .setAudience("cloudie-web")
    .setExpirationTime("8h")
    .sign(jwtSecret);
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
  email: z.string().email().max(254),
  password: z.string().min(12).max(128),
});
const loginSchema = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(128) });
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
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Lax",
    path: "/",
    maxAge: 8 * 60 * 60,
  });
  return token;
}

async function readJson<T>(c: Context, schema: z.ZodType<T>) {
  const raw = await c.req.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  return parsed.success ? { data: parsed.data } : { error: parsed.error.flatten() };
}

/* ════════════════════════════════════════════════════════════════════
   PUBLIC & HEALTH ENDPOINTS
   ════════════════════════════════════════════════════════════════════ */

app.get("/health", async (c) => {
  try {
    const result = await pool.query("SELECT 1 AS ok");
    return c.json({ ok: result.rows[0]?.ok === 1, service: "cloudie-neon-api", database: "connected", timestamp: new Date().toISOString() });
  } catch {
    return c.json({ ok: false, service: "cloudie-neon-api", database: "unavailable" }, 503);
  }
});
app.get("/api/health", (c) => c.redirect("/health", 307));

app.get("/api/auth/csrf", (c) => {
  setCsrfCookie(c);
  return c.json({ ok: true });
});

app.get("/api/public-config", async (c) => {
  const defaultBrand = {
    name: "Cloudie Operations",
    tagline: "Unified operations platform",
    accentColor: "#10b981",
    footerNote: "Shipments, tracking, documents, and payments drawn on one balance."
  };
  const defaultSupport = {
    email: "support@cloudie.wuaze.com",
    phone: "+234 800 256 8343",
    hours: "Mon-Fri 08:00 - 18:00 WAT",
    widgetEnabled: true,
    widgetTitle: "Need help?",
    widgetMessage: "Our support desk replies within one business day.",
    faqs: [
      { question: "What is Cloudie Operations?", answer: "A unified platform connecting shipments, tracking, documents, and business tools." },
      { question: "How does tracking work?", answer: "Enter any active tracking number on the public tracking page for live milestones." }
    ]
  };

  try {
    const brandRow = await pool.query("SELECT value FROM platform_settings WHERE key='brand_config'");
    const supportRow = await pool.query("SELECT value FROM platform_settings WHERE key='support_config'");
    const quickActionsRow = await pool.query("SELECT value FROM platform_settings WHERE key='mobile_quick_actions'");
    return c.json({
      brand: brandRow.rows[0]?.value ?? defaultBrand,
      support: supportRow.rows[0]?.value ?? defaultSupport,
      quickActions: quickActionsRow.rows[0]?.value ?? [],
      hasCustomBrand: Boolean(brandRow.rows[0]),
    });
  } catch {
    return c.json({
      brand: defaultBrand,
      support: defaultSupport,
      quickActions: [],
      hasCustomBrand: false,
    });
  }
});

/* ════════════════════════════════════════════════════════════════════
   AUTHENTICATION ENDPOINTS
   ════════════════════════════════════════════════════════════════════ */

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
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Lax",
      path: "/",
      maxAge: 8 * 60 * 60,
    });
    setCsrfCookie(c);
    return c.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role }, token }, 201);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") return fail(c, 409, "An account with this email already exists");
    console.error("Registration failed", error instanceof Error ? error.message : "unknown");
    return fail(c, 500, "Unable to create account");
  } finally {
    client.release();
  }
});

app.post("/api/auth/login", async (c) => {
  const parsed = await readJson(c, loginSchema);
  if ("error" in parsed) return fail(c, 400, "Invalid login details");
  const email = parsed.data.email.trim().toLowerCase();
  const result = await pool.query<User & QueryResultRow & { password_hash: string | null }>(
    "SELECT id,email,name,role,is_suspended,is_terminated,password_hash FROM app_users WHERE lower(email)=lower($1)", [email],
  );
  const user = result.rows[0];
  const dummyHash = "scrypt:" + "00".repeat(16) + ":" + "00".repeat(64);
  const passwordValid = await verifyPassword(parsed.data.password, user?.password_hash ?? dummyHash).catch(() => false);
  if (!user || !user.password_hash || !passwordValid || user.is_suspended || user.is_terminated) {
    return fail(c, 401, "Invalid email or password");
  }
  const token = await setSession(c, user);
  setCsrfCookie(c);
  return c.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role }, token });
});

app.post("/api/auth/logout", async (c) => {
  const token = tokenFrom(c);
  if (token) {
    try {
      const { payload } = await jwtVerify(token, jwtSecret, { issuer: "cloudie-neon-api", audience: "cloudie-web" });
      if (payload.jti) await pool.query("UPDATE api_sessions SET revoked_at=NOW() WHERE id=$1 AND revoked_at IS NULL", [payload.jti]);
    } catch {
      // Ignored
    }
  }
  deleteCookie(c, "cloudie_session", { path: "/" });
  deleteCookie(c, "cloudie_csrf", { path: "/" });
  return c.json({ ok: true });
});

app.get("/api/me", auth, (c) => {
  const user = c.get("user");
  return c.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

/* ════════════════════════════════════════════════════════════════════
   USER PROFILE & SETTINGS
   ════════════════════════════════════════════════════════════════════ */

app.get("/api/profile", auth, async (c) => {
  const user = c.get("user");
  const result = await pool.query(
    "SELECT id,name,email,role,image,email_verified_at,organization_name,wallet_balance_ngn,points_balance,created_at,updated_at FROM app_users WHERE id=$1",
    [user.id],
  );
  if (!result.rows[0]) return fail(c, 404, "Profile not found");
  return c.json({ profile: result.rows[0] });
});

const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  organization_name: z.string().trim().max(100).optional(),
});

app.patch("/api/profile", auth, async (c) => {
  const parsed = await readJson(c, updateProfileSchema);
  if ("error" in parsed) return fail(c, 400, "Invalid profile payload");
  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  if (parsed.data.name !== undefined) {
    updates.push(`name=$${idx++}`);
    values.push(parsed.data.name);
  }
  if (parsed.data.organization_name !== undefined) {
    updates.push(`organization_name=$${idx++}`);
    values.push(parsed.data.organization_name);
  }
  if (updates.length === 0) return c.json({ ok: true });
  updates.push(`updated_at=NOW()`);
  values.push(c.get("user").id);
  const query = `UPDATE app_users SET ${updates.join(", ")} WHERE id=$${idx} RETURNING id,name,email,role,organization_name,updated_at`;
  const result = await pool.query(query, values);
  return c.json({ profile: result.rows[0] });
});

/* ════════════════════════════════════════════════════════════════════
   WALLET & FINANCIAL LEDGER
   ════════════════════════════════════════════════════════════════════ */

app.get("/api/wallet/summary", auth, async (c) => {
  const result = await pool.query(
    "SELECT wallet_balance_ngn, points_balance FROM app_users WHERE id=$1",
    [c.get("user").id],
  );
  const row = result.rows[0] ?? { wallet_balance_ngn: 0, points_balance: 0 };
  return c.json({
    wallet_balance_ngn: Number(row.wallet_balance_ngn ?? 0),
    points_balance: Number(row.points_balance ?? 0),
    currency: "NGN",
  });
});

app.get("/api/wallet/ledger", auth, async (c) => {
  const limit = parseLimit(c.req.query("limit"));
  const result = await pool.query(
    "SELECT id,amount_ngn,balance_after_ngn,description,transaction_type,reference,created_at FROM wallet_ledger WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2",
    [c.get("user").id, limit],
  );
  return c.json({ entries: result.rows });
});

/* ════════════════════════════════════════════════════════════════════
   SHIPMENTS & PUBLIC TRACKING
   ════════════════════════════════════════════════════════════════════ */

app.get("/api/shipments", auth, async (c) => {
  const limit = parseLimit(c.req.query("limit"));
  const user = c.get("user");
  const queryAll = c.req.query("all") === "true" && user.role === "admin";
  const result = queryAll
    ? await pool.query("SELECT * FROM shipments ORDER BY created_at DESC LIMIT $1", [limit])
    : await pool.query("SELECT * FROM shipments WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2", [user.id, limit]);
  return c.json({ shipments: result.rows });
});

app.get("/api/shipments/:id", auth, async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const result = await pool.query("SELECT * FROM shipments WHERE id=$1", [id]);
  const shipment = result.rows[0];
  if (!shipment) return fail(c, 404, "Shipment not found");
  if (user.role !== "admin" && shipment.user_id !== user.id) {
    return fail(c, 403, "Access denied to this shipment");
  }
  const events = await pool.query(
    "SELECT id,status,location,description,metadata,occurred_at FROM shipment_events WHERE shipment_id=$1 ORDER BY occurred_at DESC",
    [id],
  );
  return c.json({ shipment, events: events.rows });
});

const createShipmentSchema = z.object({
  sender_name: z.string().trim().min(1).max(100),
  sender_phone: z.string().trim().min(1).max(30),
  sender_email: z.string().email().max(254),
  sender_address: z.string().trim().min(1).max(250),
  sender_city: z.string().trim().min(1).max(100),
  sender_state: z.string().trim().min(1).max(100),
  sender_country: z.string().trim().min(1).max(100),
  sender_postal_code: z.string().trim().min(1).max(20),
  recipient_name: z.string().trim().min(1).max(100),
  recipient_phone: z.string().trim().min(1).max(30),
  recipient_email: z.string().email().max(254),
  recipient_address: z.string().trim().min(1).max(250),
  recipient_city: z.string().trim().min(1).max(100),
  recipient_state: z.string().trim().min(1).max(100),
  recipient_country: z.string().trim().min(1).max(100),
  recipient_postal_code: z.string().trim().min(1).max(20),
  package_description: z.string().trim().min(1).max(500),
  weight: z.number().positive(),
  dimensions: z.string().trim().max(100).optional(),
  service_type: z.string().trim().min(1).max(50).default("express"),
  notes: z.string().trim().max(1000).optional(),
});

app.post("/api/shipments", auth, async (c) => {
  const parsed = await readJson(c, createShipmentSchema);
  if ("error" in parsed) return c.json({ error: "Invalid shipment details", details: parsed.error }, 400);
  const data = parsed.data;
  const shipmentId = uuid();
  const trackingNumber = "TRK-" + randomBytes(4).toString("hex").toUpperCase() + Date.now().toString().slice(-4);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO shipments (
        id, user_id, tracking_number, status,
        sender_name, sender_phone, sender_email, sender_address, sender_city, sender_state, sender_country, sender_postal_code,
        recipient_name, recipient_phone, recipient_email, recipient_address, recipient_city, recipient_state, recipient_country, recipient_postal_code,
        package_description, weight, dimensions, service_type, notes
      ) VALUES (
        $1, $2, $3, 'pending',
        $4, $5, $6, $7, $8, $9, $10, $11,
        $12, $13, $14, $15, $16, $17, $18, $19,
        $20, $21, $22, $23, $24
      ) RETURNING *`,
      [
        shipmentId, c.get("user").id, trackingNumber,
        data.sender_name, data.sender_phone, data.sender_email, data.sender_address, data.sender_city, data.sender_state, data.sender_country, data.sender_postal_code,
        data.recipient_name, data.recipient_phone, data.recipient_email, data.recipient_address, data.recipient_city, data.recipient_state, data.recipient_country, data.recipient_postal_code,
        data.package_description, data.weight, data.dimensions ?? null, data.service_type, data.notes ?? null,
      ],
    );
    await client.query(
      "INSERT INTO shipment_events (shipment_id, status, location, description) VALUES ($1, 'pending', $2, 'Shipment scheduled and label created')",
      [shipmentId, `${data.sender_city}, ${data.sender_country}`],
    );
    await client.query("COMMIT");
    return c.json({ shipment: result.rows[0] }, 201);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to create shipment:", error instanceof Error ? error.message : "unknown");
    return fail(c, 500, "Unable to create shipment");
  } finally {
    client.release();
  }
});

const updateShipmentSchema = z.object({
  status: z.enum(['pending','picked_up','in_transit','out_for_delivery','delivered','failed','cancelled']).optional(),
  package_description: z.string().trim().max(500).optional(),
  dimensions: z.string().trim().max(100).optional(),
  weight: z.number().positive().optional(),
  notes: z.string().trim().max(1000).optional(),
  location: z.string().trim().max(200).optional(),
  event_description: z.string().trim().max(500).optional(),
});

app.patch("/api/shipments/:id", auth, async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const parsed = await readJson(c, updateShipmentSchema);
  if ("error" in parsed) return fail(c, 400, "Invalid shipment update details");
  const current = await pool.query("SELECT * FROM shipments WHERE id=$1", [id]);
  if (!current.rows[0]) return fail(c, 404, "Shipment not found");
  if (user.role !== "admin" && current.rows[0].user_id !== user.id) {
    return fail(c, 403, "Access denied to update shipment");
  }

  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (parsed.data.status !== undefined) {
    updates.push(`status=$${idx++}`);
    values.push(parsed.data.status);
  }
  if (parsed.data.package_description !== undefined) {
    updates.push(`package_description=$${idx++}`);
    values.push(parsed.data.package_description);
  }
  if (parsed.data.dimensions !== undefined) {
    updates.push(`dimensions=$${idx++}`);
    values.push(parsed.data.dimensions);
  }
  if (parsed.data.weight !== undefined) {
    updates.push(`weight=$${idx++}`);
    values.push(parsed.data.weight);
  }
  if (parsed.data.notes !== undefined) {
    updates.push(`notes=$${idx++}`);
    values.push(parsed.data.notes);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let updatedShipment = current.rows[0];
    if (updates.length > 0) {
      updates.push(`updated_at=NOW()`);
      values.push(id);
      const query = `UPDATE shipments SET ${updates.join(", ")} WHERE id=$${idx} RETURNING *`;
      const res = await client.query(query, values);
      updatedShipment = res.rows[0];
    }
    if (parsed.data.status && parsed.data.status !== current.rows[0].status) {
      await client.query(
        "INSERT INTO shipment_events (shipment_id, status, location, description) VALUES ($1, $2, $3, $4)",
        [
          id,
          parsed.data.status,
          parsed.data.location ?? null,
          parsed.data.event_description ?? `Shipment status changed to ${parsed.data.status.replace(/_/g, " ")}`,
        ],
      );
    }
    await client.query("COMMIT");
    return c.json({ shipment: updatedShipment });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    return fail(c, 500, "Unable to update shipment");
  } finally {
    client.release();
  }
});

// Public Tracking: safe milestone lookup by tracking number (unauthenticated)
app.get("/api/tracking/:trackingNumber", async (c) => {
  const trackingNumber = c.req.param("trackingNumber").trim().toUpperCase();
  const result = await pool.query(
    `SELECT id, tracking_number, status, service_type,
            sender_city, sender_country,
            recipient_city, recipient_country,
            package_description, weight, estimated_delivery, created_at, updated_at
     FROM shipments WHERE tracking_number=$1`,
    [trackingNumber],
  );
  const shipment = result.rows[0];
  if (!shipment) return fail(c, 404, "Tracking number not found");
  const events = await pool.query(
    "SELECT id, status, location, description, occurred_at FROM shipment_events WHERE shipment_id=$1 ORDER BY occurred_at DESC",
    [shipment.id],
  );
  return c.json({ shipment, events: events.rows });
});

/* ════════════════════════════════════════════════════════════════════
   CATALOG & COMMERCE ORDERS
   ════════════════════════════════════════════════════════════════════ */

app.get("/api/catalog", async (c) => {
  const limit = parseLimit(c.req.query("limit"));
  const tenantId = c.req.query("tenantId")?.trim();
  const result = tenantId
    ? await pool.query(
      "SELECT id,tenant_id,sku,name,description,category,price_minor,currency,metadata,updated_at FROM catalog_products WHERE is_active=TRUE AND (tenant_id IS NULL OR tenant_id=$1) ORDER BY category,name LIMIT $2",
      [tenantId, limit],
    )
    : await pool.query(
      "SELECT id,tenant_id,sku,name,description,category,price_minor,currency,metadata,updated_at FROM catalog_products WHERE is_active=TRUE AND tenant_id IS NULL ORDER BY category,name LIMIT $1",
      [limit],
    );
  return c.json({ products: result.rows });
});

const createOrderSchema = z.object({
  items: z.array(z.object({
    productId: z.string().min(1),
    quantity: z.number().int().positive().default(1),
  })).min(1),
  currency: z.string().length(3).default("NGN"),
});

app.post("/api/orders", auth, async (c) => {
  const parsed = await readJson(c, createOrderSchema);
  if ("error" in parsed) return fail(c, 400, "Invalid order request");
  const orderId = uuid();
  const userId = c.get("user").id;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let subtotal = 0;
    const resolvedItems: Array<{ id: string; name: string; price_minor: number; quantity: number }> = [];

    for (const item of parsed.data.items) {
      const prodRes = await client.query(
        "SELECT id, name, price_minor FROM catalog_products WHERE id=$1 AND is_active=TRUE",
        [item.productId],
      );
      if (!prodRes.rows[0]) throw new Error(`Product not found or inactive: ${item.productId}`);
      const prod = prodRes.rows[0];
      const lineTotal = Number(prod.price_minor) * item.quantity;
      subtotal += lineTotal;
      resolvedItems.push({ id: prod.id, name: prod.name, price_minor: Number(prod.price_minor), quantity: item.quantity });
    }

    const fee = 0;
    const total = subtotal + fee;

    const orderRes = await client.query(
      `INSERT INTO commerce_orders (id, user_id, status, currency, subtotal_minor, fee_minor, total_minor)
       VALUES ($1, $2, 'pending', $3, $4, $5, $6) RETURNING *`,
      [orderId, userId, parsed.data.currency, subtotal, fee, total],
    );

    for (const item of resolvedItems) {
      await client.query(
        `INSERT INTO commerce_order_items (order_id, product_id, product_name_snapshot, quantity, unit_price_minor, line_total_minor)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [orderId, item.id, item.name, item.quantity, item.price_minor, item.price_minor * item.quantity],
      );
    }

    await client.query("COMMIT");
    return c.json({ order: orderRes.rows[0], items: resolvedItems }, 201);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    return fail(c, 400, error instanceof Error ? error.message : "Failed to place order");
  } finally {
    client.release();
  }
});

app.get("/api/orders", auth, async (c) => {
  const limit = parseLimit(c.req.query("limit"));
  const result = await pool.query(
    "SELECT id,tenant_id,status,currency,subtotal_minor,fee_minor,total_minor,created_at,updated_at FROM commerce_orders WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2",
    [c.get("user").id, limit],
  );
  return c.json({ orders: result.rows });
});

/* ════════════════════════════════════════════════════════════════════
   NOTIFICATIONS & TENANTS
   ════════════════════════════════════════════════════════════════════ */

app.get("/api/notifications", auth, async (c) => {
  const limit = parseLimit(c.req.query("limit"));
  const result = await pool.query(
    "SELECT id,tenant_id,category,title,body,read_at,action_url,created_at FROM user_notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2",
    [c.get("user").id, limit],
  );
  return c.json({ notifications: result.rows });
});

app.patch("/api/notifications/:id/read", auth, async (c) => {
  const id = c.req.param("id");
  await pool.query("UPDATE user_notifications SET read_at=NOW() WHERE id=$1 AND user_id=$2", [id, c.get("user").id]);
  return c.json({ ok: true });
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

/* ════════════════════════════════════════════════════════════════════
   ADMINISTRATOR OPERATIONS
   ════════════════════════════════════════════════════════════════════ */

app.get("/api/admin/users", auth, adminOnly, async (c) => {
  const limit = parseLimit(c.req.query("limit"));
  const result = await pool.query(
    "SELECT id,email,name,role,is_suspended,is_terminated,created_at FROM app_users ORDER BY created_at DESC LIMIT $1", [limit],
  );
  return c.json({ users: result.rows });
});

const updateUserStatusSchema = z.object({
  role: z.enum(["admin", "user", "vendor"]).optional(),
  is_suspended: z.boolean().optional(),
  is_terminated: z.boolean().optional(),
});

app.patch("/api/admin/users/:id", auth, adminOnly, async (c) => {
  const targetId = c.req.param("id");
  const parsed = await readJson(c, updateUserStatusSchema);
  if ("error" in parsed) return fail(c, 400, "Invalid user update");
  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  if (parsed.data.role !== undefined) {
    updates.push(`role=$${idx++}`);
    values.push(parsed.data.role);
  }
  if (parsed.data.is_suspended !== undefined) {
    updates.push(`is_suspended=$${idx++}`);
    values.push(parsed.data.is_suspended);
  }
  if (parsed.data.is_terminated !== undefined) {
    updates.push(`is_terminated=$${idx++}`);
    values.push(parsed.data.is_terminated);
  }
  if (updates.length === 0) return c.json({ ok: true });
  updates.push(`updated_at=NOW()`);
  values.push(targetId);
  const result = await pool.query(`UPDATE app_users SET ${updates.join(", ")} WHERE id=$${idx} RETURNING id,name,email,role,is_suspended,is_terminated`, values);
  return c.json({ user: result.rows[0] });
});

app.get("/api/admin/shipments", auth, adminOnly, async (c) => {
  const limit = parseLimit(c.req.query("limit"));
  const result = await pool.query("SELECT * FROM shipments ORDER BY created_at DESC LIMIT $1", [limit]);
  return c.json({ shipments: result.rows });
});

const createProductSchema = z.object({
  name: z.string().trim().min(1).max(150),
  category: z.string().trim().min(1).max(50),
  price_minor: z.number().int().nonnegative(),
  currency: z.string().length(3).default("NGN"),
  description: z.string().trim().max(1000).optional(),
  sku: z.string().trim().max(100).optional(),
  provider: z.string().trim().max(50).optional(),
});

app.post("/api/admin/catalog", auth, adminOnly, async (c) => {
  const parsed = await readJson(c, createProductSchema);
  if ("error" in parsed) return fail(c, 400, "Invalid catalog product");
  const id = uuid();
  const d = parsed.data;
  const result = await pool.query(
    `INSERT INTO catalog_products (id, sku, name, description, category, provider, price_minor, currency)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [id, d.sku ?? null, d.name, d.description ?? null, d.category, d.provider ?? null, d.price_minor, d.currency],
  );
  return c.json({ product: result.rows[0] }, 201);
});

app.patch("/api/admin/catalog/:id", auth, adminOnly, async (c) => {
  const id = c.req.param("id");
  const parsed = await readJson(c, createProductSchema.partial());
  if ("error" in parsed) return fail(c, 400, "Invalid update");
  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  if (parsed.data.name !== undefined) { updates.push(`name=$${idx++}`); values.push(parsed.data.name); }
  if (parsed.data.price_minor !== undefined) { updates.push(`price_minor=$${idx++}`); values.push(parsed.data.price_minor); }
  if (parsed.data.category !== undefined) { updates.push(`category=$${idx++}`); values.push(parsed.data.category); }
  if (parsed.data.description !== undefined) { updates.push(`description=$${idx++}`); values.push(parsed.data.description); }
  if (updates.length === 0) return c.json({ ok: true });
  updates.push(`updated_at=NOW()`);
  values.push(id);
  const result = await pool.query(`UPDATE catalog_products SET ${updates.join(", ")} WHERE id=$${idx} RETURNING *`, values);
  return c.json({ product: result.rows[0] });
});

app.delete("/api/admin/catalog/:id", auth, adminOnly, async (c) => {
  const id = c.req.param("id");
  await pool.query("UPDATE catalog_products SET is_active=FALSE WHERE id=$1", [id]);
  return c.json({ ok: true });
});

app.get("/api/admin/settings", auth, adminOnly, async (c) => {
  const result = await pool.query("SELECT key, value, updated_at FROM platform_settings ORDER BY key");
  return c.json({ settings: result.rows });
});

const updateSettingSchema = z.object({
  key: z.string().trim().min(1).max(100),
  value: z.unknown(),
});

app.post("/api/admin/settings", auth, adminOnly, async (c) => {
  const parsed = await readJson(c, updateSettingSchema);
  if ("error" in parsed) return fail(c, 400, "Invalid setting payload");
  await pool.query(
    `INSERT INTO platform_settings (key, value, updated_at, updated_by)
     VALUES ($1, $2, NOW(), $3)
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW(), updated_by=EXCLUDED.updated_by`,
    [parsed.data.key, JSON.stringify(parsed.data.value), c.get("user").id],
  );
  return c.json({ ok: true });
});

app.get("/api/admin/reports", auth, adminOnly, async (c) => {
  const usersCount = await pool.query("SELECT COUNT(*) AS count FROM app_users");
  const shipmentsCount = await pool.query("SELECT COUNT(*) AS count FROM shipments");
  const ordersCount = await pool.query("SELECT COUNT(*) AS count FROM commerce_orders");
  const pendingShipments = await pool.query("SELECT COUNT(*) AS count FROM shipments WHERE status='pending'");
  return c.json({
    totalUsers: Number(usersCount.rows[0]?.count ?? 0),
    totalShipments: Number(shipmentsCount.rows[0]?.count ?? 0),
    totalOrders: Number(ordersCount.rows[0]?.count ?? 0),
    pendingShipments: Number(pendingShipments.rows[0]?.count ?? 0),
  });
});

app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((error: Error, c) => {
  console.error("Unhandled API error", error.message);
  return c.json({ error: "Internal server error" }, 500);
});

// Export the Hono app for isolated HTTP-level tests. Tests set NODE_ENV=test before
// importing this module so they never bind a port or require a live database.
const server = process.env.NODE_ENV === "test" ? undefined : serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Cloudie Neon API listening on ${info.port}`);
});

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  process.exit(0);
};
process.on("SIGTERM", () => { void shutdown(); });
process.on("SIGINT", () => { void shutdown(); });
