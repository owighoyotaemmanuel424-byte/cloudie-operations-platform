import test from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import { scryptSync } from "node:crypto";

// Configure before importing server.ts: this keeps the app unbound to a port and
// prevents these middleware tests from requiring a reachable PostgreSQL instance.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgres://cloudie_test:cloudie_test@127.0.0.1:5432/cloudie_test";
process.env.JWT_SECRET = "test-only-secret-that-is-longer-than-thirty-two-bytes";
process.env.CORS_ORIGINS = "http://localhost:5173";

const { app, pool } = await import("./server.js");

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

test("reports database connectivity and required schema readiness separately", async () => {
  const mutablePool = pool as unknown as { query: (...args: unknown[]) => Promise<unknown> };
  const originalQuery = mutablePool.query;
  mutablePool.query = async () => ({ rows: [{ ok: 1, missing_tables: [] }], rowCount: 1 });
  try {
    const response = await app.request("/health");
    assert.equal(response.status, 200);
    const body = await response.json() as {
      ok: boolean; service: string; database: string; schema: string; timestamp: string;
    };
    assert.equal(body.ok, true);
    assert.equal(body.service, "cloudie-neon-api");
    assert.equal(body.database, "connected");
    assert.equal(body.schema, "ready");
    assert.match(body.timestamp, /^\\d{4}-\\d{2}-\\d{2}T/);
  } finally {
    mutablePool.query = originalQuery;
  }
});

test("reports schema-incomplete databases as unhealthy", async () => {
  const mutablePool = pool as unknown as { query: (...args: unknown[]) => Promise<unknown> };
  const originalQuery = mutablePool.query;
  mutablePool.query = async () => ({ rows: [{ ok: 1, missing_tables: ["api_sessions"] }], rowCount: 1 });
  try {
    const response = await app.request("/health");
    assert.equal(response.status, 503);
    const body = await response.json() as { ok: boolean; database: string; schema: string; missingTables: string[] };
    assert.equal(body.ok, false);
    assert.equal(body.database, "connected");
    assert.equal(body.schema, "incomplete");
    assert.deepEqual(body.missingTables, ["api_sessions"]);
  } finally {
    mutablePool.query = originalQuery;
  }
});

test("returns 503 when the configured PostgreSQL database is unavailable", async () => {
  const mutablePool = pool as unknown as { query: (...args: unknown[]) => Promise<unknown> };
  const originalQuery = mutablePool.query;
  mutablePool.query = async () => { throw new Error("simulated database outage"); };
  try {
    const response = await app.request("/health");
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

test("cookie-only login omits the JWT from JSON and sets a protected session cookie", async () => {
  const previousCookieOnly = process.env.COOKIE_ONLY_SESSIONS;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.COOKIE_ONLY_SESSIONS = "true";
  process.env.NODE_ENV = "production";
  const salt = Buffer.alloc(16, 7);
  const passwordHash = `scrypt:${salt.toString("hex")}:${scryptSync("correct horse battery staple", salt, 64).toString("hex")}`;
  const mutablePool = pool as unknown as { query: (...args: unknown[]) => Promise<unknown> };
  const originalQuery = mutablePool.query;
  mutablePool.query = async (...args: unknown[]) => {
    const sql = String(args[0] ?? "");
    if (sql.includes("FROM app_users WHERE lower(email)=lower($1)")) {
      return {
        rows: [{
          id: "cookie-user",
          email: "cookie@example.com",
          name: "Cookie User",
          role: "user",
          is_suspended: false,
          is_terminated: false,
          password_hash: passwordHash,
        }],
        rowCount: 1,
      };
    }
    if (sql.includes("INSERT INTO api_sessions")) return { rows: [], rowCount: 1 };
    throw new Error("Unexpected database query in cookie-only login test");
  };

  try {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: {
        Origin: "http://localhost:5173",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: "cookie@example.com", password: "correct horse battery staple" }),
    });
    assert.equal(response.status, 200);
    const body = await response.json() as { user?: { id?: string }; token?: string };
    assert.equal(body.user?.id, "cookie-user");
    assert.equal(body.token, undefined);
    const setCookie = response.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /cloudie_session=/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /Secure/i);
    assert.match(setCookie, /SameSite=Lax/i);
    assert.match(setCookie, /cloudie_csrf=/);
  } finally {
    mutablePool.query = originalQuery;
    if (previousCookieOnly === undefined) delete process.env.COOKIE_ONLY_SESSIONS;
    else process.env.COOKIE_ONLY_SESSIONS = previousCookieOnly;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});
