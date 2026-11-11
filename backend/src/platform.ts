/**
 * Cloudie platform routes — persistent backend for the rebuilt five-workspace UI.
 *
 * Mounted by `backend/src/server.ts` on the existing Hono app so it shares the
 * same Turso connection pool, JWT/cookie authentication, CSRF and rate limiting.
 *
 * Financial rules enforced here, never in the browser:
 *  - every points movement is a balanced double-entry group (user wallet ↔
 *    platform account) posted through `postPointsGroup`;
 *  - balance is computed from posted entries inside the same write transaction
 *    before a charge is allowed;
 *  - posted groups/entries are immutable at the SQLite trigger level;
 *  - idempotency keys make retries return a conflict instead of double-charging;
 *  - refunds are new reversing groups, never edits of history.
 */
import type { Hono, MiddlewareHandler } from "hono";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";

export const PLATFORM_PRICING = {
  shipment: { base: 120, perKg: 8, multiplier: { express: 1.6, economy: 1, freight: 0.75 } },
  document: { flight: 45, hotel: 45, invoice: 60, customs: 75, receipt: 25 } as Record<string, number>,
  campaignPerRecipient: 2,
  siteSetup: { starter: 1_200, growth: 2_400, scale: 4_800 } as Record<string, number>,
  siteRenewal: { starter: 900, growth: 1_800, scale: 3_600 } as Record<string, number>,
  referral: 250,
};

type Row = Record<string, any>;
type Queryable = {
  query: <R extends Row = Row>(sql: string, values?: unknown[]) => Promise<{ rows: R[]; rowCount: number }>;
};
type Conn = Queryable & { release: () => Promise<void> | void };
type ApiUser = {
  id: string;
  email: string;
  name: string | null;
  role: "admin" | "user" | "vendor";
  is_suspended: boolean;
  is_terminated: boolean;
};

export type PlatformDeps = {
  pool: Queryable & { connect: () => Promise<Conn> };
  auth: MiddlewareHandler<any>;
  fail: (c: any, status: 400 | 401 | 403 | 404 | 409 | 429 | 500, message: string) => Response | Promise<Response>;
  uuid: () => string;
  checkRateLimit: (c: any, prefix: string, maxRequests: number, windowMs?: number) => boolean;
  recordAuditLog: (
    actorUserId: string,
    action: string,
    targetType: string,
    targetId?: string,
    details?: Record<string, unknown>,
  ) => Promise<void>;
};

