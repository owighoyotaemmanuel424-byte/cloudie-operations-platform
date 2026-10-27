/**
 * Regression suite for the administrative wallet adjustment — the P0 fix.
 *
 * Each case below maps to a finding from the financial-integrity audit:
 * NGN and points sharing one amount, SQL clamping that hid an insufficient
 * debit, no row lock, no idempotency, no rollback, and a swallowed audit
 * failure. The logic runs against a fake client so every failure path can be
 * exercised without a real database.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  applyWalletAdjustment,
  parseWalletAdjustInput,
  type ClientLike,
  type QueryResultLike,
  type WalletAdjustInput,
} from "./walletAdjust.js";

/* ── Fake client: transactions, locks, unique keys, injectable failures ───── */

type FakeUser = { id: string; wallet_balance_ngn: number; points_balance: number };

type FakeLedgerRow = Record<string, unknown>;

function ok(rows: Array<Record<string, unknown>> = [], rowCount = rows.length): QueryResultLike {
  return { rows, rowCount };
}

class FakeDb {
  users = new Map<string, FakeUser>();
  ledger: FakeLedgerRow[] = [];
  audit: Array<Record<string, unknown>> = [];
  /** Which statement should throw: "userUpdate" | "pointsUpdate" | "ledger" | "audit". */
  failOn: string | null = null;

  private snapshot: {
    users: Map<string, FakeUser>;
    ledger: FakeLedgerRow[];
    audit: Array<Record<string, unknown>>;
  } | null = null;

  private lockHeld = false;
  private waiters: Array<() => void> = [];

  seed(user: FakeUser) {
    this.users.set(user.id, { ...user });
  }

