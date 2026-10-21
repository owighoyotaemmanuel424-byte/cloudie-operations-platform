import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { effectivePointsCost } from "./pricing";

/*
 * Image studio render jobs.
 *
 * Billing follows the platform's "never keep money for an undelivered result"
 * rule (same philosophy as the email dispatch gate): points are debited when
 * the job starts, and any failure path — including a browser that closed
 * mid-render — refunds the debit through the same point ledger.
 */

/** A processing job older than this is assumed abandoned and gets refunded. */
const STALE_JOB_MS = 15 * 60 * 1000;

async function refundJob(
  ctx: MutationCtx,
  job: { userId: Id<"users">; pointsCost: number },
): Promise<void> {
  const user = await ctx.db.get(job.userId);
  if (!user) return;
  const balance = typeof user.pointsBalance === "number" ? user.pointsBalance : 0;
  const newBalance = balance + job.pointsCost;
  await ctx.db.patch(user._id, { pointsBalance: newBalance });
  await ctx.db.insert("pointLedger", {
    userId: user._id,
    amount: job.pointsCost,
    balanceAfter: newBalance,
    description: "Image render failed — points refunded",
    type: "refund",
    createdAt: Date.now(),
  });
}

/**
 * Start a billed render: charge the admin-configured `image_render` price
 * (platform default: 1 point) and open a job. Also sweeps this user's stale
 * processing jobs so a refresh mid-render can never strand a charge.
 */
export const createJob = mutation({
  args: {
    template: v.string(),
    params: v.any(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Unauthorized");
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("User not found");

    // Self-heal: refund abandoned jobs from a previous session before charging.
    const recent = await ctx.db
      .query("imageRenderJobs")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(25);
    const now = Date.now();
    for (const job of recent) {
      if (job.status === "processing" && now - job.createdAt > STALE_JOB_MS) {
        await refundJob(ctx, { userId: job.userId, pointsCost: job.pointsCost });
        await ctx.db.patch(job._id, {
          status: "failed",
          error: "Timed out before the render finished — points refunded.",
          completedAt: now,
        });
      }
    }

    const pointsCost = await effectivePointsCost(ctx, "image_render", 1);
    const balance = typeof user.pointsBalance === "number" ? user.pointsBalance : 0;
    if (balance < pointsCost) {
      throw new Error(
        `INSUFFICIENT_POINTS: Not enough points — you need ${pointsCost - balance} more. No points were charged.`,
      );
    }

    const newBalance = balance - pointsCost;
    await ctx.db.patch(userId, { pointsBalance: newBalance });
    await ctx.db.insert("pointLedger", {
      userId,
      amount: -pointsCost,
      balanceAfter: newBalance,
      description: `Image render: ${args.template}`,
      type: "image_rendering",
      createdAt: now,
    });

    const jobId = await ctx.db.insert("imageRenderJobs", {
      userId,
      status: "processing",
      template: args.template,
      params: args.params,
      pointsCost,
      createdAt: now,
    });

    return { jobId, pointsCost };
  },
});

/** Attach the stored PNG: only the job owner, only while still processing. */
export const completeJob = mutation({
  args: {
    jobId: v.id("imageRenderJobs"),
    fileId: v.id("storageFiles"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Unauthorized");
    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== userId) throw new Error("Not found");
    if (job.status === "succeeded") return { jobId: job._id }; // idempotent retry
    if (job.status !== "processing") {
      throw new Error("This render was already refunded and cannot be completed.");
    }

    const file = await ctx.db.get(args.fileId);
    if (!file || file.isDeleted || file.ownerId !== userId) {
      throw new Error("Rendered file not found in your storage.");
    }

    await ctx.db.patch(args.jobId, {
      status: "succeeded",
      fileId: args.fileId,
      completedAt: Date.now(),
    });
    return { jobId: job._id };
  },
});

/**
 * Fail a job and refund its charge. Idempotent: a job that already reached a
 * terminal state is left alone so the ledger can never be credited twice.
 */
export const failJob = mutation({
  args: {
    jobId: v.id("imageRenderJobs"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Unauthorized");
    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== userId) throw new Error("Not found");
    if (job.status !== "processing") {
      return { refunded: false };
    }

    await refundJob(ctx, { userId: job.userId, pointsCost: job.pointsCost });
    await ctx.db.patch(args.jobId, {
      status: "failed",
      error: (args.reason ?? "Render failed").slice(0, 300),
      completedAt: Date.now(),
    });
    return { refunded: true };
  },
});
