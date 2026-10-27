import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { SignJWT } from "jose";

// Node's scrypt takes a callback; the promise form is what the server uses.
const scryptAsync = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

// Configure before importing server.ts: this keeps the app unbound to a port and
// prevents these middleware tests from requiring a reachable PostgreSQL instance.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgres://cloudie_test:cloudie_test@127.0.0.1:5432/cloudie_test";
process.env.JWT_SECRET = "test-only-secret-that-is-longer-than-thirty-two-bytes";
process.env.CORS_ORIGINS = "http://localhost:5173";

const { app, pool, shouldProvisionSchema } = await import("./server.js");

test("boot provisioning only touches a database that is missing required tables", () => {
  // Brand-new database behind a working connection string: provision it.
  assert.equal(shouldProvisionSchema({ enabled: true, missingTableCount: 8, guardTablePresent: false }), true);
  // Healthy database: never rewrite or migrate it on boot.
  assert.equal(shouldProvisionSchema({ enabled: true, missingTableCount: 0, guardTablePresent: false }), false);
  // Disposable migration-test branch: never write there, even though it is bare.
  assert.equal(shouldProvisionSchema({ enabled: true, missingTableCount: 8, guardTablePresent: true }), false);
  // Operator disabled it on purpose.
  assert.equal(shouldProvisionSchema({ enabled: false, missingTableCount: 8, guardTablePresent: false }), false);
});

test("rejects unsafe requests from an untrusted browser origin", async () => {
  const response = await app.request("/api/auth/logout", {
    method: "POST",
    headers: {
      Origin: "https://untrusted.example",
      "Content-Type": "application/json",
    },
    body: "{}",
  });

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Cross-origin request rejected" });
});

test("rejects cookie-authenticated unsafe requests without an Origin header", async () => {
  const response = await app.request("/api/auth/logout", {
    method: "POST",
    headers: {
      Cookie: "cloudie_session=present",
      "Content-Type": "application/json",
    },
    body: "{}",
  });

  assert.equal(response.status, 403);
});

test("does not reflect an untrusted origin in CORS response headers", async () => {
  const response = await app.request("/api/health", {
    headers: { Origin: "https://untrusted.example" },
  });

  assert.equal(response.headers.get("access-control-allow-origin"), null);
});

test("adds baseline security headers to ordinary API responses", async () => {
  const response = await app.request("/does-not-exist");

  assert.equal(response.status, 404);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("allows a trusted origin for a non-cookie logout request", async () => {
  const response = await app.request("/api/auth/logout", {
    method: "POST",
    headers: { Origin: "http://localhost:5173", "Content-Type": "application/json" },
    body: "{}",
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test("requires a CSRF token for cookie-authenticated unsafe requests", async () => {
  const response = await app.request("/api/auth/logout", {
    method: "POST",
    headers: {
      Origin: "http://localhost:5173",
      Cookie: "cloudie_session=present",
      "Content-Type": "application/json",
    },
    body: "{}",
  });

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "CSRF validation failed" });
});

test("rejects a mismatched CSRF cookie and header", async () => {
  const response = await app.request("/api/auth/logout", {
    method: "POST",
    headers: {
      Origin: "http://localhost:5173",
      Cookie: "cloudie_session=present; cloudie_csrf=expected-token",
      "X-CSRF-Token": "different-token",
      "Content-Type": "application/json",
    },
    body: "{}",
  });

  assert.equal(response.status, 403);
});

test("rejects malformed non-ASCII CSRF tokens without throwing", async () => {
  const response = await app.request("/api/auth/logout", {
    method: "POST",
    headers: {
      Origin: "http://localhost:5173",
      Cookie: "cloudie_session=present; cloudie_csrf=é",
      "X-CSRF-Token": "é",
      "Content-Type": "application/json",
    },
    body: "{}",
  });

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "CSRF validation failed" });
});

test("accepts a matching CSRF cookie and header and clears both cookies on logout", async () => {
  const response = await app.request("/api/auth/logout", {
    method: "POST",
    headers: {
      Origin: "http://localhost:5173",
      Cookie: "cloudie_session=present; cloudie_csrf=matching-token",
      "X-CSRF-Token": "matching-token",
      "Content-Type": "application/json",
    },
    body: "{}",
  });

  assert.equal(response.status, 200);
  const setCookie = response.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /cloudie_session/);
  assert.match(setCookie, /cloudie_csrf/);
});

test("issues a random CSRF cookie without exposing the token in JSON", async () => {
  const response = await app.request("/api/auth/csrf", {
    headers: { Origin: "http://localhost:5173" },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  const setCookie = response.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /cloudie_csrf=/);
  assert.doesNotMatch(setCookie, /HttpOnly/i);
});

test("rejects unauthenticated access to protected and administrator routes", async () => {
  const protectedResponse = await app.request("/api/me");
  const adminResponse = await app.request("/api/admin/users");

  assert.equal(protectedResponse.status, 401);
  assert.equal(adminResponse.status, 401);
});

test("rejects malformed registration and login payloads before database access", async () => {
  const registration = await app.request("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "", email: "not-an-email", password: "short" }),
  });
  const login = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "not-an-email", password: "" }),
  });

  assert.equal(registration.status, 400);
  assert.equal(login.status, 400);
});

