import type { Naira, Points } from "@/components/money/FundsGate";

/**
 * Marketplace order lifecycle states used by the purchase UI.
 * API fields are intentionally not inferred here; this is a UI state model.
 */
export type MarketplaceOrderDraft = {
  productId: string;
  productName: string;
  vendorName: string;
  quantity: number;
  price: Naira;
  pointsReward: Points;
  walletBefore: Naira;
  walletAfter: Naira;
};

export type MarketplaceOrder =
  | { status: "review"; draft: MarketplaceOrderDraft }
  | { status: "pending"; reference: string; draft: MarketplaceOrderDraft }
  | {
      status: "success";
      reference: string;
      draft: MarketplaceOrderDraft;
      pointsCredited: Points;
      walletAfter: Naira;
    }
  | {
      status: "failed";
      reference: string;
      draft: MarketplaceOrderDraft;
      reason: string;
      charged: false;
    }
  | {
      status: "failed_ambiguous";
      reference: string;
      draft: MarketplaceOrderDraft;
      reason: string;
    };

export const assertNever = (x: never): never => {
  throw new Error(`Unhandled order state: ${JSON.stringify(x)}`);
};
