// Manual verification against a live Convex deployment; intentionally not run in CI.
// Run: bun run verify:convex
// Use separate buyer/vendor accounts and a disposable test package in a non-production deployment.

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { ConvexHttpClient } from "convex/browser";
import type { Id } from "../src/convex/_generated/dataModel";
import { api } from "../src/convex/_generated/api";

const requiredEnv = [
  "CONVEX_URL",
  "BUYER_AUTH_TOKEN",
  "VENDOR_AUTH_TOKEN",
  "TEST_PACKAGE_ID",
] as const;

for (const name of requiredEnv) {
  if (!process.env[name]?.trim()) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
}

const url = process.env.CONVEX_URL!;
const buyerToken = process.env.BUYER_AUTH_TOKEN!;
const vendorToken = process.env.VENDOR_AUTH_TOKEN!;
const requestedPackageId = process.env.TEST_PACKAGE_ID!;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  const buyerClient = new ConvexHttpClient(url);
  buyerClient.setAuth(buyerToken);

  const vendorClient = new ConvexHttpClient(url);
  vendorClient.setAuth(vendorToken);

  // Resolve the environment value to the generated Id<"pointPackages"> type.
  const packages = await buyerClient.query(api.pointMarket.listPackages, {});
  const selectedPackage = packages.find((item) => item._id === requestedPackageId);
  if (!selectedPackage) {
    throw new Error("TEST_PACKAGE_ID must identify an active package visible to the buyer.");
  }
  const packageId: Id<"pointPackages"> = selectedPackage._id;

  console.log("1. Verify buyer authentication with a nonexistent order ID");
  // A package ID has a valid Convex ID shape but cannot identify a pointOrders row.
  const nonexistentOrderId = packageId as unknown as Id<"pointOrders">;
  const nonexistentOrder = await buyerClient.query(api.pointMarket.getMyOrder, {
    orderId: nonexistentOrderId,
  });
  if (nonexistentOrder !== null) {
    throw new Error("Expected getMyOrder to return null for a nonexistent order.");
  }
  // getMyOrder also returns null for an unauthenticated caller; successful query
  // execution plus currentUser below provides the explicit authentication check.
  const currentUser = await buyerClient.query(api.users.currentUser, {});
  if (!currentUser) {
    throw new Error("Buyer authentication failed: api.users.currentUser returned no user.");
  }
  console.log("   Buyer authenticated; nonexistent order returned null ✓");

  console.log("2. Buyer creates order → escrow");
  const { orderId } = await buyerClient.mutation(api.pointMarket.createOrder, { packageId });
  console.log("   orderId:", orderId);

  console.log("3. Buyer verifies escrow status");
  const escrowOrder = await buyerClient.query(api.pointMarket.getMyOrder, { orderId });
  if (!escrowOrder || escrowOrder.status !== "escrow") {
    throw new Error(`Expected order status "escrow"; received "${escrowOrder?.status ?? "no order"}".`);
  }
  console.log("   status:", escrowOrder.status, "✓");

  console.log("4. Approved vendor fulfills order");
  await vendorClient.mutation(api.pointMarket.fulfillOrder, { orderId });

  console.log("5. Buyer verifies credited status");
  const creditedOrder = await buyerClient.query(api.pointMarket.getMyOrder, { orderId });
  if (!creditedOrder || creditedOrder.status !== "credited") {
    throw new Error(`Expected order status "credited"; received "${creditedOrder?.status ?? "no order"}".`);
  }
  console.log("   status:", creditedOrder.status, "✓");

  console.log("6. Prepare insufficient-funds assertion");
  console.log("Lower the buyer test account's NGN wallet balance below the selected package price.");
  console.log("Use your approved development/admin workflow; do not adjust a production account.");
  const prompt = createInterface({ input, output });
  try {
    await prompt.question("Press Enter after confirming the buyer balance is below the package price... ");
  } finally {
    prompt.close();
  }

  console.log("7. Verify insufficient funds rejects the next order");
  let rejectedForInsufficientFunds = false;
  try {
    const unexpectedOrder = await buyerClient.mutation(api.pointMarket.createOrder, { packageId });
    throw new Error(`Expected insufficient-funds rejection, but createOrder succeeded with orderId ${unexpectedOrder.orderId}.`);
  } catch (error: unknown) {
    const message = errorMessage(error);
    if (message.startsWith("Expected insufficient-funds rejection")) {
      throw error;
    }
    if (!message.includes("Insufficient NGN wallet balance")) {
      throw new Error(`Expected error message containing "Insufficient NGN wallet balance"; received: ${message}`);
    }
    rejectedForInsufficientFunds = true;
    console.log("   Rejected with Insufficient NGN wallet balance ✓");
  }
  if (!rejectedForInsufficientFunds) {
    throw new Error("Insufficient-funds assertion did not pass.");
  }

  console.log("\nAll manual Convex verification assertions passed.");
}

main().catch((error: unknown) => {
  console.error("Convex verification FAILED:", errorMessage(error));
  process.exitCode = 1;
});