test("returns 503 on readiness, but stays live, when the configured PostgreSQL database is unavailable", async () => {
  const mutablePool = pool as unknown as { query: (...args: unknown[]) => Promise<unknown> };
  const originalQuery = mutablePool.query;
  mutablePool.query = async () => { throw new Error("simulated database outage"); };
  try {
    // Liveness must not depend on PostgreSQL, or a database outage would make
    // the platform kill an otherwise healthy instance.
    const liveness = await app.request("/health");
    assert.equal(liveness.status, 200);
    const liveBody = await liveness.json() as { ok?: boolean };
    assert.equal(liveBody.ok, true);

    const response = await app.request("/ready");
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      ok: false,
      service: "cloudie-neon-api",
      database: "unavailable",
    });
  } finally {
    mutablePool.query = originalQuery;
  }
});

test("reports a missing database schema as 503 provisioning, not 500, on sign-in", async () => {
  const mutablePool = pool as unknown as { query: (...args: unknown[]) => Promise<unknown> };
  const originalQuery = mutablePool.query;
  mutablePool.query = async () => {
    const error = new Error('relation "app_users" does not exist') as Error & { code: string };
    error.code = "42P01";
    throw error;
  };
  try {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:5173",
        "X-Forwarded-For": "203.0.113.205",
      },
      body: JSON.stringify({ email: "owner@example.com", password: "long-enough-password" }),
    });
    assert.equal(response.status, 503);
    const data = await response.json() as { error?: string; code?: string };
    assert.equal(data.code, "schema_missing");
    assert.match(String(data.error), /database schema is missing or incomplete/);
  } finally {
    mutablePool.query = originalQuery;
  }
});

test("reports a missing database schema as 503 provisioning, not 500, on registration", async () => {
  const mutablePool = pool as unknown as { connect: () => Promise<unknown> };
  const originalConnect = mutablePool.connect;
  mutablePool.connect = async () => {
    const error = new Error('relation "app_users" does not exist') as Error & { code: string };
    error.code = "42P01";
    return {
      async query() {
        throw error;
      },
      release() {},
    };
  };
  try {
    const response = await app.request("/api/auth/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:5173",
        "X-Forwarded-For": "203.0.113.206",
      },
      body: JSON.stringify({
        name: "Provisioning Probe",
        email: "provisioning-probe@example.com",
        password: "a-long-enough-password",
      }),
    });
    assert.equal(response.status, 503);
    const data = await response.json() as { error?: string; code?: string };
    assert.equal(data.code, "schema_missing");
    assert.match(String(data.error), /database schema is missing or incomplete/);
  } finally {
    mutablePool.connect = originalConnect;
  }
});

