"use node";

import { createAccount } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { randomBytes } from "node:crypto";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/**
 * Annotated deliberately. Letting TypeScript infer this action's return type
 * through `internal.demoSeedInternal` makes the generated API map circular —
 * the action's own signature is part of that map — which surfaces as TS7022.
 */
type SeedSummary =
  | { seeded: false; reason: string }
  | {
      seeded: true;
      shipments: number;
      walletBalanceNgn: number;
      points: number;
      notifications: number;
      services: number;
    };

/**
 * Creates the demo customer account and fills it with sample records.
 *
 * This mirrors `adminSeed.ts` deliberately: the account is created through
 * Convex Auth's own `createAccount`, so the password is Scrypt-hashed and the
 * `authAccounts` row is exactly what a normal sign-up writes. That means the
 * demo user signs in through the real `/login` form — no bypass, no special
 * case in the auth code.
 *
 * Gate: `DEMO_SEED_TOKEN` (falling back to `ADMIN_SEED_TOKEN`). Without a
 * configured token the action refuses to run, because it writes a funded
 * wallet — an ungated public action would be a free-balance endpoint.
 *
 * Run it with:
 *   bunx convex run demoSeed:seedDemoAccount '{"token":"<DEMO_SEED_TOKEN>"}'
 *
 * Pass `password` to choose the demo password. Omit it and a random one is
 * generated and returned once — no credential is ever committed to the repo.
 */
export const seedDemoAccount = action({
  args: {
    token: v.string(),
    email: v.optional(v.string()),
    password: v.optional(v.string()),
    name: v.optional(v.string()),
  },
  // The explicit return type is load-bearing: without it TypeScript infers this
  // action's signature through `internal.demoSeedInternal`, which is itself part
  // of the generated API map, producing a circular type that degrades every
  // `api.*` call in the app to `any`. `adminSeed.ts` annotates for the same reason.
  handler: async (
    ctx,
    args,
  ): Promise<{
    status: "created" | "already_provisioned";
    email: string;
    userId: Id<"users">;
    password: string | null;
    summary: SeedSummary;
  }> => {
    const expected = process.env.DEMO_SEED_TOKEN ?? process.env.ADMIN_SEED_TOKEN;
    if (!expected) {
      throw new Error(
        "SEED_DISABLED: set DEMO_SEED_TOKEN in the Keys tab, then re-run with that token.",
      );
    }
    if (args.token !== expected) {
      throw new Error("UNAUTHORIZED: invalid seed token");
    }

    const email = (args.email ?? "demo@cloudie.app").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("INVALID_EMAIL: enter a valid demo email address");
    }
    if (args.password !== undefined && args.password.length < 8) {
      throw new Error("Password must be at least 8 characters.");
    }

    const existing: { accountId: Id<"authAccounts">; userId: Id<"users"> } | null =
      await ctx.runQuery(internal.demoSeedInternal.findAccountByEmail, { email });

    // Re-runnable: an existing account keeps its password and simply has any
    // missing demo records filled in.
    if (existing) {
      const summary: SeedSummary = await ctx.runMutation(
        internal.demoSeedInternal.seedDemoData,
        { userId: existing.userId, email },
      );
      return {
        status: "already_provisioned" as const,
        email,
        userId: existing.userId,
        password: null,
        summary,
      };
    }

    const generated = args.password === undefined;
    const password = args.password ?? randomBytes(12).toString("base64url");

    const { user: createdUser } = await createAccount(ctx, {
      provider: "password",
      account: { id: email, secret: password },
      profile: {
        email,
        name: args.name?.trim() || "Demo Customer",
        role: "user",
        createdAt: Date.now(),
      },
    });

    const userId = createdUser?._id;
    if (!userId) throw new Error("SEED_FAILED: the auth account was created without a user row");

    const summary: SeedSummary = await ctx.runMutation(
      internal.demoSeedInternal.seedDemoData,
      { userId, email },
    );
    await ctx.runMutation(internal.demoSeedInternal.recordSeedAudit, { userId, email });

    return {
      status: "created" as const,
      email,
      userId,
      // Returned once, to whoever ran the command. Never stored in the repo.
      password: generated ? password : null,
      summary,
    };
  },
});