  private async acquireLock() {
    if (!this.lockHeld) {
      this.lockHeld = true;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private releaseLock() {
    const next = this.waiters.shift();
    if (next) next();
    else this.lockHeld = false;
  }

  client(): ClientLike {
    return { query: (text, values) => this.run(text, values ?? []) };
  }

  private async run(text: string, values: unknown[]): Promise<QueryResultLike> {
    // Serializes transactions exactly like FOR UPDATE + pool clients would.
    const sql = text.trim();

    if (sql === "BEGIN") {
      this.snapshot = {
        users: new Map([...this.users].map(([k, v]) => [k, { ...v }])),
        ledger: this.ledger.map((row) => ({ ...row })),
        audit: this.audit.map((row) => ({ ...row })),
      };
      return ok([], 0);
    }
    if (sql === "COMMIT") {
      this.snapshot = null;
      this.releaseLock();
      return ok([], 0);
    }
    if (sql === "ROLLBACK") {
      if (this.snapshot) {
        this.users = this.snapshot.users;
        this.ledger = this.snapshot.ledger;
        this.audit = this.snapshot.audit;
        this.snapshot = null;
      }
      this.releaseLock();
      return ok([], 0);
    }

    if (sql.includes("FROM app_users WHERE id = $1 FOR UPDATE")) {
      await this.acquireLock();
      const user = this.users.get(String(values[0]));
      return user ? ok([{ wallet_balance_ngn: user.wallet_balance_ngn, points_balance: user.points_balance }]) : ok([]);
    }

    if (sql.includes("UPDATE app_users SET wallet_balance_ngn")) {
      if (this.failOn === "userUpdate") throw new Error("simulated balance update failure");
      const [nextBalance, id, expected] = values as [number, string, number];
      const user = this.users.get(id);
      if (!user || user.wallet_balance_ngn !== expected) return ok([], 0);
      user.wallet_balance_ngn = nextBalance;
      return ok([], 1);
    }

    if (sql.includes("UPDATE app_users SET points_balance")) {
      if (this.failOn === "pointsUpdate") throw new Error("simulated points update failure");
      const [nextPoints, id, expected] = values as [number, string, number];
      const user = this.users.get(id);
      if (!user || user.points_balance !== expected) return ok([], 0);
      user.points_balance = nextPoints;
      return ok([], 1);
    }

    if (sql.includes("INSERT INTO wallet_ledger")) {
      if (this.failOn === "ledger") throw new Error("simulated ledger outage");
      const [userId, amount, balanceAfter, description, key, details] = values as [
        string, number, number, string, string | null, string,
      ];
      if (key && this.ledger.some((row) => row.idempotency_key === key)) return ok([], 0);
      this.ledger.push({
        user_id: userId,
        amount_ngn: amount,
        balance_after_ngn: balanceAfter,
        description,
        transaction_type: "admin_adjust",
        idempotency_key: key,
        metadata: JSON.parse(details),
      });
      return ok([], 1);
    }

    if (sql.includes("SELECT balance_after_ngn, metadata FROM wallet_ledger")) {
      const key = String(values[0]);
      const row = this.ledger.find((entry) => entry.idempotency_key === key);
      return row ? ok([{ balance_after_ngn: row.balance_after_ngn, metadata: row.metadata }]) : ok([]);
    }

    if (sql.includes("INSERT INTO admin_audit_logs")) {
      if (this.failOn === "audit") throw new Error("simulated audit outage");
      const [actorId, targetId, details] = values as [string, string, string];
      const parsed = JSON.parse(details) as Record<string, unknown>;
      this.audit.push({
        actor_user_id: actorId,
        action: "wallet.adjust",
        target_type: "user",
        target_id: targetId,
        details: parsed,
        idempotency_key: parsed.idempotency_key ?? null,
      });
      return ok([], 1);
    }

    if (sql.includes("FROM admin_audit_logs WHERE action")) {
      const key = String(values[1]);
      const row = this.audit.find((entry) => entry.idempotency_key === key);
      return row ? ok([{ details: row.details }]) : ok([]);
    }

    throw new Error(`Unexpected query in fake db: ${sql}`);
  }
}

function input(overrides: Partial<WalletAdjustInput> = {}): WalletAdjustInput {
  return {
    amountNgn: 0,
    pointsDelta: 0,
    description: "Admin wallet adjustment",
    idempotencyKey: null,
    ...overrides,
  };
}

/* ── Input validation ─────────────────────────────────────────────────────── */

test("rejects a zero amount", () => {
  const parsed = parseWalletAdjustInput({ amount_ngn: 0 });
  assert.equal(parsed.ok, false);
});

test("rejects NaN, Infinity, strings and malformed bodies", () => {
  for (const raw of [
    { amount_ngn: Number.NaN },
    { amount_ngn: Number.POSITIVE_INFINITY },
    { amount_ngn: "1000" },
    { amount_ngn: true },
    "not an object",
    null,
  ]) {
    const parsed = parseWalletAdjustInput(raw);
    assert.equal(parsed.ok, false, `expected rejection for ${JSON.stringify(raw)}`);
  }
});

test("rejects sub-kobo precision and absurd magnitudes", () => {
  assert.equal(parseWalletAdjustInput({ amount_ngn: 2.005 }).ok, false);
  assert.equal(parseWalletAdjustInput({ amount_ngn: 1e12 }).ok, false);
  assert.equal(parseWalletAdjustInput({ amount_ngn: -1e12 }).ok, false);
  assert.equal(parseWalletAdjustInput({ points_delta: 1.5 }).ok, false);
});

test("a debit-only request parses as NGN-only with zero points delta", () => {
  const parsed = parseWalletAdjustInput({ amount_ngn: -1500, description: "chargeback" });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.input.amountNgn, -1500);
  assert.equal(parsed.input.pointsDelta, 0);
  assert.equal(parsed.input.description, "chargeback");
});

/* ── NGN and points separation ────────────────────────────────────────────── */

test("a NGN credit moves only NGN; the points balance is untouched", async () => {
  const db = new FakeDb();
  db.seed({ id: "u1", wallet_balance_ngn: 0, points_balance: 100 });

  const result = await applyWalletAdjustment(db.client(), {
    actorId: "admin1",
    targetId: "u1",
    input: input({ amountNgn: 5000 }),
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.balanceAfterNgn, 5000);
  assert.equal(db.users.get("u1")!.points_balance, 100, "points must not follow the NGN amount");
  assert.equal(db.ledger.length, 1);
  assert.equal(db.ledger[0].amount_ngn, 5000);
});

test("a points-only adjustment leaves the NGN wallet untouched", async () => {
  const db = new FakeDb();
  db.seed({ id: "u1", wallet_balance_ngn: 750, points_balance: 0 });

  const result = await applyWalletAdjustment(db.client(), {
    actorId: "admin1",
    targetId: "u1",
    input: input({ pointsDelta: 250 }),
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(db.users.get("u1")!.wallet_balance_ngn, 750);
  assert.equal(result.pointsAfter, 250);
  assert.equal(db.ledger.length, 0, "a points-only change writes no NGN ledger row");
  assert.equal(db.audit.length, 1);
});

test("an explicit dual adjustment applies each unit by its own amount", async () => {
  const db = new FakeDb();
  db.seed({ id: "u1", wallet_balance_ngn: 10_000, points_balance: 0 });

  const result = await applyWalletAdjustment(db.client(), {
    actorId: "admin1",
    targetId: "u1",
    input: input({ amountNgn: -1000, pointsDelta: 40 }),
  });

  assert.equal(result.ok, true);
  const user = db.users.get("u1")!;
  assert.equal(user.wallet_balance_ngn, 9000);
  assert.equal(user.points_balance, 40);
  assert.equal(db.ledger[0].amount_ngn, -1000);
});

/* ── Balance integrity ────────────────────────────────────────────────────── */

test("rejects a debit larger than the balance instead of clamping to zero", async () => {
  const db = new FakeDb();
  db.seed({ id: "u1", wallet_balance_ngn: 300, points_balance: 5 });

  const result = await applyWalletAdjustment(db.client(), {
    actorId: "admin1",
    targetId: "u1",
    input: input({ amountNgn: -5000 }),
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "INSUFFICIENT_FUNDS");
  assert.equal(db.users.get("u1")!.wallet_balance_ngn, 300, "balance must not be clamped");
  assert.equal(db.ledger.length, 0, "no ledger row for a rejected debit");
  assert.equal(db.audit.length, 0);
});

test("rejects a points debit larger than the balance", async () => {
  const db = new FakeDb();
  db.seed({ id: "u1", wallet_balance_ngn: 9999, points_balance: 10 });

  const result = await applyWalletAdjustment(db.client(), {
    actorId: "admin1",
    targetId: "u1",
    input: input({ pointsDelta: -500 }),
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "INSUFFICIENT_POINTS");
  assert.equal(db.users.get("u1")!.points_balance, 10);
});

test("the ledger row records the actual balance change, not the request", async () => {
  const db = new FakeDb();
  db.seed({ id: "u1", wallet_balance_ngn: 1_000_000, points_balance: 0 });

  const result = await applyWalletAdjustment(db.client(), {
    actorId: "admin1",
    targetId: "u1",
    input: input({ amountNgn: -250.75 }),
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const row = db.ledger[0];
  assert.equal(result.balanceAfterNgn, 999_749.25);
  assert.equal(row.balance_after_ngn, 999_749.25);
  assert.equal(row.amount_ngn, -250.75);
  assert.equal((row.metadata as { ngn: { before: number; after: number } }).ngn.before, 1_000_000);
});

test("unknown user returns USER_NOT_FOUND and writes nothing", async () => {
  const db = new FakeDb();
  const result = await applyWalletAdjustment(db.client(), {
    actorId: "admin1",
    targetId: "ghost",
    input: input({ amountNgn: 100 }),
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 404);
  assert.equal(db.ledger.length, 0);
  assert.equal(db.audit.length, 0);
});

/* ── Concurrency ──────────────────────────────────────────────────────────── */

test("two concurrent debits cannot spend the same funds", async () => {
  const db = new FakeDb();
  db.seed({ id: "u1", wallet_balance_ngn: 10_000, points_balance: 0 });
  const client = db.client();

  const [first, second] = await Promise.all([
    applyWalletAdjustment(client, { actorId: "admin1", targetId: "u1", input: input({ amountNgn: -7000 }) }),
    applyWalletAdjustment(client, { actorId: "admin2", targetId: "u1", input: input({ amountNgn: -7000 }) }),
  ]);

  const outcomes = [first, second].filter((r) => r.ok);
  const rejected = [first, second].filter((r) => !r.ok);
  assert.equal(outcomes.length, 1, "exactly one debit succeeds");
  assert.equal(rejected.length, 1);
  assert.equal(db.users.get("u1")!.wallet_balance_ngn, 3000);
  assert.equal(db.ledger.length, 1, "exactly one ledger row");
  assert.equal(db.audit.length, 1);
});

/* ── Idempotency ──────────────────────────────────────────────────────────── */

test("a retried request with the same idempotency key applies once", async () => {
  const db = new FakeDb();
  db.seed({ id: "u1", wallet_balance_ngn: 0, points_balance: 0 });

  const call = () =>
    applyWalletAdjustment(db.client(), {
      actorId: "admin1",
      targetId: "u1",
      input: input({ amountNgn: 25_000, idempotencyKey: "adjust-2024-0001" }),
    });

  const first = await call();
  const second = await call();

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true);
  assert.equal(db.users.get("u1")!.wallet_balance_ngn, 25_000, "applied exactly once");
  assert.equal(db.ledger.length, 1);
  assert.equal(db.audit.length, 1);
});

/* ── Rollback and audit reliability ───────────────────────────────────────── */

test("a ledger failure rolls back the balance change and reports failure", async () => {
  const db = new FakeDb();
  db.seed({ id: "u1", wallet_balance_ngn: 4000, points_balance: 0 });
  db.failOn = "ledger";

  const result = await applyWalletAdjustment(db.client(), {
    actorId: "admin1",
    targetId: "u1",
    input: input({ amountNgn: -1000 }),
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 500);
  assert.equal(db.users.get("u1")!.wallet_balance_ngn, 4000, "balance rolled back with the ledger");
  assert.equal(db.audit.length, 0);
});

test("an audit failure aborts the mutation instead of reporting success", async () => {
  const db = new FakeDb();
  db.seed({ id: "u1", wallet_balance_ngn: 1000, points_balance: 0 });
  db.failOn = "audit";

  const result = await applyWalletAdjustment(db.client(), {
    actorId: "admin1",
    targetId: "u1",
    input: input({ amountNgn: 9999 }),
  });

  assert.equal(result.ok, false, "a critical mutation never succeeds without its audit record");
  if (result.ok) return;
  assert.equal(result.status, 500);
  assert.equal(db.users.get("u1")!.wallet_balance_ngn, 1000, "balance rolled back with the audit");
  assert.equal(db.ledger.length, 0);
});

test("audit details carry actor context, before/after balances and the reason", async () => {
  const db = new FakeDb();
  db.seed({ id: "u1", wallet_balance_ngn: 200, points_balance: 10 });

  await applyWalletAdjustment(db.client(), {
    actorId: "admin-actor",
    targetId: "u1",
    input: input({ amountNgn: 50, pointsDelta: 5, description: "compensation for outage", idempotencyKey: "comp-9001" }),
  });

  assert.equal(db.audit.length, 1);
  const entry = db.audit[0];
  assert.equal(entry.actor_user_id, "admin-actor");
  assert.equal(entry.target_id, "u1");
  const details = entry.details as {
    reason: string;
    idempotency_key: string;
    ngn: { before: number; after: number };
    points: { before: number; after: number };
  };
  assert.equal(details.reason, "compensation for outage");
  assert.equal(details.idempotency_key, "comp-9001");
  assert.deepEqual(details.ngn, { before: 200, after: 250 });
  assert.deepEqual(details.points, { before: 10, after: 15 });
});