test("denies a non-admin session from administrator-only user management", async () => {
  const secret = new TextEncoder().encode(process.env.JWT_SECRET);
  const token = await new SignJWT({ email: "user@example.com", role: "user" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("test-user")
    .setJti("test-session")
    .setIssuedAt()
    .setIssuer("cloudie-neon-api")
    .setAudience("cloudie-web")
    .setExpirationTime("5m")
    .sign(secret);
  const mutablePool = pool as unknown as { query: (...args: unknown[]) => Promise<unknown> };
  const originalQuery = mutablePool.query;
  mutablePool.query = async (...args: unknown[]) => {
    const sql = String(args[0] ?? "");
    if (sql.includes("FROM api_sessions")) return { rows: [{ id: "test-session" }], rowCount: 1 };
    if (sql.includes("FROM app_users")) return {
      rows: [{
        id: "test-user",
        email: "user@example.com",
        name: "Test User",
        role: "user",
        is_suspended: false,
        is_terminated: false,
      }],
      rowCount: 1,
    };
    throw new Error("Unexpected database query in authorization test");
  };

  try {
    const response = await app.request("/api/admin/users", {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "Administrator access required" });
  } finally {
    mutablePool.query = originalQuery;
  }
});

test("rejects revoked or expired server-side sessions", async () => {
  const secret = new TextEncoder().encode(process.env.JWT_SECRET);
  const token = await new SignJWT({ email: "user@example.com", role: "user" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("test-user")
    .setJti("revoked-session")
    .setIssuedAt()
    .setIssuer("cloudie-neon-api")
    .setAudience("cloudie-web")
    .setExpirationTime("5m")
    .sign(secret);
  const mutablePool = pool as unknown as { query: (...args: unknown[]) => Promise<unknown> };
  const originalQuery = mutablePool.query;
  mutablePool.query = async () => ({ rows: [], rowCount: 0 });
  try {
    const response = await app.request("/api/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Session expired or revoked" });
  } finally {
    mutablePool.query = originalQuery;
  }
});

test("returns public platform configuration without authentication", async () => {
  const response = await app.request("/api/public-config");
  assert.equal(response.status, 200);
  const data = await response.json() as { brand?: { name?: string }, support?: { widgetEnabled?: boolean } };
  assert.ok(data.brand);
  assert.equal(typeof data.brand?.name, "string");
  assert.ok(data.support);
});

test("returns 404 for nonexistent tracking number", async () => {
  const mutablePool = pool as unknown as { query: (...args: unknown[]) => Promise<unknown> };
  const originalQuery = mutablePool.query;
  mutablePool.query = async () => ({ rows: [], rowCount: 0 });
  try {
    const response = await app.request("/api/tracking/TRK-NONEXISTENT");
    assert.equal(response.status, 404);
    const data = await response.json() as { error?: string };
    assert.equal(data.error, "Tracking number not found");
  } finally {
    mutablePool.query = originalQuery;
  }
});

test("responds on /ready when database and schema are reachable", async () => {
  const mutablePool = pool as unknown as { query: (...args: unknown[]) => Promise<unknown> };
  const originalQuery = mutablePool.query;
  mutablePool.query = async (sql: unknown) => {
    if (String(sql).includes("information_schema.tables")) {
      return {
        rows: [
          "app_users", "api_sessions", "platform_settings", "tenant_sites",
          "wallet_ledger", "shipments", "user_notifications", "admin_audit_logs",
        ].map((table_name) => ({ table_name })),
        rowCount: 8,
      };
    }
    return { rows: [{ ok: 1 }], rowCount: 1 };
  };
  try {
    const response = await app.request("/ready");
    assert.equal(response.status, 200);
    const data = await response.json() as { ok?: boolean; database?: string; schema?: string };
    assert.equal(data.ok, true);
    assert.equal(data.database, "connected");
    assert.equal(data.schema, "complete");
  } finally {
    mutablePool.query = originalQuery;
  }
});

test("refuses readiness when the database answers but the required schema is missing", async () => {
  const mutablePool = pool as unknown as { query: (...args: unknown[]) => Promise<unknown> };
  const originalQuery = mutablePool.query;
  mutablePool.query = async (sql: unknown) => {
    const text = String(sql);
    // A fresh or wrong database: ping works, every table query would 500.
    if (text.includes("information_schema.tables")) {
      return { rows: [], rowCount: 0 };
    }
    if (text.includes("pg_class c JOIN pg_namespace")) {
      return { rows: [{ count: "2", guard: true }], rowCount: 1 };
    }
    return { rows: [{ ok: 1 }], rowCount: 1 };
  };
  try {
    const response = await app.request("/ready");
    assert.equal(response.status, 503);
    const data = await response.json() as {
      ok?: boolean; database?: string; schema?: string; missing?: string[];
      publicTableCount?: number; migrationGuardPresent?: boolean;
    };
    assert.equal(data.ok, false);
    assert.equal(data.database, "connected");
    assert.equal(data.schema, "incomplete");
    assert.ok(Array.isArray(data.missing) && data.missing.includes("app_users"));
    assert.ok(data.missing.includes("api_sessions"));
    // The inventory line is what distinguishes a brand-new database from the
    // disposable migration-test branch (guard table present).
    assert.equal(data.publicTableCount, 2);
    assert.equal(data.migrationGuardPresent, true);
  } finally {
    mutablePool.query = originalQuery;
  }
});

test("enforces rate limiting on repeated login attempts from the same IP", async () => {
  let lastStatus = 200;
  for (let i = 0; i < 21; i += 1) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": "203.0.113.99",
        "X-Test-Rate-Limit": "1",
      },
      body: JSON.stringify({ email: "invalid", password: "" }),
    });
    lastStatus = response.status;
  }
  assert.equal(lastStatus, 429);
});

