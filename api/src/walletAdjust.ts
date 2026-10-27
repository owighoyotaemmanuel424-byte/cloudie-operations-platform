/**
 * Administrative wallet adjustment — the only place in the Neon API that changes
 * a customer's NGN balance or points balance.
 *
 * Invariants enforced here (each one is pinned by api/src/walletAdjust.test.ts):
 *
 *  1. NGN and points are separate units. One amount never drives both: the NGN
 *     delta comes from `amount_ngn`, the points delta only from an explicit
 *     `points_delta`. A NGN-only adjustment leaves points untouched.
 *  2. No SQL clamping. A debit larger than the balance is rejected (400), never
 *     silently truncated to zero while the ledger records the full request, so
 *     the ledger amount always equals the real balance change.
 *  3. The user row is locked `FOR UPDATE`, so two concurrent debits cannot spend
 *     the same funds.
 *  4. `idempotency_key` makes a retried request replay the original result
 *     instead of applying the movement twice.
 *  5. The audit row is written on the SAME connection inside the SAME
 *     transaction. If audit recording fails the balance change rolls back and
 *     the caller is told the adjustment failed — a critical mutation never
 *     reports success without its audit record.
 *  6. Failures roll back every write; nothing partial is committed.
 */
import { z } from "zod";

/* ── Minimal structural types so the logic can run against pg or a fake ───── */

export type QueryResultLike = {
  rows: Array<Record<string, unknown>>;
  rowCount: number | null;
};

export type ClientLike = {
  query(text: string, values?: unknown[]): Promise<QueryResultLike>;
};

/* ── Input validation ─────────────────────────────────────────────────────── */

/** Single-adjustment ceilings. Anything larger is an operator mistake, not a real request. */
export const MAX_ADJUST_NGN = 10_000_000_000; // ₦10,000,000,000
export const MAX_ADJUST_POINTS = 1_000_000_000; // 1,000,000,000 points

const rawSchema = z.object({
  amount_ngn: z.number().optional(),
  amountNgn: z.number().optional(),
  amount: z.number().optional(),
  points_delta: z.number().optional(),
  pointsDelta: z.number().optional(),
  description: z.string().trim().max(500).optional(),
  reason: z.string().trim().max(500).optional(),
  idempotency_key: z.string().trim().min(8).max(120).optional(),
});

export type WalletAdjustInput = {
  /** NGN delta, positive = credit, negative = debit. Two decimal places. */
  amountNgn: number;
  /** Points delta, positive = grant, negative = spend. Whole points only. */
  pointsDelta: number;
  description: string;
  idempotencyKey: string | null;
};

export type ParseResult =
  | { ok: true; input: WalletAdjustInput }
  | { ok: false; message: string };

function reject(message: string): ParseResult {
  return { ok: false, message };
}

export function parseWalletAdjustInput(raw: unknown): ParseResult {
  const parsed = rawSchema.safeParse(raw);
  if (!parsed.success) return reject("Invalid adjustment request");
  const data = parsed.data;

  const amountNgn = data.amount_ngn ?? data.amountNgn ?? data.amount ?? 0;
  const pointsDelta = data.points_delta ?? data.pointsDelta ?? 0;

  if (!Number.isFinite(amountNgn)) return reject("NGN amount must be a finite number");
  if (!Number.isFinite(pointsDelta)) return reject("Points amount must be a finite number");
  if (Math.abs(amountNgn) > MAX_ADJUST_NGN) return reject("NGN amount exceeds the single-adjustment limit");
  if (Math.abs(pointsDelta) > MAX_ADJUST_POINTS) return reject("Points amount exceeds the single-adjustment limit");
  if (Math.abs(Math.round(amountNgn * 100) - amountNgn * 100) > 1e-6) {
    return reject("NGN amount must be in whole kobo (max two decimal places)");
  }
  if (!Number.isInteger(pointsDelta)) return reject("Points adjustments must be whole points");
  if (amountNgn === 0 && pointsDelta === 0) return reject("Non-zero amount required");

  return {
    ok: true,
    input: {
      amountNgn: Math.round(amountNgn * 100) / 100,
      pointsDelta,
      description: (data.description || data.reason || "Admin wallet adjustment").slice(0, 500),
      idempotencyKey: data.idempotency_key ?? null,
    },
  };
}

/* ── Execution ────────────────────────────────────────────────────────────── */

export type WalletAdjustParams = {
  actorId: string;
  targetId: string;
  input: WalletAdjustInput;
};

export type WalletAdjustOutcome =
  | { ok: true; balanceAfterNgn: number; pointsAfter: number; replayed: boolean }
  | { ok: false; status: 400 | 404 | 409 | 500; code: string; message: string };

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

async function rollback(client: ClientLike): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // The connection may already be broken; the pool discards it either way.
  }
}

function failure(
  status: 400 | 404 | 409 | 500,
  code: string,
  message: string,
): WalletAdjustOutcome {
  return { ok: false, status, code, message };
}

