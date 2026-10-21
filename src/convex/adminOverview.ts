import { getAuthUserId } from "@convex-dev/auth/server";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { v } from "convex/values";

/*
 * Admin command-centre reads.
 *
 * Everything here is admin-gated at the top of each handler (the router also
 * guards `/admin`, but an HTTP caller can hit a query directly). Reads are
 * capped — the dashboard must never turn into a full-table scan, and the numbers
 * it shows are explicitly "recent window" figures, labelled as such in the UI.
 */

const DAY = 86_400_000;
const LIVE_WINDOW = 5 * 60 * 1000;

async function requireAdmin(ctx: QueryCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Unauthorized");
  const user = await ctx.db.get(userId);
  if (user?.role !== "admin") throw new Error("Forbidden: admin only");
  return user;
}

function dayKey(ts: number) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export const overview = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const now = Date.now();

    // ── Points velocity (7 days, 2,000 most recent ledger rows) ──
    const ledger = await ctx.db.query("pointLedger").order("desc").take(2000);
    const buckets = new Map<number, { minted: number; burned: number }>();
    for (let i = 6; i >= 0; i -= 1) buckets.set(dayKey(now - i * DAY), { minted: 0, burned: 0 });
    for (const row of ledger) {
      const bucket = buckets.get(dayKey(row.createdAt));
      if (!bucket) continue;
      if (row.amount >= 0) bucket.minted += row.amount;
      else bucket.burned += Math.abs(row.amount);
    }
    const series = [...buckets.entries()].map(([day, value]) => ({
      day,
      minted: value.minted,
      burned: value.burned,
    }));
    const last24 = ledger.filter((row) => row.createdAt >= now - DAY);
    const minted24h = last24.filter((r) => r.amount >= 0).reduce((s, r) => s + r.amount, 0);
    const burned24h = last24.filter((r) => r.amount < 0).reduce((s, r) => s + Math.abs(r.amount), 0);

    // ── People & sessions ──
    const users = await ctx.db.query("users").take(600);
    const liveSessions = users.filter((u) => (u.lastActiveAt ?? 0) >= now - LIVE_WINDOW).length;
    const negativeBalances = users.filter((u) => (u.pointsBalance ?? 0) < 0).length;

    // ── Job health (email deliveries + money settlement) ──
    const deliveries = await ctx.db.query("emailDeliveries").order("desc").take(600);
    const pendingJobs = deliveries.filter((d) => d.status === "pending").length;
    const failedJobs = deliveries.filter((d) => d.status === "failed").length;
    const dlqJobs = deliveries.filter(
      (d) => d.status === "failed" && now - d._creationTime > 60 * 60 * 1000,
    ).length;
    const deposits = await ctx.db.query("bankingDeposits").order("desc").take(300);
    const pendingDeposits = deposits.filter((d) => ["pending", "processing"].includes(d.status)).length;
    const failedDeposits = deposits.filter((d) => d.status === "failed").length;

    // ── Recent privileged actions ──
    const audit = await ctx.db.query("auditLogs").order("desc").take(6);

    const alerts: { level: "error" | "warning" | "info"; title: string; detail: string }[] = [];
    if (dlqJobs > 0) {
      alerts.push({
        level: "error",
        title: "Dead-letter queue has entries",
        detail: `${dlqJobs} delivery${dlqJobs === 1 ? "" : "s"} failed and are older than an hour.`,
      });
    }
    if (negativeBalances > 0) {
      alerts.push({
        level: "error",
        title: "Ledger drift suspected",
        detail: `${negativeBalances} account${negativeBalances === 1 ? " has" : "s have"} a negative points balance — reconcile the ledger.`,
      });
    }
    const errorRate =
      deliveries.length === 0 ? 0 : (failedJobs / Math.max(deliveries.length, 1)) * 100;
    if (errorRate >= 10) {
      alerts.push({
        level: "warning",
        title: "Elevated delivery error rate",
        detail: `${errorRate.toFixed(1)}% of recent email jobs failed.`,
      });
    }
    if (pendingDeposits > 25) {
      alerts.push({
        level: "warning",
        title: "Settlement backlog",
        detail: `${pendingDeposits} deposits are waiting to be reconciled.`,
      });
    }
    if (alerts.length === 0) {
      alerts.push({
        level: "info",
        title: "All clear",
        detail: "No drift, DLQ entries or error spikes detected in the current window.",
      });
    }

    return {
      minted24h,
      burned24h,
      series,
      liveSessions,
      queuedJobs: pendingJobs + pendingDeposits,
      users: users.length,
      jobs: {
        pending: pendingJobs + pendingDeposits,
        failed: failedJobs + failedDeposits,
        dlq: dlqJobs,
        total: deliveries.length + deposits.length,
      },
      alerts,
      actions: audit.map((row) => ({
        _id: row._id,
        actor: row.actorEmail ?? "system",
        action: row.action,
        reason: row.reason ?? null,
        at: row.createdAt,
      })),
    };
  },
});

/** Users list: one bounded pass for users + one grouped pass for memberships. */
export const userRows = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const users = await ctx.db.query("users").order("desc").take(400);
    const memberships = await ctx.db.query("tenantUsers").take(1000);

    const workspaces = new Map<string, number>();
    for (const row of memberships) {
      if ((row.status ?? "active") !== "active") continue;
      workspaces.set(row.userId, (workspaces.get(row.userId) ?? 0) + 1);
    }

    return users.map((user) => ({
      _id: user._id,
      name: user.name ?? "",
      email: user.email ?? "",
      role: user.role ?? "user",
      status: user.isTerminated ? "terminated" : user.isSuspended ? "suspended" : "active",
      balanceNgn: user.walletBalanceNgn ?? 0,
      points: user.pointsBalance ?? 0,
      workspaces: workspaces.get(user._id) ?? 0,
      createdAt: user.createdAt ?? user._creationTime,
    }));
  },
});

/** Detail extras: tenant memberships and vendor profile for one user. */
export const userContext = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const memberships = await ctx.db.query("tenantUsers").take(1000);
    const mine = memberships.filter((row) => row.userId === args.userId);
    const sites = [];
    for (const row of mine.slice(0, 20)) {
      const site = await ctx.db.get(row.tenantId);
      if (!site) continue;
      sites.push({
        _id: site._id,
        siteName: site.siteName,
        subdomain: site.subdomain,
        siteType: site.siteType,
        role: row.role,
        status: row.status ?? "active",
      });
    }
    const vendor = await ctx.db
      .query("vendors")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
    return {
      sites,
      vendor: vendor
        ? {
            _id: vendor._id,
            businessName: vendor.businessName,
            status: vendor.status,
            statusReason: vendor.statusReason ?? null,
            totalSales: vendor.totalSales,
            earnings: vendor.earnings,
          }
        : null,
    };
  },
});