/**
 * Session-cookie profile. The cutover gates require proof that the browser
 * session is HttpOnly + SameSite with a bounded lifetime before any cookie-only
 * cutover, and that production additionally marks it Secure. Both are asserted
 * here against the real login handler rather than assumed from source.
 */
test("login issues an HttpOnly, SameSite=Lax session cookie with a bounded lifetime", async () => {
  const password = "correct horse battery staple";
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, 64);
  const passwordHash = `scrypt:${salt.toString("hex")}:${derived.toString("hex")}`;
  const mutablePool = pool as unknown as { query: (...args: unknown[]) => Promise<unknown> };
  const originalQuery = mutablePool.query;
  mutablePool.query = async (sql: unknown) => {
    if (String(sql).includes("FROM app_users")) {
      return {
        rows: [
          {
            id: "cookie-test-user",
            email: "cookie@example.com",
            name: "Cookie Test",
            role: "user",
            is_suspended: false,
            is_terminated: false,
            password_hash: passwordHash,
          },
        ],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 0 };
  };
  try {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:5173",
        "X-Forwarded-For": "203.0.113.101",
      },
      body: JSON.stringify({ email: "cookie@example.com", password }),
    });
    assert.equal(response.status, 200);
    const headers = response.headers as Headers & { getSetCookie?: () => string[] };
    const cookies = headers.getSetCookie?.() ?? [headers.get("set-cookie") ?? ""];
    const sessionCookie = cookies.find((cookie) => cookie.startsWith("cloudie_session=")) ?? "";
    assert.notEqual(sessionCookie, "", `expected a cloudie_session cookie, got: ${cookies.join(" | ")}`);
    assert.match(sessionCookie, /HttpOnly/i);
    assert.match(sessionCookie, /SameSite=Lax/i);
    assert.match(sessionCookie, /Path=\//i);
    assert.match(sessionCookie, /Max-Age=28800/i);
    // NODE_ENV is "test" here; production is asserted separately below.
    assert.doesNotMatch(sessionCookie, /Secure/i);

    process.env.NODE_ENV = "production";
    const productionResponse = await app.request("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:5173",
        "X-Forwarded-For": "203.0.113.102",
      },
      body: JSON.stringify({ email: "cookie@example.com", password }),
    });
    assert.equal(productionResponse.status, 200);
    const productionCookies =
      (productionResponse.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    const productionSession = productionCookies.find((cookie) => cookie.startsWith("cloudie_session=")) ?? "";
    assert.match(productionSession, /Secure/i);
  } finally {
    process.env.NODE_ENV = "test";
    mutablePool.query = originalQuery;
  }
});

/**
 * Disabled accounts. Login must refuse suspended and terminated users with the
 * same response as a bad password (no account-state oracle) and must not mint a
 * session cookie when it does.
 */
