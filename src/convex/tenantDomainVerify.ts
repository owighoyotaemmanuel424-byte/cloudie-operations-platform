"use node";

import dns from "node:dns/promises";
import { getAuthUserId } from "@convex-dev/auth/server";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

/**
 * Verify a custom domain by looking for the site's TXT challenge record.
 *
 * Both the `_cloudie-challenge` and `_cloudie` hostnames are accepted so owners
 * who already published a record from an earlier flow are not stuck. The check
 * is deliberately tolerant of provider TXT chunking: some DNS hosts split long
 * values into quoted segments, so the joined record is compared too.
 */
export const verifyDomain = action({
  args: { domainId: v.id("tenantDomains") },
  // The explicit return annotation breaks the circular inference that `internal`
  // creates when a module is part of the generated API graph.
  handler: async (
    ctx,
    args,
  ): Promise<{ status: "verified" | "failed"; host?: string; message?: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Unauthorized");

    const target: { domain: string; token: string } = await ctx.runQuery(
      internal.tenantSuite.getDomainForCheck,
      { domainId: args.domainId, userId },
    );

    const hosts = [`_cloudie-challenge.${target.domain}`, `_cloudie.${target.domain}`];
    const problems: string[] = [];

    for (const host of hosts) {
      try {
        const records = await dns.resolveTxt(host);
        const values = records.map((chunks) => chunks.join("").trim());
        if (values.some((value) => value.includes(target.token))) {
          await ctx.runMutation(internal.tenantSuite.applyDomainCheck, {
            domainId: args.domainId,
            verified: true,
          });
          return { status: "verified" as const, host };
        }
        problems.push(`${host} was found but does not contain the expected value.`);
      } catch (error) {
        const code = (error as { code?: string }).code;
        problems.push(
          code === "ENOTFOUND" || code === "ENODATA"
            ? `No TXT record at ${host}.`
            : `${host}: ${(error as Error).message}`,
        );
      }
    }

    const message = problems.join(" ");
    await ctx.runMutation(internal.tenantSuite.applyDomainCheck, {
      domainId: args.domainId,
      verified: false,
      error: message,
    });
    return { status: "failed" as const, message };
  },
});