export async function applyWalletAdjustment(
  client: ClientLike,
  params: WalletAdjustParams,
): Promise<WalletAdjustOutcome> {
  const { actorId, targetId, input } = params;
  const { amountNgn, pointsDelta, description, idempotencyKey } = input;

  try {
    await client.query("BEGIN");

    // 1. Lock the target row. Everything below runs against a stable snapshot,
    //    so concurrent adjustments serialize instead of double-spending.
    const current = await client.query(
      "SELECT wallet_balance_ngn, points_balance FROM app_users WHERE id = $1 FOR UPDATE",
      [targetId],
    );
    const row = current.rows[0];
    if (!row) {
      await rollback(client);
      return failure(404, "USER_NOT_FOUND", "User not found");
    }

    const balanceBefore = Number(row.wallet_balance_ngn);
    const pointsBefore = Number(row.points_balance);
    if (!Number.isFinite(balanceBefore) || !Number.isFinite(pointsBefore)) {
      await rollback(client);
      return failure(500, "INVALID_BALANCE", "Stored balance is unreadable");
    }

    // 2. Idempotent replay: the audit row always carries the key, the ledger row
    //    carries it for NGN movements. Either proves this request already ran.
    if (idempotencyKey) {
      const priorLedger = await client.query(
        "SELECT balance_after_ngn, metadata FROM wallet_ledger WHERE idempotency_key = $1",
        [idempotencyKey],
      );
      const priorLedgerRow = priorLedger.rows[0];
      if (priorLedgerRow) {
        await client.query("COMMIT");
        const meta = (priorLedgerRow.metadata ?? {}) as Record<string, unknown>;
        const points = (meta.points ?? {}) as Record<string, unknown>;
        return {
          ok: true,
          balanceAfterNgn: Number(priorLedgerRow.balance_after_ngn),
          pointsAfter: Number.isFinite(Number(points.after)) ? Number(points.after) : pointsBefore,
          replayed: true,
        };
      }
      const priorAudit = await client.query(
        "SELECT details FROM admin_audit_logs WHERE action = $1 AND details->>'idempotency_key' = $2 LIMIT 1",
        ["wallet.adjust", idempotencyKey],
      );
      if (priorAudit.rows.length > 0) {
        await client.query("COMMIT");
        return {
          ok: true,
          balanceAfterNgn: balanceBefore,
          pointsAfter: pointsBefore,
          replayed: true,
        };
      }
    }

    // 3. Validate the resulting balances — rejection, not clamping.
    const balanceAfter = round2(balanceBefore + amountNgn);
    const pointsAfter = pointsBefore + pointsDelta;
    if (balanceAfter < 0) {
      await rollback(client);
      return failure(
        400,
        "INSUFFICIENT_FUNDS",
        `Debit exceeds the available balance of ${balanceBefore}`,
      );
    }
    if (pointsAfter < 0) {
      await rollback(client);
      return failure(400, "INSUFFICIENT_POINTS", `Debit exceeds the available points of ${pointsBefore}`);
    }

    const details = JSON.stringify({
      idempotency_key: idempotencyKey,
      reason: description,
      requested: { ngn: amountNgn, points: pointsDelta },
      ngn: { before: balanceBefore, after: balanceAfter },
      points: { before: pointsBefore, after: pointsAfter },
    });

    // 4. NGN movement: balance row + ledger row, both inside this transaction.
    if (amountNgn !== 0) {
      const updated = await client.query(
        "UPDATE app_users SET wallet_balance_ngn = $1, updated_at = NOW() WHERE id = $2 AND wallet_balance_ngn = $3",
        [balanceAfter, targetId, balanceBefore],
      );
      if ((updated.rowCount ?? 0) !== 1) {
        await rollback(client);
        return failure(409, "CONCURRENT_MODIFICATION", "Balance changed while adjusting; retry");
      }
      const ledgerInsert = await client.query(
        `INSERT INTO wallet_ledger (user_id, amount_ngn, balance_after_ngn, description, transaction_type, idempotency_key, metadata)
         VALUES ($1, $2, $3, $4, 'admin_adjust', $5, $6)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [targetId, amountNgn, balanceAfter, description, idempotencyKey, details],
      );
      if ((ledgerInsert.rowCount ?? 0) !== 1) {
        // Unique violation on the idempotency key: a concurrent retry won. Roll
        // back and replay its recorded result rather than double-applying.
        await rollback(client);
        const prior = await client.query(
          "SELECT balance_after_ngn, metadata FROM wallet_ledger WHERE idempotency_key = $1",
          [idempotencyKey],
        );
        const priorRow = prior.rows[0];
        if (priorRow) {
          const meta = (priorRow.metadata ?? {}) as Record<string, unknown>;
          const points = (meta.points ?? {}) as Record<string, unknown>;
          return {
            ok: true,
            balanceAfterNgn: Number(priorRow.balance_after_ngn),
            pointsAfter: Number.isFinite(Number(points.after)) ? Number(points.after) : pointsBefore,
            replayed: true,
          };
        }
        return failure(409, "DUPLICATE_ADJUSTMENT", "Adjustment already recorded");
      }
    }

    // 5. Points movement — a separate operation, never derived from the NGN amount.
    if (pointsDelta !== 0) {
      const updated = await client.query(
        "UPDATE app_users SET points_balance = $1, updated_at = NOW() WHERE id = $2 AND points_balance = $3",
        [pointsAfter, targetId, pointsBefore],
      );
      if ((updated.rowCount ?? 0) !== 1) {
        await rollback(client);
        return failure(409, "CONCURRENT_MODIFICATION", "Points balance changed while adjusting; retry");
      }
    }

    // 6. Audit in the same transaction: a failed audit write aborts the mutation.
    await client.query(
      `INSERT INTO admin_audit_logs (actor_user_id, action, target_type, target_id, details)
       VALUES ($1, 'wallet.adjust', 'user', $2, $3)`,
      [actorId, targetId, details],
    );

    await client.query("COMMIT");
    return { ok: true, balanceAfterNgn: balanceAfter, pointsAfter, replayed: false };
  } catch {
    await rollback(client);
    return failure(500, "ADJUSTMENT_FAILED", "Failed to adjust wallet");
  }
}