test("refuses login for suspended and terminated accounts without issuing a session", async () => {
  const password = "correct horse battery staple";
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, 64);
  const passwordHash = `scrypt:${salt.toString("hex")}:${derived.toString("hex")}`;
  const mutablePool = pool as unknown as { query: (...args: unknown[]) => Promise<unknown> };
  const originalQuery = mutablePool.query;
  const account = (flags: { is_suspended: boolean; is_terminated: boolean }) => ({
    rows: [
      {
        id: "disabled-test-user",
        email: "disabled@example.com",
        name: "Disabled Test",
        role: "user",
        ...flags,
        password_hash: passwordHash,
      },
    ],
    rowCount: 1,
  });
  try {
    for (const [index, flags] of [
      { is_suspended: true, is_terminated: false },
      { is_suspended: false, is_terminated: true },
    ].entries()) {
      mutablePool.query = async (sql: unknown) =>
        String(sql).includes("FROM app_users") ? account(flags) : { rows: [], rowCount: 0 };
      const response = await app.request("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:5173",
          "X-Forwarded-For": `203.0.113.${110 + index}`,
        },
        body: JSON.stringify({ email: "disabled@example.com", password }),
      });
      assert.equal(response.status, 401, `expected 401 for ${JSON.stringify(flags)}`);
      assert.deepEqual(await response.json(), { error: "Invalid email or password" });
      const headers = response.headers as Headers & { getSetCookie?: () => string[] };
      const cookies = headers.getSetCookie?.() ?? [];
      assert.equal(
        cookies.some((cookie) => cookie.startsWith("cloudie_session=")),
        false,
        "a refused login must not set a session cookie",
      );
    }
  } finally {
    mutablePool.query = originalQuery;
  }
});



test("keeps first-admin bootstrap disabled when its operator token is absent", async () => {
  const previous = process.env.CLOUDIE_ADMIN_BOOTSTRAP_TOKEN;
  delete process.env.CLOUDIE_ADMIN_BOOTSTRAP_TOKEN;
  try {
    const response = await app.request("/api/auth/bootstrap-admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Initial Admin",
        email: "admin@example.com",
        password: "long-enough-test-password",
        token: "x".repeat(40),
      }),
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "Administrator bootstrap is disabled" });
  } finally {
    if (previous === undefined) delete process.env.CLOUDIE_ADMIN_BOOTSTRAP_TOKEN;
    else process.env.CLOUDIE_ADMIN_BOOTSTRAP_TOKEN = previous;
  }
});

test("validates first-admin bootstrap payload before database access", async () => {
  const previous = process.env.CLOUDIE_ADMIN_BOOTSTRAP_TOKEN;
  process.env.CLOUDIE_ADMIN_BOOTSTRAP_TOKEN = "test-bootstrap-token-that-is-long-enough";
  try {
    const response = await app.request("/api/auth/bootstrap-admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "", email: "not-an-email", password: "short", token: "x" }),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "Invalid administrator bootstrap details" });
  } finally {
    if (previous === undefined) delete process.env.CLOUDIE_ADMIN_BOOTSTRAP_TOKEN;
    else process.env.CLOUDIE_ADMIN_BOOTSTRAP_TOKEN = previous;
  }
});

test("rejects an incorrect first-admin bootstrap token without database access", async () => {
  const previous = process.env.CLOUDIE_ADMIN_BOOTSTRAP_TOKEN;
  const mutablePool = pool as unknown as { connect: (...args: unknown[]) => Promise<unknown> };
  const originalConnect = mutablePool.connect;
  process.env.CLOUDIE_ADMIN_BOOTSTRAP_TOKEN = "test-bootstrap-token-that-is-long-enough";
  mutablePool.connect = async () => { throw new Error("database must not be accessed"); };
  try {
    const response = await app.request("/api/auth/bootstrap-admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Initial Admin",
        email: "admin@example.com",
        password: "long-enough-test-password",
        token: "incorrect-bootstrap-token-value-000",
      }),
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Invalid bootstrap authorization" });
  } finally {
    mutablePool.connect = originalConnect;
    if (previous === undefined) delete process.env.CLOUDIE_ADMIN_BOOTSTRAP_TOKEN;
    else process.env.CLOUDIE_ADMIN_BOOTSTRAP_TOKEN = previous;
  }
});

test("validates points marketplace filters before database access", async () => {
  const response = await app.request("/api/marketplace/packages?minPrice=-1");
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Marketplace filters must be non-negative numbers" });
});

test("rejects unsupported points marketplace sort values", async () => {
  const response = await app.request("/api/marketplace/packages?sort=price;DROP%20TABLE");
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Unsupported marketplace sort" });
});

