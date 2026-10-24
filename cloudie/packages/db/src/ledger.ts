import { Prisma, TxType } from "@prisma/client";
import { prisma } from "./index.js";

export class InsufficientPointsError extends Error {
  readonly code = "INSUFFICIENT_POINTS";
  constructor(readonly balance: number, readonly required: number) {
    super(`Insufficient points: balance ${balance}, required ${required}`);
    this.name = "InsufficientPointsError";
  }
}

export class LedgerIdempotencyConflictError extends Error {
  readonly code = "IDEMPOTENCY_CONFLICT";
  constructor() { super("Idempotency key was already used for a different ledger operation"); this.name = "LedgerIdempotencyConflictError"; }
}

export type LedgerInput = {
  userId: string;
  amount: number;
  type: TxType;
  description: string;
  workspace: string;
  metadata?: Prisma.InputJsonValue;
  idempotencyKey: string;
  reversesId?: string;
};
export type LedgerEventPublisher = (event: { userId: string; balance: number; delta: number; description: string; ledgerId: string }) => Promise<void>;
let eventPublisher: LedgerEventPublisher = async () => undefined;
export function setLedgerEventPublisher(publisher: LedgerEventPublisher): void { eventPublisher = publisher; }

/**
 * Single point mutation entrypoint. Row lock, balance update, and immutable ledger
 * insert share one transaction. Event delivery occurs only after commit; production
 * wiring should publish via a durable outbox to survive Redis outages.
 */
export async function applyLedgerEntry(input: LedgerInput) {
  if (!Number.isSafeInteger(input.amount) || input.amount === 0) throw new RangeError("Ledger amount must be a non-zero safe integer");
  if (!input.idempotencyKey.trim()) throw new TypeError("An idempotency key is required");
  if (!input.description.trim() || !input.workspace.trim()) throw new TypeError("Description and workspace are required");

  const result = await prisma.$transaction(async (tx) => {
    const prior = await tx.pointLedger.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (prior) {
      if (prior.userId !== input.userId || prior.amount !== input.amount || prior.type !== input.type || prior.description !== input.description) throw new LedgerIdempotencyConflictError();
      const user = await tx.user.findUniqueOrThrow({ where: { id: input.userId }, select: { pointsBalance: true } });
      return { ledger: prior, balance: user.pointsBalance, duplicate: true };
    }

    const rows = await tx.$queryRaw<Array<{ id: string; pointsBalance: number }>>(Prisma.sql`SELECT "id", "pointsBalance" FROM "User" WHERE "id" = ${input.userId} FOR UPDATE`);
    const lockedUser = rows[0];
    if (!lockedUser) throw new Error("User not found");
    const nextBalance = lockedUser.pointsBalance + input.amount;
    if (nextBalance < 0) throw new InsufficientPointsError(lockedUser.pointsBalance, Math.abs(input.amount));
    if (!Number.isSafeInteger(nextBalance)) throw new RangeError("Points balance exceeds safe integer range");

    await tx.user.update({ where: { id: input.userId }, data: { pointsBalance: nextBalance } });
    const ledger = await tx.pointLedger.create({ data: {
      userId: input.userId, amount: input.amount, type: input.type, description: input.description,
      workspace: input.workspace, idempotencyKey: input.idempotencyKey,
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      ...(input.reversesId === undefined ? {} : { reversesId: input.reversesId }),
    } });
    return { ledger, balance: nextBalance, duplicate: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 10000 });

  if (!result.duplicate) {
    try { await eventPublisher({ userId: input.userId, balance: result.balance, delta: input.amount, description: input.description, ledgerId: result.ledger.id }); }
    catch { /* A durable outbox is required for guaranteed delivery; never roll back a committed charge. */ }
  }
  return result;
}

export async function refund(input: { userId: string; ledgerId: string; idempotencyKey: string; description?: string }) {
  const original = await prisma.pointLedger.findUnique({ where: { id: input.ledgerId } });
  if (!original) throw new Error("Original ledger entry not found");
  if (original.userId !== input.userId) throw new Error("Ledger entry does not belong to this user");
  if (original.reversedBy) throw new Error("Ledger entry has already been reversed");
  return applyLedgerEntry({
    userId: input.userId, amount: -original.amount, type: TxType.REFUND,
    description: input.description ?? `Refund: ${original.description}`, workspace: original.workspace,
    idempotencyKey: input.idempotencyKey, reversesId: original.id,
    metadata: { originalLedgerId: original.id },
  });
}
