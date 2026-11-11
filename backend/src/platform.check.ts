/**
 * End-to-end check for the Turso-backed platform.
 *
 * Runs the real Hono app against a real libSQL database (the same engine Turso
 * serves) with the real migrations, then exercises authentication, the points
 * ledger, every writable workspace, tenant isolation and the failure paths.
 *
 *   bun backend/src/platform.check.ts
 */
import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";

const dir = mkdtempSync(join(tmpdir(), "cloudie-check-"));
const dbPath = join(dir, "platform.db");

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "check-secret-".padEnd(48, "x");
process.env.TURSO_DATABASE_URL = `file:${dbPath}`;
delete process.env.TURSO_AUTH_TOKEN;

const migrationsDir = new URL("../../migrations/turso/", import.meta.url).pathname;
const client = createClient({ url: `file:${dbPath}` });
for (const file of readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort()) {
  await client.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
}
console.log(`migrations applied: ${readdirSync(migrationsDir).filter((n) => n.endsWith(".sql")).length}`);

const { app } = await import("./server.ts");

type Json = Record<string, any>;
let passed = 0;

async function call(
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {},
): Promise<{ status: number; body: Json }> {
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const response = await app.request(path, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const body = (await response.json().catch(() => ({}))) as Json;
  return { status: response.status, body };
}

function check(label: string, condition: boolean, detail?: unknown) {
  if (!condition) {
    console.error(`FAIL ${label}`, detail ?? "");
    process.exit(1);
  }
  passed += 1;
  console.log(`ok   ${label}`);
}

const balanceOf = async (token: string) => {
  const res = await call("/api/platform/bootstrap", { token });
  return Number(res.body.user?.points ?? NaN);
};

/* ── Registration & session ─────────────────────────────────────────────── */
const emailA = `owner-${Date.now()}@cloudie.test`;
const registerA = await call("/api/auth/register", {
  method: "POST",
  body: { name: "Amara Test", email: emailA, password: "cloudie-pass-1" },
});
check("register returns 201 with a token", registerA.status === 201 && Boolean(registerA.body.token), registerA);
const tokenA: string = registerA.body.token;

const bootstrapA = await call("/api/platform/bootstrap", { token: tokenA });
check("bootstrap loads the signed-in account", bootstrapA.status === 200 && bootstrapA.body.user?.email === emailA);
check("first sign-up is credited 1,000 points", Number(bootstrapA.body.user?.points) === 1000, bootstrapA.body.user);
const openingLedger = bootstrapA.body.ledger ?? [];
check("welcome credit is a balanced ledger entry", openingLedger.length === 1 && Number(openingLedger[0].points) === 1000, openingLedger);

const anonymous = await call("/api/platform/bootstrap");
check("bootstrap requires a session", anonymous.status === 401, anonymous.status);

/* ── Shipments: charge, idempotency, insufficient funds ─────────────────── */
const shipmentBody = {
  origin: "Lagos, NG",
  destination: "Accra, GH",
  recipientName: "Kofi Test",
  recipientPhone: "+233 24 000 0000",
  contents: "Catalogues",
  weightKg: 2,
  declaredValue: 100000,
  service: "express",
  idempotencyKey: "check-shipment-1",
};
const shipment = await call("/api/platform/shipments", { method: "POST", token: tokenA, body: shipmentBody });
check("shipment is registered", shipment.status === 201 && Boolean(shipment.body.shipment?.public_token), shipment);
check("shipment charged the server-computed price (218 pts)", (await balanceOf(tokenA)) === 782, await balanceOf(tokenA));

const duplicate = await call("/api/platform/shipments", { method: "POST", token: tokenA, body: shipmentBody });
check("duplicate idempotency key is rejected", duplicate.status === 409, duplicate);

const tooHeavy = await call("/api/platform/shipments", {
  method: "POST",
  token: tokenA,
  body: { ...shipmentBody, weightKg: 50000, idempotencyKey: "check-shipment-heavy" },
});
check("insufficient balance rejects the charge", tooHeavy.status === 409, tooHeavy);
check("rejected charge did not move the balance", (await balanceOf(tokenA)) === 782);

const advanced = await call(`/api/platform/shipments/${shipment.body.shipment.id}/advance`, {
  method: "PATCH",
  token: tokenA,
  body: { status: "in_transit", location: "Lagos hub", note: "Departed" },
});
check("shipment status update is stored", advanced.status === 200 && advanced.body.shipment?.status === "in_transit", advanced);

const publicTrack = await call(`/api/platform/track/${shipment.body.shipment.public_token}`);
check("public tracking works without a session", publicTrack.status === 200 && publicTrack.body.shipment?.events?.length === 2, publicTrack);
check("public tracking hides contact details", publicTrack.body.shipment?.recipientPhone === undefined);

/* ── Documents, campaigns, marketplace ──────────────────────────────────── */
const document = await call("/api/platform/documents", {
  method: "POST",
  token: tokenA,
  body: {
    kind: "invoice",
    title: "Invoice composer",
    passenger: "Meridian Capital",
    reference: "INV-CHECK",
    lines: [{ label: "Billed to", value: "Meridian Capital" }],
    total: 250000,
    currency: "NGN",
    idempotencyKey: "check-document-1",
  },
});
check("document renders and charges 60 pts", document.status === 201 && (await balanceOf(tokenA)) === 722, document);

const publicDoc = await call(`/api/platform/documents/${document.body.document.public_token}`);
check("public document link resolves", publicDoc.status === 200 && publicDoc.body.document?.title === "Invoice composer");

const campaign = await call("/api/platform/campaigns", {
  method: "POST",
  token: tokenA,
  body: {
    template: "delivery",
    subject: "Your consignment",
    body: "Hello",
    recipients: ["a@example.com", "b@example.com", "c@example.com"],
    idempotencyKey: "check-campaign-1",
  },
});
check("campaign charges 2 pts per recipient", campaign.status === 201 && (await balanceOf(tokenA)) === 716, campaign);

const expensiveOrder = await call("/api/platform/orders", { method: "POST", token: tokenA, body: { listingId: "lst-1" } });
check("expensive marketplace order is refused", expensiveOrder.status === 409, expensiveOrder);

const order = await call("/api/platform/orders", { method: "POST", token: tokenA, body: { listingId: "lst-4" } });
check("affordable marketplace order is placed", order.status === 201 && (await balanceOf(tokenA)) === 336, order);

const message = await call(`/api/platform/orders/${order.body.order.id}/messages`, {
  method: "POST",
  token: tokenA,
  body: { body: "Share the pickup address?" },
});
check("order chat message is persisted", message.status === 201);

/* ── Deposits settle only through an operator ───────────────────────────── */
const deposit = await call("/api/platform/points/deposit", { method: "POST", token: tokenA, body: { packId: "pack-2" } });
check("top-up is recorded as pending, not credited", deposit.status === 201 && (await balanceOf(tokenA)) === 336, deposit);

const emailAdmin = `admin-${Date.now()}@cloudie.test`;
const admin = await call("/api/auth/register", {
  method: "POST",
  body: { name: "Operator", email: emailAdmin, password: "cloudie-pass-2" },
});
const tokenAdmin: string = admin.body.token;
await client.execute({ sql: "UPDATE app_users SET role = 'admin' WHERE email = ?", args: [emailAdmin] });

const settle = await call(`/api/platform/admin/deposits/${deposit.body.deposit.id}/settle`, {
  method: "POST",
  token: tokenAdmin,
  body: {},
});
check("admin settles the deposit", settle.status === 200 && (await balanceOf(tokenA)) === 2986, settle);

/* ── Tenant portals ─────────────────────────────────────────────────────── */
const tenant = await call("/api/platform/tenants", {
  method: "POST",
  token: tokenA,
  body: {
    name: "Meridian Check",
    slug: `meridian-${Date.now().toString().slice(-6)}`,
    plan: "starter",
    kycRequired: true,
    kycLevel: "enhanced",
    bankingEnabled: true,
    investmentEnabled: false,
    idempotencyKey: "check-tenant-1",
  },
});
check("portal deploys and charges setup points", tenant.status === 201 && (await balanceOf(tokenA)) === 1786, tenant);

const invite = await call(`/api/platform/tenants/${tenant.body.tenant.id}/users`, {
  method: "POST",
  token: tokenA,
  body: { name: "Staff Member", email: "staff@example.com", role: "staff" },
});
check("portal user can be invited", invite.status === 201);

/* ── Isolation between accounts ─────────────────────────────────────────── */
const emailC = `other-${Date.now()}@cloudie.test`;
const other = await call("/api/auth/register", {
  method: "POST",
  body: { name: "Other Account", email: emailC, password: "cloudie-pass-3" },
});
const tokenC: string = other.body.token;

const otherBootstrap = await call("/api/platform/bootstrap", { token: tokenC });
check("a new account sees no foreign records", (otherBootstrap.body.shipments ?? []).length === 0);

const foreignAdvance = await call(`/api/platform/shipments/${shipment.body.shipment.id}/advance`, {
  method: "PATCH",
  token: tokenC,
  body: { status: "delivered" },
});
check("another account cannot update the shipment", foreignAdvance.status === 404, foreignAdvance);

const foreignTenant = await call(`/api/platform/tenants/${tenant.body.tenant.id}`, {
  method: "PATCH",
  token: tokenC,
  body: { bankingEnabled: false },
});
check("another account cannot configure the tenant portal", foreignTenant.status === 404, foreignTenant);

const foreignMessage = await call(`/api/platform/orders/${order.body.order.id}/messages`, {
  method: "POST",
  token: tokenC,
  body: { body: "hijack" },
});
check("another account cannot post to the order chat", foreignMessage.status === 404, foreignMessage);

/* ── Refund and ledger immutability ─────────────────────────────────────── */
const refreshed = await call("/api/platform/bootstrap", { token: tokenA });
const shipmentGroup = (refreshed.body.ledger ?? []).find((entry: Json) => String(entry.description).startsWith("Shipment ·"));
check("shipment ledger group is discoverable", Boolean(shipmentGroup), refreshed.body.ledger);
const beforeRefund = Number(refreshed.body.user.points);
const refund = await call("/api/platform/admin/refund", {
  method: "POST",
  token: tokenAdmin,
  body: { groupId: shipmentGroup.id, reason: "check" },
});
check("admin refund credits a reversing group", refund.status === 200 && (await balanceOf(tokenA)) === beforeRefund + 218, refund);

let immutable = false;
try {
  await client.execute({ sql: "UPDATE points_ledger_entries SET points = 1 WHERE group_id = ?", args: [shipmentGroup.id] });
} catch {
  immutable = true;
}
check("posted ledger entries are immutable at the SQL layer", immutable);

let unbalanced = false;
try {
  await client.execute({
    sql: "INSERT INTO points_ledger_entries (id, group_id, account_id, points) VALUES ('x_extra', ?, 'user:probe', 5)",
    args: [shipmentGroup.id],
  });
} catch {
  unbalanced = true;
}
check("posted ledger groups reject new entries", unbalanced);

/* ── Password reset ─────────────────────────────────────────────────────── */
const resetRequest = await call("/api/auth/password-reset/request", {
  method: "POST",
  body: { email: emailA },
});
check("reset request issues a token in non-production", resetRequest.status === 200 && Boolean(resetRequest.body.devToken), resetRequest);
const resetConfirm = await call("/api/auth/password-reset/confirm", {
  method: "POST",
  body: { token: resetRequest.body.devToken, password: "cloudie-pass-new" },
});
check("reset confirm updates the password", resetConfirm.status === 200, resetConfirm);
const oldLogin = await call("/api/auth/login", { method: "POST", body: { email: emailA, password: "cloudie-pass-1" } });
check("the old password stops working", oldLogin.status === 401, oldLogin);
const newLogin = await call("/api/auth/login", { method: "POST", body: { email: emailA, password: "cloudie-pass-new" } });
check("the new password signs in", newLogin.status === 200 && Boolean(newLogin.body.token), newLogin);

console.log(`\n${passed} checks passed against ${dbPath}`);
await client.close();
process.exit(0);