test("returns an empty public points marketplace list when the read model has no rows", async () => {
  const mutablePool = pool as unknown as { query: (...args: unknown[]) => Promise<unknown> };
  const originalQuery = mutablePool.query;
  mutablePool.query = async (...args: unknown[]) => {
    const sql = args[0];
    const values = args[1] as unknown[];
    assert.match(String(sql), /FROM point_market_packages/);
    assert.match(String(sql), /v\.status = 'approved'/);
    assert.deepEqual(values, [true, "", null, null, null, null]);
    return { rows: [], rowCount: 0 };
  };
  try {
    const response = await app.request("/api/marketplace/packages?verifiedOnly=true");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), []);
  } finally {
    mutablePool.query = originalQuery;
  }
});

test("maps points marketplace database rows to the existing buyer response shape", async () => {
  const mutablePool = pool as unknown as { query: (...args: unknown[]) => Promise<unknown> };
  const originalQuery = mutablePool.query;
  mutablePool.query = async () => ({
    rows: [{
      id: "pkg_1",
      name: "Starter points",
      points: "500",
      price_minor: "125000",
      currency: "NGN",
      unit_price_minor: "250000",
      total_sold: "7",
      vendor_id: "vendor_1",
      business_name: "Verified vendor",
      is_verified: true,
    }],
    rowCount: 1,
  });
  try {
    const response = await app.request("/api/marketplace/packages?verifiedOnly=true&sort=price_asc");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), [{
      id: "pkg_1",
      name: "Starter points",
      points: 500,
      priceMinor: 125000,
      currency: "NGN",
      unitPriceMinor: 250000,
      totalSold: 7,
      vendorId: "vendor_1",
      vendorName: "Verified vendor",
      vendorVerified: true,
    }]);
  } finally {
    mutablePool.query = originalQuery;
  }
});

test("returns a safe unavailable response when points marketplace tables are not ready", async () => {
  const mutablePool = pool as unknown as { query: (...args: unknown[]) => Promise<unknown> };
  const originalQuery = mutablePool.query;
  mutablePool.query = async () => { throw new Error("simulated missing table"); };
  try {
    const response = await app.request("/api/marketplace/packages");
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "Marketplace data is not available yet" });
  } finally {
    mutablePool.query = originalQuery;
  }
});

/* ── Dashboard metric accuracy ───────────────────────────────────────────── */