/** `pf_<16 hex>` — short, collision-safe identifiers for platform rows. */
function newId(): string {
  return `pf_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function newToken(): string {
  return randomBytes(16).toString("hex");
}

function parseBody<T>(raw: unknown, schema: z.ZodType<T>): { data: T } | { error: unknown } {
  const parsed = schema.safeParse(raw);
  return parsed.success ? { data: parsed.data } : { error: parsed.error.flatten() };
}

/** Balance of a wallet account, read from posted entries only. */
export async function pointsBalance(q: Queryable, userId: string): Promise<number> {
  const result = await q.query<Row>(
    `SELECT COALESCE(SUM(e.points), 0) AS balance
       FROM points_ledger_entries e
       JOIN points_ledger_groups g ON g.id = e.group_id
      WHERE e.account_id = $1 AND g.status = 'posted'`,
    [`user:${userId}`],
  );
  return Number(result.rows[0]?.balance ?? 0);
}

type GroupInput = {
  userId: string;
  workspace: string;
  kind: "credit" | "debit" | "refund" | "bonus";
  description: string;
  /** Signed number of points for the user's wallet. Negative debits. */
  amount: number;
  reference?: string | null;
  idempotencyKey?: string | null;
  counterparty?: string;
};

/**
 * Post one balanced points group. Must be called inside an open transaction.
 * Throws `INSUFFICIENT_POINTS` when a debit would overdraw the wallet.
 */
export async function postPointsGroup(client: Queryable, input: GroupInput): Promise<string> {
  const amount = Math.trunc(input.amount);
  if (!Number.isSafeInteger(amount) || amount === 0) throw new Error("INVALID_AMOUNT");

  if (input.idempotencyKey) {
    const prior = await client.query<Row>(
      "SELECT id FROM points_ledger_groups WHERE idempotency_key = $1",
      [input.idempotencyKey],
    );
    if (prior.rows[0]) throw new Error("DUPLICATE_REQUEST");
  }

  if (amount < 0) {
    const balance = await pointsBalance(client, input.userId);
    if (balance + amount < 0) throw new Error("INSUFFICIENT_POINTS");
  }

  const groupId = newId();
  await client.query(
    `INSERT INTO points_ledger_groups
       (id, user_id, workspace, kind, status, description, reference, idempotency_key)
     VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7)`,
    [
      groupId,
      input.userId,
      input.workspace,
      input.kind,
      input.description,
      input.reference ?? null,
      input.idempotencyKey ?? null,
    ],
  );
  await client.query(
    "INSERT INTO points_ledger_entries (id, group_id, account_id, points) VALUES ($1, $2, $3, $4)",
    [newId(), groupId, `user:${input.userId}`, amount],
  );
  await client.query(
    "INSERT INTO points_ledger_entries (id, group_id, account_id, points) VALUES ($1, $2, $3, $4)",
    [newId(), groupId, `platform:${input.counterparty ?? input.workspace}`, -amount],
  );
  // Posting validates balance/immutability invariants in SQL.
  await client.query("UPDATE points_ledger_groups SET status = 'posted' WHERE id = $1", [groupId]);
  // Materialise the cached balance for fast reads; the ledger stays authoritative.
  await client.query(
    `UPDATE app_users
        SET points_balance = (
          SELECT COALESCE(SUM(e.points), 0)
            FROM points_ledger_entries e
            JOIN points_ledger_groups g ON g.id = e.group_id
           WHERE e.account_id = $1 AND g.status = 'posted'
        ), updated_at = CURRENT_TIMESTAMP
      WHERE id = $2`,
    [`user:${input.userId}`, input.userId],
  );
  return groupId;
}

export function quoteShipment(weightKg: number, service: "express" | "economy" | "freight"): number {
  const weight = Math.max(0.5, weightKg);
  const raw =
    (PLATFORM_PRICING.shipment.base + weight * PLATFORM_PRICING.shipment.perKg) *
    PLATFORM_PRICING.shipment.multiplier[service];
  return Math.round(raw);
}

const emailSchema = z.string().trim().email().max(254);

function mapError(error: unknown): { code: string; message: string; status: 400 | 409 | 500 } {
  const code = error instanceof Error ? error.message : "ERROR";
  if (code === "INSUFFICIENT_POINTS") {
    return { code, message: "Insufficient points for this action.", status: 409 };
  }
  if (code === "DUPLICATE_REQUEST") {
    return { code, message: "This request was already processed.", status: 409 };
  }
  if (code === "INVALID_AMOUNT") {
    return { code, message: "The charge must be a positive points amount.", status: 400 };
  }
  return { code, message: "The operation could not be completed.", status: 500 };
}

export function registerPlatformRoutes(app: Hono<any>, deps: PlatformDeps): void {
  const { pool, auth, fail } = deps;
  // Handlers register in Hono order, so a route is
  //   get(path, [auth, ...middleware], handler)
  const get = (path: string, ...args: any[]) => (app as any).get(path, ...args);
  const post = (path: string, ...args: any[]) => (app as any).post(path, ...args);
  const patch = (path: string, ...args: any[]) => (app as any).patch(path, ...args);
  const del = (path: string, ...args: any[]) => (app as any).delete(path, ...args);

  const userOf = (c: any): ApiUser => c.get("user");

  async function notify(userId: string, workspace: string, title: string, body: string, q: Queryable = pool) {
    await q.query(
      "INSERT INTO platform_notifications (id, user_id, workspace, title, body) VALUES ($1, $2, $3, $4, $5)",
      [newId(), userId, workspace, title, body],
    );
  }

  async function ownsShipment(userId: string, shipmentId: string): Promise<Row | null> {
    const result = await pool.query<Row>(
      "SELECT * FROM platform_shipments WHERE id = $1 AND user_id = $2",
      [shipmentId, userId],
    );
    return result.rows[0] ?? null;
  }

  async function ownedTenant(user: ApiUser, tenantId: string): Promise<Row | null> {
    const result = await pool.query<Row>("SELECT * FROM tenant_sites WHERE id = $1", [tenantId]);
    const tenant = result.rows[0];
    if (!tenant) return null;
    if (user.role === "admin") return tenant;
    if (tenant.owner_user_id === user.id) return tenant;
    const membership = await pool.query<Row>(
      "SELECT 1 AS ok FROM tenant_users WHERE tenant_id = $1 AND user_id = $2",
      [tenantId, user.id],
    );
    return membership.rows[0] ? tenant : null;
  }

  /* ── Bootstrap: everything the five workspaces render ──────────────────── */

  get("/api/platform/bootstrap", auth, async (c: any) => {
    const user = userOf(c);
    const [profile, ledger, shipments, events, documents, sites, portalUsers, campaigns, orders, messages, notifications, referrals, deposits, listings] =
      await Promise.all([
        pool.query<Row>(
          "SELECT id,email,name,role,points_balance,referral_code,referred_by,phone,created_at FROM app_users WHERE id = $1",
          [user.id],
        ),
        pool.query<Row>(
          `SELECT g.id, g.user_id, g.workspace, g.kind, g.description, g.reference, g.created_at,
                  e.points AS points,
                  (SELECT COALESCE(SUM(e2.points), 0)
                     FROM points_ledger_entries e2
                     JOIN points_ledger_groups g2 ON g2.id = e2.group_id
                    WHERE e2.account_id = e.account_id AND g2.status = 'posted'
                      AND (g2.created_at < g.created_at OR (g2.created_at = g.created_at AND e2.rowid <= e.rowid))) AS balance_after
             FROM points_ledger_groups g
             JOIN points_ledger_entries e ON e.group_id = g.id AND e.account_id = $1
            WHERE g.user_id = $2 AND g.status = 'posted'
            ORDER BY g.created_at DESC, e.rowid DESC
            LIMIT 200`,
          [`user:${user.id}`, user.id],
        ),
        pool.query<Row>(
          "SELECT * FROM platform_shipments WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100",
          [user.id],
        ),
        pool.query<Row>(
          `SELECT e.* FROM platform_shipment_events e
             JOIN platform_shipments s ON s.id = e.shipment_id
            WHERE s.user_id = $1 ORDER BY e.at ASC LIMIT 500`,
          [user.id],
        ),
        pool.query<Row>(
          "SELECT * FROM platform_documents WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100",
          [user.id],
        ),
        pool.query<Row>(
          "SELECT * FROM tenant_sites WHERE owner_user_id = $1 ORDER BY created_at DESC LIMIT 100",
          [user.id],
        ),
        pool.query<Row>(
          `SELECT p.* FROM tenant_portal_users p
             JOIN tenant_sites s ON s.id = p.tenant_id
            WHERE s.owner_user_id = $1 ORDER BY p.invited_at ASC LIMIT 500`,
          [user.id],
        ),
        pool.query<Row>(
          "SELECT * FROM platform_campaigns WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100",
          [user.id],
        ),
        pool.query<Row>(
          "SELECT * FROM platform_orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100",
          [user.id],
        ),
        pool.query<Row>(
          `SELECT m.* FROM platform_order_messages m
             JOIN platform_orders o ON o.id = m.order_id
            WHERE o.user_id = $1 ORDER BY m.created_at ASC LIMIT 500`,
          [user.id],
        ),
        pool.query<Row>(
          "SELECT * FROM platform_notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100",
          [user.id],
        ),
        pool.query<Row>(
          `SELECT name, referral_code, created_at FROM app_users
            WHERE referred_by = (SELECT referral_code FROM app_users WHERE id = $1)
            ORDER BY created_at DESC LIMIT 100`,
          [user.id],
        ),
        pool.query<Row>(
          "SELECT * FROM platform_deposits WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50",
          [user.id],
        ),
        pool.query<Row>("SELECT * FROM platform_listings ORDER BY points ASC"),
      ]);

    const row = profile.rows[0];
    return c.json({
      user: {
        id: row.id,
        email: row.email,
        name: row.name,
        role: row.role,
        points: Number(row.points_balance ?? 0),
        referralCode: row.referral_code,
        referredBy: row.referred_by,
        phone: row.phone,
        createdAt: row.created_at,
      },
      ledger: ledger.rows,
      shipments: shipments.rows.map((shipment) => ({
        ...shipment,
        events: events.rows.filter((event) => event.shipment_id === shipment.id),
      })),
      documents: documents.rows,
      sites: sites.rows.map((site) => ({
        ...site,
        users: portalUsers.rows.filter((member) => member.tenant_id === site.id),
      })),
      campaigns: campaigns.rows,
      orders: orders.rows,
      messages: messages.rows,
      notifications: notifications.rows,
      referrals: referrals.rows,
      deposits: deposits.rows,
      listings: listings.rows,
    });
  });

  /* ── Points: deposits, ledger, refunds ─────────────────────────────────── */

  post("/api/platform/points/deposit", auth, async (c: any) => {
    if (!deps.checkRateLimit(c, "points:deposit", 10, 60_000)) return fail(c, 429, "Too many deposit requests. Wait a minute.");
    const parsed = parseBody(await c.req.json().catch(() => null), z.object({ packId: z.string().trim().min(1).max(60) }));
    if ("error" in parsed) return fail(c, 400, "A point pack is required.");
    const pack = await pool.query<Row>("SELECT * FROM platform_point_packs WHERE id = $1", [parsed.data.packId]);
    const found = pack.rows[0];
    if (!found) return fail(c, 404, "Point pack not found.");
    // A top-up is recorded as a pending deposit. Points are only credited once an
    // operator settles the payment — no fake settlement, no client-side credit.
    const id = newId();
    await pool.query(
      "INSERT INTO platform_deposits (id, user_id, pack_id, label, points, bonus, crypto) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [id, userOf(c).id, found.id, found.label, Number(found.points), Number(found.bonus), found.crypto],
    );
    return c.json({ deposit: { id, packId: found.id, label: found.label, points: Number(found.points) + Number(found.bonus), status: "pending", crypto: found.crypto } }, 201);
  });

  get("/api/platform/points/ledger", auth, async (c: any) => {
    const limit = Math.min(200, Math.max(1, Number(c.req.query("limit") ?? 100) || 100));
    const rows = await pool.query<Row>(
      `SELECT g.id, g.user_id, g.workspace, g.kind, g.description, g.reference, g.created_at, e.points
         FROM points_ledger_groups g
         JOIN points_ledger_entries e ON e.group_id = g.id AND e.account_id = $1
        WHERE g.user_id = $2 AND g.status = 'posted'
        ORDER BY g.created_at DESC, e.rowid DESC LIMIT $3`,
      [`user:${userOf(c).id}`, userOf(c).id, limit],
    );
    return c.json({ entries: rows.rows, balance: await pointsBalance(pool, userOf(c).id) });
  });

  post("/api/platform/admin/deposits/:id/settle", auth, async (c: any) => {
    const user = userOf(c);
    if (user.role !== "admin") return fail(c, 403, "Administrator access required.");
    const deposit = await pool.query<Row>("SELECT * FROM platform_deposits WHERE id = $1", [c.req.param("id")]);
    const row = deposit.rows[0];
    if (!row) return fail(c, 404, "Deposit not found.");
    if (row.status !== "pending") return fail(c, 409, "This deposit is already settled.");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await postPointsGroup(client, {
        userId: row.user_id,
        workspace: "personal",
        kind: "credit",
        description: `${row.label} pack · ${row.crypto} top-up`,
        amount: Number(row.points) + Number(row.bonus),
        reference: row.id,
        idempotencyKey: `deposit:${row.id}`,
        counterparty: "crypto",
      });
      await client.query(
        "UPDATE platform_deposits SET status = 'settled', settled_by = $1 WHERE id = $2 AND status = 'pending'",
        [user.id, row.id],
      );
      await notify(row.user_id, "personal", "Top-up settled", `${Number(row.points) + Number(row.bonus)} pts added to your balance.`, client);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      const mapped = mapError(error);
      return fail(c, mapped.status, mapped.message);
    } finally {
      await client.release();
    }
    await deps.recordAuditLog(user.id, "points.deposit.settle", "deposit", row.id, { points: row.points });
    return c.json({ ok: true });
  });

  post("/api/platform/admin/refund", auth, async (c: any) => {
    const user = userOf(c);
    if (user.role !== "admin") return fail(c, 403, "Administrator access required.");
    const parsed = parseBody(
      await c.req.json().catch(() => null),
      z.object({ groupId: z.string().trim().min(1), reason: z.string().trim().max(240).optional() }),
    );
    if ("error" in parsed) return fail(c, 400, "A ledger group and reason are required.");
    const group = await pool.query<Row>("SELECT * FROM points_ledger_groups WHERE id = $1 AND status = 'posted'", [parsed.data.groupId]);
    const original = group.rows[0];
    if (!original) return fail(c, 404, "Posted ledger group not found.");
    if (original.kind === "refund") return fail(c, 409, "Refund groups cannot be refunded.");
    const entry = await pool.query<Row>(
      "SELECT points FROM points_ledger_entries WHERE group_id = $1 AND account_id = $2",
      [original.id, `user:${original.user_id}`],
    );
    const charged = Number(entry.rows[0]?.points ?? 0);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await postPointsGroup(client, {
        userId: original.user_id,
        workspace: original.workspace,
        kind: "refund",
        description: `Refund · ${original.description}`.slice(0, 240),
        amount: -charged,
        reference: original.id,
        idempotencyKey: `refund:${original.id}`,
        counterparty: "refunds",
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      const mapped = mapError(error);
      return fail(c, mapped.status, mapped.message);
    } finally {
      await client.release();
    }
    await deps.recordAuditLog(user.id, "points.refund", "ledger_group", original.id, { reason: parsed.data.reason });
    return c.json({ ok: true });
  });

  /* ── Shipments ─────────────────────────────────────────────────────────── */

  const createShipmentSchema = z.object({
    origin: z.string().trim().min(1).max(120),
    destination: z.string().trim().min(1).max(120),
    recipientName: z.string().trim().min(1).max(120),
    recipientPhone: z.string().trim().max(40).optional().default(""),
    contents: z.string().trim().max(400).optional().default(""),
    weightKg: z.number().positive().max(50_000),
    declaredValue: z.number().min(0).max(1_000_000_000).optional().default(0),
    service: z.enum(["express", "economy", "freight"]),
    idempotencyKey: z.string().trim().min(8).max(160).optional(),
  });

  post("/api/platform/shipments", auth, async (c: any) => {
    if (!deps.checkRateLimit(c, "platform:shipment", 30, 60_000)) return fail(c, 429, "Too many shipment attempts.");
    const parsed = parseBody(await c.req.json().catch(() => null), createShipmentSchema);
    if ("error" in parsed) return c.json({ error: "Invalid shipment details", details: parsed.error }, 400);
    const input = parsed.data;
    const user = userOf(c);
    const cost = quoteShipment(input.weightKg, input.service);
    const id = newId();
    const code = `CLD-${randomBytes(3).toString("hex").toUpperCase()}`;
    const publicToken = newToken();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await postPointsGroup(client, {
        userId: user.id,
        workspace: "shipments",
        kind: "debit",
        description: `Shipment · ${input.origin} → ${input.destination}`,
        amount: -cost,
        reference: code,
        idempotencyKey: input.idempotencyKey ? `shipment:${user.id}:${input.idempotencyKey}` : null,
        counterparty: "logistics",
      });
      await client.query(
        `INSERT INTO platform_shipments
           (id, user_id, code, public_token, service, origin, destination, recipient_name, recipient_phone,
            contents, weight_kg, declared_value, cost_points, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'registered')`,
        [
          id, user.id, code, publicToken, input.service, input.origin, input.destination,
          input.recipientName, input.recipientPhone, input.contents, input.weightKg,
          input.declaredValue, cost,
        ],
      );
      await client.query(
        `INSERT INTO platform_shipment_events (id, shipment_id, status, label, location, note)
         VALUES ($1, $2, 'registered', 'Shipment registered', $3, $4)`,
        [newId(), id, input.origin, `${cost.toLocaleString()} pts deducted at creation`],
      );
      await notify(user.id, "shipments", `Shipment ${code} created`, `${input.origin} → ${input.destination}.`, client);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      const mapped = mapError(error);
      return fail(c, mapped.status, mapped.message);
    } finally {
      await client.release();
    }
    const created = await pool.query<Row>("SELECT * FROM platform_shipments WHERE id = $1", [id]);
    const events = await pool.query<Row>("SELECT * FROM platform_shipment_events WHERE shipment_id = $1 ORDER BY at ASC", [id]);
    return c.json({ shipment: { ...created.rows[0], events: events.rows } }, 201);
  });

  patch("/api/platform/shipments/:id/advance", auth, async (c: any) => {
    const parsed = parseBody(
      await c.req.json().catch(() => null),
      z.object({
        status: z.enum(["registered", "in_transit", "customs", "out_for_delivery", "delivered", "on_hold"]),
        location: z.string().trim().max(160).optional().default(""),
        note: z.string().trim().max(400).optional(),
      }),
    );
    if ("error" in parsed) return fail(c, 400, "Invalid shipment status.");
    const shipment = await ownsShipment(userOf(c).id, c.req.param("id"));
    if (!shipment) return fail(c, 404, "Shipment not found.");
    const label = parsed.data.status.replace(/_/g, " ").replace(/^\w/, (ch) => ch.toUpperCase());
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "UPDATE platform_shipments SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND user_id = $3",
        [parsed.data.status, shipment.id, userOf(c).id],
      );
      await client.query(
        "INSERT INTO platform_shipment_events (id, shipment_id, status, label, location, note) VALUES ($1,$2,$3,$4,$5,$6)",
        [newId(), shipment.id, parsed.data.status, label, parsed.data.location || shipment.destination, parsed.data.note ?? null],
      );
      await notify(userOf(c).id, "shipments", `${shipment.code} updated`, `${label} · ${parsed.data.location || shipment.destination}`, client);
      await client.query("COMMIT");
    } catch {
      await client.query("ROLLBACK").catch(() => undefined);
      return fail(c, 500, "Unable to update shipment.");
    } finally {
      await client.release();
    }
    const updated = await pool.query<Row>("SELECT * FROM platform_shipments WHERE id = $1", [shipment.id]);
    const events = await pool.query<Row>("SELECT * FROM platform_shipment_events WHERE shipment_id = $1 ORDER BY at ASC", [shipment.id]);
    return c.json({ shipment: { ...updated.rows[0], events: events.rows } });
  });

  get("/api/platform/track/:token", async (c: any) => {
    const result = await pool.query<Row>("SELECT * FROM platform_shipments WHERE public_token = $1", [c.req.param("token")]);
    const shipment = result.rows[0];
    if (!shipment) return fail(c, 404, "Tracking link not found.");
    const events = await pool.query<Row>(
      "SELECT status, label, location, note, at FROM platform_shipment_events WHERE shipment_id = $1 ORDER BY at ASC",
      [shipment.id],
    );
    // Public view: no recipient phone, no declared value.
    return c.json({
      shipment: {
        code: shipment.code,
        publicToken: shipment.public_token,
        service: shipment.service,
        origin: shipment.origin,
        destination: shipment.destination,
        recipientName: shipment.recipient_name,
        contents: shipment.contents,
        weightKg: shipment.weight_kg,
        status: shipment.status,
        createdAt: shipment.created_at,
        events: events.rows,
      },
    });
  });

  /* ── Documents ─────────────────────────────────────────────────────────── */

  const createDocumentSchema = z.object({
    kind: z.enum(["flight", "hotel", "invoice", "customs", "receipt"]),
    title: z.string().trim().min(1).max(160),
    passenger: z.string().trim().max(120).optional().default(""),
    reference: z.string().trim().max(80).optional().default(""),
    lines: z.array(z.object({ label: z.string().trim().max(80), value: z.string().trim().max(200) })).max(40).optional().default([]),
    total: z.number().nullable().optional().default(null),
    currency: z.string().trim().length(3).optional().default("NGN"),
    idempotencyKey: z.string().trim().min(8).max(160).optional(),
  });

  post("/api/platform/documents", auth, async (c: any) => {
    if (!deps.checkRateLimit(c, "platform:document", 40, 60_000)) return fail(c, 429, "Too many document attempts.");
    const parsed = parseBody(await c.req.json().catch(() => null), createDocumentSchema);
    if ("error" in parsed) return c.json({ error: "Invalid document details", details: parsed.error }, 400);
    const input = parsed.data;
    const user = userOf(c);
    const cost = PLATFORM_PRICING.document[input.kind] ?? 45;
    const id = newId();
    const publicToken = newToken();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await postPointsGroup(client, {
        userId: user.id,
        workspace: "ticketing",
        kind: "debit",
        description: `${input.title} · document render`,
        amount: -cost,
        reference: input.reference || null,
        idempotencyKey: input.idempotencyKey ? `document:${user.id}:${input.idempotencyKey}` : null,
        counterparty: "documents",
      });
      await client.query(
        `INSERT INTO platform_documents
           (id, user_id, public_token, kind, title, passenger, reference, lines, total, currency, points_charged)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          id, user.id, publicToken, input.kind, input.title, input.passenger, input.reference,
          JSON.stringify(input.lines), input.total, input.currency.toUpperCase(), cost,
        ],
      );
      await notify(user.id, "ticketing", `${input.title} rendered`, `Print-ready document available · ${cost} pts deducted.`, client);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      const mapped = mapError(error);
      return fail(c, mapped.status, mapped.message);
    } finally {
      await client.release();
    }
    const created = await pool.query<Row>("SELECT * FROM platform_documents WHERE id = $1", [id]);
    return c.json({ document: created.rows[0] }, 201);
  });

  get("/api/platform/documents/:token", async (c: any) => {
    const result = await pool.query<Row>("SELECT * FROM platform_documents WHERE public_token = $1", [c.req.param("token")]);
    if (!result.rows[0]) return fail(c, 404, "Document link not found.");
    return c.json({ document: result.rows[0] });
  });

  /* ── Marketplace orders and chat ───────────────────────────────────────── */

  post("/api/platform/orders", auth, async (c: any) => {
    if (!deps.checkRateLimit(c, "platform:order", 30, 60_000)) return fail(c, 429, "Too many order attempts.");
    const parsed = parseBody(
      await c.req.json().catch(() => null),
      z.object({ listingId: z.string().trim().min(1).max(60), idempotencyKey: z.string().trim().min(8).max(160).optional() }),
    );
    if ("error" in parsed) return fail(c, 400, "A marketplace listing is required.");
    const listing = await pool.query<Row>("SELECT * FROM platform_listings WHERE id = $1", [parsed.data.listingId]);
    const item = listing.rows[0];
    if (!item) return fail(c, 404, "Listing not found.");
    const user = userOf(c);
    const id = newId();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await postPointsGroup(client, {
        userId: user.id,
        workspace: "personal",
        kind: "debit",
        description: `Marketplace · ${item.title}`,
        amount: -Number(item.points),
        reference: item.id,
        idempotencyKey: parsed.data.idempotencyKey ? `order:${user.id}:${parsed.data.idempotencyKey}` : null,
        counterparty: "marketplace",
      });
      await client.query(
        `INSERT INTO platform_orders (id, user_id, listing_id, vendor, title, points, status)
         VALUES ($1,$2,$3,$4,$5,$6,'vendor_contacted')`,
        [id, user.id, item.id, item.vendor, item.title, Number(item.points)],
      );
      await client.query(
        "INSERT INTO platform_order_messages (id, order_id, sender, body) VALUES ($1,$2,'vendor',$3)",
        [newId(), id, `Thanks for the order on “${item.title}”. A coordinator will pick this up within the hour.`],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      const mapped = mapError(error);
      return fail(c, mapped.status, mapped.message);
    } finally {
      await client.release();
    }
    const order = await pool.query<Row>("SELECT * FROM platform_orders WHERE id = $1", [id]);
    const messages = await pool.query<Row>("SELECT * FROM platform_order_messages WHERE order_id = $1 ORDER BY created_at ASC", [id]);
    return c.json({ order: { ...order.rows[0], messages: messages.rows } }, 201);
  });

  post("/api/platform/orders/:id/messages", auth, async (c: any) => {
    const parsed = parseBody(await c.req.json().catch(() => null), z.object({ body: z.string().trim().min(1).max(2000) }));
    if ("error" in parsed) return fail(c, 400, "Write a message first.");
    const order = await pool.query<Row>(
      "SELECT id, vendor FROM platform_orders WHERE id = $1 AND user_id = $2",
      [c.req.param("id"), userOf(c).id],
    );
    if (!order.rows[0]) return fail(c, 404, "Order not found.");
    await pool.query(
      "INSERT INTO platform_order_messages (id, order_id, sender, body) VALUES ($1,$2,'customer',$3)",
      [newId(), order.rows[0].id, parsed.data.body],
    );
    return c.json({ ok: true }, 201);
  });

  /* ── Email campaigns ───────────────────────────────────────────────────── */

  post("/api/platform/campaigns", auth, async (c: any) => {
    if (!deps.checkRateLimit(c, "platform:campaign", 15, 60_000)) return fail(c, 429, "Too many campaign attempts.");
    const parsed = parseBody(
      await c.req.json().catch(() => null),
      z.object({
        template: z.string().trim().min(1).max(80),
        subject: z.string().trim().min(1).max(200),
        body: z.string().trim().min(1).max(20_000),
        recipients: z.array(emailSchema).min(1).max(500),
        idempotencyKey: z.string().trim().min(8).max(160).optional(),
      }),
    );
    if ("error" in parsed) return c.json({ error: "Invalid campaign details", details: parsed.error }, 400);
    const recipients = Array.from(new Set(parsed.data.recipients.map((value) => value.toLowerCase())));
    if (recipients.length === 0) return fail(c, 400, "Add at least one recipient.");
    const cost = recipients.length * PLATFORM_PRICING.campaignPerRecipient;
    const user = userOf(c);
    const id = newId();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await postPointsGroup(client, {
        userId: user.id,
        workspace: "services",
        kind: "debit",
        description: `Email campaign · ${recipients.length} recipients`,
        amount: -cost,
        reference: id,
        idempotencyKey: parsed.data.idempotencyKey ? `campaign:${user.id}:${parsed.data.idempotencyKey}` : null,
        counterparty: "email",
      });
      await client.query(
        `INSERT INTO platform_campaigns
           (id, user_id, template, subject, body, recipients, points_charged, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'queued')`,
        [id, user.id, parsed.data.template, parsed.data.subject, parsed.data.body, JSON.stringify(recipients), cost],
      );
      await notify(user.id, "services", "Campaign queued", `${recipients.length} recipients · ${cost} pts deducted.`, client);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      const mapped = mapError(error);
      return fail(c, mapped.status, mapped.message);
    } finally {
      await client.release();
    }
    const created = await pool.query<Row>("SELECT * FROM platform_campaigns WHERE id = $1", [id]);
    return c.json({ campaign: created.rows[0] }, 201);
  });

  /* ── Tenant portals ────────────────────────────────────────────────────── */

  const deploySchema = z.object({
    name: z.string().trim().min(1).max(120),
    slug: z.string().trim().min(3).max(60),
    plan: z.enum(["starter", "growth", "scale"]),
    kycRequired: z.boolean().optional().default(false),
    kycLevel: z.enum(["basic", "enhanced"]).optional().default("basic"),
    bankingEnabled: z.boolean().optional().default(false),
    investmentEnabled: z.boolean().optional().default(false),
    idempotencyKey: z.string().trim().min(8).max(160).optional(),
  });

  post("/api/platform/tenants", auth, async (c: any) => {
    if (!deps.checkRateLimit(c, "platform:tenant", 10, 60_000)) return fail(c, 429, "Too many portal deployments.");
    const parsed = parseBody(await c.req.json().catch(() => null), deploySchema);
    if ("error" in parsed) return c.json({ error: "Invalid portal details", details: parsed.error }, 400);
    const input = parsed.data;
    const slug = input.slug.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
    if (slug.length < 3) return fail(c, 400, "A slug of at least 3 characters is required.");
    const clash = await pool.query<Row>("SELECT id FROM tenant_sites WHERE slug = $1 OR subdomain = $1", [slug]);
    if (clash.rows[0]) return fail(c, 409, "That portal address is already deployed.");
    const user = userOf(c);
    const cost = PLATFORM_PRICING.siteSetup[input.plan];
    const renewal = PLATFORM_PRICING.siteRenewal[input.plan];
    const id = newId();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await postPointsGroup(client, {
        userId: user.id,
        workspace: "business",
        kind: "debit",
        description: `Portal deployment · ${input.name}`,
        amount: -cost,
        reference: slug,
        idempotencyKey: input.idempotencyKey ? `tenant:${user.id}:${input.idempotencyKey}` : null,
        counterparty: "tenancy",
      });
      await client.query(
        `INSERT INTO tenant_sites
           (id, owner_user_id, site_name, display_name, slug, subdomain, site_type, currency, country,
            banking_enabled, is_active, plan, status, kyc_required, kyc_level, investment_enabled,
            renewal_points, renews_at)
         VALUES ($1,$2,$3,$3,$4,$4,'business','NGN','NG', $5, 1, $6, 'live', $7, $8, $9, $10, datetime('now', '+30 days'))`,
        [id, user.id, input.name, slug, input.bankingEnabled ? 1 : 0, input.plan, input.kycRequired ? 1 : 0, input.kycLevel, input.investmentEnabled ? 1 : 0, renewal],
      );
      await client.query(
        "INSERT INTO tenant_portal_users (id, tenant_id, name, email, role) VALUES ($1,$2,$3,$4,'owner')",
        [newId(), id, user.name ?? user.email, user.email],
      );
      await notify(user.id, "business", `${input.name} is live`, `Portal deployed at /t/${slug} · renews in 30 days.`, client);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      const mapped = mapError(error);
      return fail(c, mapped.status, mapped.message);
    } finally {
      await client.release();
    }
    await deps.recordAuditLog(user.id, "tenant.deploy", "tenant", id, { plan: input.plan, slug });
    return c.json({ tenant: { id, name: input.name, slug } }, 201);
  });

  patch("/api/platform/tenants/:id", auth, async (c: any) => {
    const parsed = parseBody(
      await c.req.json().catch(() => null),
      z.object({
        kycRequired: z.boolean().optional(),
        kycLevel: z.enum(["basic", "enhanced"]).optional(),
        bankingEnabled: z.boolean().optional(),
        investmentEnabled: z.boolean().optional(),
        status: z.enum(["live", "pending_renewal", "suspended"]).optional(),
      }),
    );
    if ("error" in parsed) return fail(c, 400, "Invalid portal configuration.");
    const tenant = await ownedTenant(userOf(c), c.req.param("id"));
    if (!tenant) return fail(c, 404, "Portal not found.");
    const updates: string[] = [];
    const values: unknown[] = [];
    let index = 1;
    const push = (column: string, value: unknown) => {
      updates.push(`${column}=$${index++}`);
      values.push(value);
    };
    if (parsed.data.kycRequired !== undefined) push("kyc_required", parsed.data.kycRequired ? 1 : 0);
    if (parsed.data.kycLevel !== undefined) push("kyc_level", parsed.data.kycLevel);
    if (parsed.data.bankingEnabled !== undefined) push("banking_enabled", parsed.data.bankingEnabled ? 1 : 0);
    if (parsed.data.investmentEnabled !== undefined) push("investment_enabled", parsed.data.investmentEnabled ? 1 : 0);
    if (parsed.data.status !== undefined) push("status", parsed.data.status);
    if (updates.length === 0) return c.json({ ok: true });
    updates.push("updated_at=CURRENT_TIMESTAMP");
    values.push(tenant.id);
    await pool.query(`UPDATE tenant_sites SET ${updates.join(", ")} WHERE id=$${index}`, values);
    return c.json({ ok: true });
  });

  post("/api/platform/tenants/:id/renew", auth, async (c: any) => {
    const tenant = await ownedTenant(userOf(c), c.req.param("id"));
    if (!tenant) return fail(c, 404, "Portal not found.");
    const user = userOf(c);
    const renewal = Number(tenant.renewal_points ?? PLATFORM_PRICING.siteRenewal[String(tenant.plan ?? "starter")] ?? 900);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await postPointsGroup(client, {
        userId: user.id,
        workspace: "business",
        kind: "debit",
        description: `Portal renewal · ${tenant.site_name}`,
        amount: -renewal,
        reference: tenant.slug,
        idempotencyKey: `renew:${tenant.id}:${Date.now()}`,
        counterparty: "tenancy",
      });
      await client.query(
        "UPDATE tenant_sites SET status='live', renews_at=datetime('now','+30 days'), updated_at=CURRENT_TIMESTAMP WHERE id=$1",
        [tenant.id],
      );
      await notify(user.id, "business", `${tenant.site_name} renewed`, `Next renewal in 30 days · ${renewal} pts.`, client);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      const mapped = mapError(error);
      return fail(c, mapped.status, mapped.message);
    } finally {
      await client.release();
    }
    return c.json({ ok: true });
  });

  post("/api/platform/tenants/:id/users", auth, async (c: any) => {
    const parsed = parseBody(
      await c.req.json().catch(() => null),
      z.object({ name: z.string().trim().max(120).optional().default(""), email: emailSchema, role: z.enum(["staff", "viewer"]) }),
    );
    if ("error" in parsed) return fail(c, 400, "Invalid portal user details.");
    const tenant = await ownedTenant(userOf(c), c.req.param("id"));
    if (!tenant) return fail(c, 404, "Portal not found.");
    const email = parsed.data.email.toLowerCase();
    const existing = await pool.query<Row>(
      "SELECT id FROM tenant_portal_users WHERE tenant_id = $1 AND lower(email) = $2",
      [tenant.id, email],
    );
    if (existing.rows[0]) return fail(c, 409, "That user already has access.");
    await pool.query(
      "INSERT INTO tenant_portal_users (id, tenant_id, name, email, role) VALUES ($1,$2,$3,$4,$5)",
      [newId(), tenant.id, parsed.data.name || email.split("@")[0], email, parsed.data.role],
    );
    return c.json({ ok: true }, 201);
  });

  del("/api/platform/tenants/:id/users/:portalUserId", auth, async (c: any) => {
    const tenant = await ownedTenant(userOf(c), c.req.param("id"));
    if (!tenant) return fail(c, 404, "Portal not found.");
    await pool.query(
      "DELETE FROM tenant_portal_users WHERE id = $1 AND tenant_id = $2 AND role <> 'owner'",
      [c.req.param("portalUserId"), tenant.id],
    );
    return c.json({ ok: true });
  });

  /* ── Notifications and profile ─────────────────────────────────────────── */

  post("/api/platform/notifications/read-all", auth, async (c: any) => {
    await pool.query("UPDATE platform_notifications SET read = 1 WHERE user_id = $1 AND read = 0", [userOf(c).id]);
    return c.json({ ok: true });
  });

  patch("/api/platform/notifications/:id/read", auth, async (c: any) => {
    await pool.query("UPDATE platform_notifications SET read = 1 WHERE id = $1 AND user_id = $2", [
      c.req.param("id"),
      userOf(c).id,
    ]);
    return c.json({ ok: true });
  });

  patch("/api/platform/profile", auth, async (c: any) => {
    const parsed = parseBody(
      await c.req.json().catch(() => null),
      z.object({ name: z.string().trim().min(1).max(100).optional(), phone: z.string().trim().max(40).optional() }),
    );
    if ("error" in parsed) return fail(c, 400, "Invalid profile details.");
    const updates: string[] = [];
    const values: unknown[] = [];
    let index = 1;
    if (parsed.data.name !== undefined) {
      updates.push(`name=$${index++}`);
      values.push(parsed.data.name);
    }
    if (parsed.data.phone !== undefined) {
      updates.push(`phone=$${index++}`);
      values.push(parsed.data.phone);
    }
    if (updates.length === 0) return c.json({ ok: true });
    updates.push("updated_at=CURRENT_TIMESTAMP");
    values.push(userOf(c).id);
    await pool.query(`UPDATE app_users SET ${updates.join(", ")} WHERE id=$${index}`, values);
    return c.json({ ok: true });
  });
}
