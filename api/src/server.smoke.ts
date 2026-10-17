import test from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";

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


test("lists only the signed-in user's shipments by default", async () => {
  const secret = new TextEncoder().encode(process.env.JWT_SECRET);
  const token = await new SignJWT({ email: "user@example.com", role: "user" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("test-user")
    .setJti("shipment-session")
    .setIssuedAt()
    .setIssuer("cloudie-neon-api")
    .setAudience("cloudie-web")
    .setExpirationTime("5m")
    .sign(secret);
  const mutablePool = pool as unknown as { query: (...args: unknown[]) => Promise<unknown> };
  const originalQuery = mutablePool.query;
  let shipmentQuery: { sql: string; values: unknown[] } | undefined;
  mutablePool.query = async (...args: unknown[]) => {
    const sql = String(args[0] ?? "");
    if (sql.includes("FROM api_sessions")) return { rows: [{ id: "shipment-session" }], rowCount: 1 };
    if (sql.includes("FROM app_users")) return {
      rows: [{ id: "test-user", email: "user@example.com", name: "Test User", role: "user", is_suspended: false, is_terminated: false }],
      rowCount: 1,
    };
    if (sql.includes("FROM shipments")) {
      shipmentQuery = { sql, values: args[1] as unknown[] };
      return { rows: [{ id: "shipment-1", tracking_number: "CLD123" }], rowCount: 1 };
    }
    throw new Error("Unexpected database query in shipment test");
  };
  try {
    const response = await app.request("/api/shipments?limit=20&status=IN_TRANSIT", {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { shipments: unknown[] }).shipments.length, 1);
    assert.match(shipmentQuery?.sql ?? "", /WHERE user_id=\$1/);
    assert.deepEqual(shipmentQuery?.values, ["test-user", 20]);
  } finally {
    mutablePool.query = originalQuery;
  }
});

test("rejects invalid shipment status filters before querying shipments", async () => {
  const secret = new TextEncoder().encode(process.env.JWT_SECRET);
  const token = await new SignJWT({ email: "user@example.com", role: "user" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("test-user")
    .setJti("shipment-invalid-session")
    .setIssuedAt()
    .setIssuer("cloudie-neon-api")
    .setAudience("cloudie-web")
    .setExpirationTime("5m")
    .sign(secret);
  const mutablePool = pool as unknown as { query: (...args: unknown[]) => Promise<unknown> };
  const originalQuery = mutablePool.query;
  mutablePool.query = async (...args: unknown[]) => {
    const sql = String(args[0] ?? "");
    if (sql.includes("FROM api_sessions")) return { rows: [{ id: "shipment-invalid-session" }], rowCount: 1 };
    if (sql.includes("FROM app_users")) return {
      rows: [{ id: "test-user", email: "user@example.com", name: "Test User", role: "user", is_suspended: false, is_terminated: false }],
      rowCount: 1,
    };
    throw new Error("Shipment query must not run for an invalid status");
  };
  try {
    const response = await app.request("/api/shipments?status=unexpected", {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "Invalid shipment status" });
  } finally {
    mutablePool.query = originalQuery;
  }
});


test("wallet summary returns only the authenticated user's balance and ledger totals", async () => {
  const secret = new TextEncoder().encode(process.env.JWT_SECRET);
  const token = await new SignJWT({ email: "user@example.com", role: "user" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("wallet-user")
    .setJti("wallet-summary-session")
    .setIssuedAt()
    .setIssuer("cloudie-neon-api")
    .setAudience("cloudie-web")
    .setExpirationTime("5m")
    .sign(secret);
  const mutablePool = pool as unknown as { query: (...args: unknown[]) => Promise<unknown> };
  const originalQuery = mutablePool.query;
  mutablePool.query = async (...args: unknown[]) => {
    const sql = String(args[0] ?? "");
    if (sql.includes("FROM api_sessions")) return { rows: [{ id: "wallet-summary-session" }], rowCount: 1 };
    if (sql.includes("FROM app_users")) {
      assert.deepEqual(args[1], ["wallet-user"]);
      return { rows: [{ id: "wallet-user", email: "user@example.com", name: "Test User", role: "user", is_suspended: false, is_terminated: false, wallet_balance_ngn: "120.50" }], rowCount: 1 };
    }
    if (sql.includes("FROM wallet_ledger")) {
      assert.deepEqual(args[1], ["wallet-user"]);
      return { rows: [{ total_credits_ngn: "150.50", total_debits_ngn: "30.00", entry_count: 3 }], rowCount: 1 };
    }
    throw new Error("Unexpected database query in wallet summary test");
  };
  try {
    const response = await app.request("/api/wallet/summary", {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      balanceNgn: "120.50",
      totalCreditsNgn: "150.50",
      totalDebitsNgn: "30.00",
      entryCount: 3,
    });
  } finally {
    mutablePool.query = originalQuery;
  }
});


test("wallet ledger is scoped to the authenticated user and bounds the requested page size", async () => {
  const secret = new TextEncoder().encode(process.env.JWT_SECRET);
  const token = await new SignJWT({ email: "user@example.com", role: "user" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("wallet-ledger-user")
    .setJti("wallet-ledger-session")
    .setIssuedAt()
    .setIssuer("cloudie-neon-api")
    .setAudience("cloudie-web")
    .setExpirationTime("5m")
    .sign(secret);
  const mutablePool = pool as unknown as { query: (...args: unknown[]) => Promise<unknown> };
  const originalQuery = mutablePool.query;
  let ledgerQuery: { sql: string; values: unknown[] } | undefined;
  mutablePool.query = async (...args: unknown[]) => {
    const sql = String(args[0] ?? "");
    if (sql.includes("FROM api_sessions")) return { rows: [{ id: "wallet-ledger-session" }], rowCount: 1 };
    if (sql.includes("FROM app_users")) return {
      rows: [{ id: "wallet-ledger-user", email: "user@example.com", name: "Test User", role: "user", is_suspended: false, is_terminated: false }],
      rowCount: 1,
    };
    if (sql.includes("FROM wallet_ledger")) {
      ledgerQuery = { sql, values: args[1] as unknown[] };
      return { rows: [{ id: "entry-1", amount_ngn: "25.00", transaction_type: "deposit" }], rowCount: 1 };
    }
    throw new Error("Unexpected database query in wallet ledger test");
  };
  try {
    const response = await app.request("/api/wallet/ledger?limit=999", {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { entries: unknown[] }).entries.length, 1);
    assert.match(ledgerQuery?.sql ?? "", /WHERE user_id=\$1/);
    assert.match(ledgerQuery?.sql ?? "", /LIMIT \$2/);
    assert.deepEqual(ledgerQuery?.values, ["wallet-ledger-user", 100]);
  } finally {
    mutablePool.query = originalQuery;
  }
});

test("wallet ledger rejects unauthenticated requests before database access", async () => {
  const response = await app.request("/api/wallet/ledger?limit=10");
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Authentication required" });
});


test("shipment detail lookup is scoped to the authenticated owner and returns ordered event history", async () => {
  const secret = new TextEncoder().encode(process.env.JWT_SECRET);
  const token = await new SignJWT({ email: "user@example.com", role: "user" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("shipment-owner")
    .setJti("shipment-detail-session")
    .setIssuedAt()
    .setIssuer("cloudie-neon-api")
    .setAudience("cloudie-web")
    .setExpirationTime("5m")
    .sign(secret);
  const mutablePool = pool as unknown as { query: (...args: unknown[]) => Promise<unknown> };
  const originalQuery = mutablePool.query;
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  mutablePool.query = async (...args: unknown[]) => {
    const sql = String(args[0] ?? "");
    const values = (args[1] ?? []) as unknown[];
    if (sql.includes("FROM api_sessions")) return { rows: [{ id: "shipment-detail-session" }], rowCount: 1 };
    if (sql.includes("FROM app_users")) return {
      rows: [{ id: "shipment-owner", email: "user@example.com", name: "Test User", role: "user", is_suspended: false, is_terminated: false }],
      rowCount: 1,
    };
    queries.push({ sql, values });
    if (sql.includes("FROM shipments")) return { rows: [{ id: "shipment-owned", user_id: "shipment-owner", tracking_number: "CLD-OWNED" }], rowCount: 1 };
    if (sql.includes("FROM shipment_events")) return { rows: [{ id: "event-1", status: "in_transit" }], rowCount: 1 };
    throw new Error("Unexpected database query in shipment detail test");
  };
  try {
    const response = await app.request("/api/shipments/CLD-OWNED", {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    const body = await response.json() as { shipment: { tracking_number: string }; events: unknown[] };
    assert.equal(body.shipment.tracking_number, "CLD-OWNED");
    assert.equal(body.events.length, 1);
    assert.match(queries[0]?.sql ?? "", /WHERE user_id=\$1 AND \(id=\$2 OR tracking_number=\$2\)/);
    assert.deepEqual(queries[0]?.values, ["shipment-owner", "CLD-OWNED"]);
    assert.match(queries[1]?.sql ?? "", /FROM shipment_events WHERE shipment_id=\$1 ORDER BY occurred_at ASC/);
    assert.deepEqual(queries[1]?.values, ["shipment-owned"]);
  } finally {
    mutablePool.query = originalQuery;
  }
});

test("shipment detail does not expose another user's shipment", async () => {
  const secret = new TextEncoder().encode(process.env.JWT_SECRET);
  const token = await new SignJWT({ email: "user@example.com", role: "user" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("shipment-owner")
    .setJti("shipment-private-session")
    .setIssuedAt()
    .setIssuer("cloudie-neon-api")
    .setAudience("cloudie-web")
    .setExpirationTime("5m")
    .sign(secret);
  const mutablePool = pool as unknown as { query: (...args: unknown[]) => Promise<unknown> };
  const originalQuery = mutablePool.query;
  mutablePool.query = async (...args: unknown[]) => {
    const sql = String(args[0] ?? "");
    if (sql.includes("FROM api_sessions")) return { rows: [{ id: "shipment-private-session" }], rowCount: 1 };
    if (sql.includes("FROM app_users")) return {
      rows: [{ id: "shipment-owner", email: "user@example.com", name: "Test User", role: "user", is_suspended: false, is_terminated: false }],
      rowCount: 1,
    };
    if (sql.includes("FROM shipments")) {
      assert.match(sql, /WHERE user_id=\$1 AND \(id=\$2 OR tracking_number=\$2\)/);
      return { rows: [], rowCount: 0 };
    }
    throw new Error("Shipment events must not be queried for an inaccessible shipment");
  };
  try {
    const response = await app.request("/api/shipments/OTHER-USER-TRACKING", {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "Shipment not found" });
  } finally {
    mutablePool.query = originalQuery;
  }
});