test("admin reports count active and suspended users instead of fabricating them", async () => {
  const secret = new TextEncoder().encode(process.env.JWT_SECRET);
  const token = await new SignJWT({ email: "admin@example.com", role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("admin-user")
    .setJti("reports-session")
    .setIssuedAt()
    .setIssuer("cloudie-neon-api")
    .setAudience("cloudie-web")
    .setExpirationTime("5m")
    .sign(secret);

  const mutablePool = pool as unknown as { query: (...args: unknown[]) => Promise<unknown> };
  const originalQuery = mutablePool.query;
  mutablePool.query = async (...args: unknown[]) => {
    const sql = String(args[0] ?? "");
    if (sql.includes("FROM api_sessions")) return { rows: [{ id: "reports-session" }], rowCount: 1 };
    if (sql.includes("FROM app_users WHERE id")) {
      return {
        rows: [{ id: "admin-user", email: "admin@example.com", name: "Admin", role: "admin", is_suspended: false, is_terminated: false }],
        rowCount: 1,
      };
    }
    if (sql.includes("COUNT(*) FILTER (WHERE NOT is_suspended")) {
      // 40 users: 25 active, 11 suspended, 4 terminated.
      return {
        rows: [{ total: "40", active: "25", suspended: "11", terminated: "4", admins: "2", new_7d: "3", wallet_ngn: "1500000", points: "8200" }],
        rowCount: 1,
      };
    }
    if (sql.includes("FROM point_market_vendors WHERE status = 'pending'")) return { rows: [{ count: "2" }], rowCount: 1 };
    if (sql.includes("FROM point_market_vendors")) return { rows: [{ count: "9" }], rowCount: 1 };
    if (sql.includes("FROM shipments WHERE status = 'delivered'")) return { rows: [{ count: "5" }], rowCount: 1 };
    if (sql.includes("FROM shipments WHERE status = 'pending'")) return { rows: [{ count: "3" }], rowCount: 1 };
    if (sql.includes("FROM shipments")) return { rows: [{ count: "12" }], rowCount: 1 };
    if (sql.includes("FROM commerce_orders WHERE status IN")) return { rows: [{ count: "4" }], rowCount: 1 };
    if (sql.includes("FROM commerce_orders")) return { rows: [{ count: "7" }], rowCount: 1 };
    if (sql.includes("FROM kyc_records WHERE status = 'submitted'")) return { rows: [{ count: "6" }], rowCount: 1 };
    if (sql.includes("FROM kyc_records")) return { rows: [{ count: "0" }], rowCount: 1 };
    // Simulate the points marketplace tables not existing yet on this branch.
    if (sql.includes("FROM payment_records")) throw new Error("simulated missing table");
    if (sql.includes("FROM tenant_sites")) return { rows: [{ count: "8" }], rowCount: 1 };
    if (sql.includes("FROM user_documents")) return { rows: [{ count: "0" }], rowCount: 1 };
    if (sql.includes("FROM wallet_ledger")) return { rows: [{ count: "14" }], rowCount: 1 };
    throw new Error(`Unexpected query: ${sql}`);
  };

  try {
    const response = await app.request("/api/admin/reports", {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as Record<string, number | null>;
    assert.equal(body.totalUsers, 40);
    assert.equal(body.activeUsers, 25, "active users must not equal the total");
    assert.equal(body.suspendedUsers, 11, "suspended users must be counted, not zeroed");
    assert.equal(body.terminatedUsers, 4);
    assert.equal(body.adminUsers, 2);
    assert.equal(body.vendors, 9);
    assert.equal(body.pendingVendors, 2);
    assert.equal(body.tenants, 8);
    assert.equal(body.totalShipments, 12);
    assert.equal(body.pendingShipments, 3);
    assert.equal(body.deliveredShipments, 5);
    assert.equal(body.totalOrders, 7);
    assert.equal(body.escrowPending, 4);
    assert.equal(body.pendingKyc, 6);
    assert.equal(body.ledgerEvents24h, 14);
    assert.equal(
      body.paymentsCompleted,
      null,
      "a metric whose table is unavailable must be null, never a fabricated zero",
    );
  } finally {
    mutablePool.query = originalQuery;
  }
});

/* ── P0: administrative wallet adjustment ───────────────────────────────── */

test("non-administrators cannot reach the wallet adjustment endpoint", async () => {
  const secret = new TextEncoder().encode(process.env.JWT_SECRET);
  const token = await new SignJWT({ email: "user@example.com", role: "user" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("test-user")
    .setJti("wallet-session")
    .setIssuedAt()
    .setIssuer("cloudie-neon-api")
    .setAudience("cloudie-web")
    .setExpirationTime("5m")
    .sign(secret);
  const mutablePool = pool as unknown as { query: (...args: unknown[]) => Promise<unknown> };
  const originalQuery = mutablePool.query;
  mutablePool.query = async (...args: unknown[]) => {
    const sql = String(args[0] ?? "");
    if (sql.includes("FROM api_sessions")) return { rows: [{ id: "wallet-session" }], rowCount: 1 };
    if (sql.includes("FROM app_users")) {
      return {
        rows: [{
          id: "test-user",
          email: "user@example.com",
          name: "Test User",
          role: "user",
          is_suspended: false,
          is_terminated: false,
        }],
        rowCount: 1,
      };
    }
    throw new Error("Unexpected database query in wallet authorization test");
  };
  try {
    const response = await app.request("/api/admin/users/some-user/wallet-adjust", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ amount_ngn: -5000 }),
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "Administrator access required" });
  } finally {
    mutablePool.query = originalQuery;
  }
});

test("wallet adjustment rejects malformed amounts before touching the database", async () => {
  const secret = new TextEncoder().encode(process.env.JWT_SECRET);
  const token = await new SignJWT({ email: "admin@example.com", role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("admin-user")
    .setJti("wallet-admin-session")
    .setIssuedAt()
    .setIssuer("cloudie-neon-api")
    .setAudience("cloudie-web")
    .setExpirationTime("5m")
    .sign(secret);
  const mutablePool = pool as unknown as { query: (...args: unknown[]) => Promise<unknown> };
  const originalQuery = mutablePool.query;
  mutablePool.query = async (...args: unknown[]) => {
    const sql = String(args[0] ?? "");
    if (sql.includes("FROM api_sessions")) return { rows: [{ id: "wallet-admin-session" }], rowCount: 1 };
    if (sql.includes("FROM app_users")) {
      return {
        rows: [{
          id: "admin-user",
          email: "admin@example.com",
          name: "Admin",
          role: "admin",
          is_suspended: false,
          is_terminated: false,
        }],
        rowCount: 1,
      };
    }
    throw new Error("Database must not be reached for a rejected amount");
  };
  try {
    const zero = await app.request("/api/admin/users/some-user/wallet-adjust", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ amount_ngn: 0 }),
    });
    assert.equal(zero.status, 400);

    const absurd = await app.request("/api/admin/users/some-user/wallet-adjust", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ amount_ngn: -1e12 }),
    });
    assert.equal(absurd.status, 400);
  } finally {
    mutablePool.query = originalQuery;
  }
});

/* ── P1: audit-log reads must not disguise an outage as an empty trail ──── */

async function adminAuditToken(jti: string) {
  const secret = new TextEncoder().encode(process.env.JWT_SECRET);
  return new SignJWT({ email: "admin@example.com", role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("admin-user")
    .setJti(jti)
    .setIssuedAt()
    .setIssuer("cloudie-neon-api")
    .setAudience("cloudie-web")
    .setExpirationTime("5m")
    .sign(secret);
}

test("an unreadable audit trail reports 503 unavailable, never an empty list", async () => {
  const token = await adminAuditToken("audit-outage-session");
  const mutablePool = pool as unknown as { query: (...args: unknown[]) => Promise<unknown> };
  const originalQuery = mutablePool.query;
  mutablePool.query = async (...args: unknown[]) => {
    const sql = String(args[0] ?? "");
    if (sql.includes("FROM api_sessions")) return { rows: [{ id: "audit-outage-session" }], rowCount: 1 };
    if (sql.includes("FROM app_users")) {
      return {
        rows: [{ id: "admin-user", email: "admin@example.com", name: "Admin", role: "admin", is_suspended: false, is_terminated: false }],
        rowCount: 1,
      };
    }
    if (sql.includes("FROM admin_audit_logs")) throw new Error("simulated audit storage outage");
    throw new Error(`Unexpected query: ${sql}`);
  };

  try {
    const response = await app.request("/api/admin/audit-logs", {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(
      response.status,
      503,
      "an outage must not be reported as a successful empty read",
    );
    const body = (await response.json()) as { logs?: unknown[]; error?: string };
    assert.equal(body.logs, undefined, "no fabricated logs array");
    assert.equal(body.error, "Audit log storage is unavailable");
  } finally {
    mutablePool.query = originalQuery;
  }
});

test("a readable audit trail still returns its records with 200", async () => {
  const token = await adminAuditToken("audit-ok-session");
  const mutablePool = pool as unknown as { query: (...args: unknown[]) => Promise<unknown> };
  const originalQuery = mutablePool.query;
  mutablePool.query = async (...args: unknown[]) => {
    const sql = String(args[0] ?? "");
    if (sql.includes("FROM api_sessions")) return { rows: [{ id: "audit-ok-session" }], rowCount: 1 };
    if (sql.includes("FROM app_users")) {
      return {
        rows: [{ id: "admin-user", email: "admin@example.com", name: "Admin", role: "admin", is_suspended: false, is_terminated: false }],
        rowCount: 1,
      };
    }
    if (sql.includes("FROM admin_audit_logs")) {
      return {
        rows: [{ id: "aud_1", action: "USER_SUSPENDED", target_type: "user", target_id: "u1", details: {}, created_at: "2026-10-26T00:00:00Z" }],
        rowCount: 1,
      };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };

  try {
    const response = await app.request("/api/admin/audit-logs", {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { logs?: Array<{ action?: string }> };
    assert.equal(body.logs?.length, 1);
    assert.equal(body.logs?.[0]?.action, "USER_SUSPENDED");
  } finally {
    mutablePool.query = originalQuery;
  }
});
