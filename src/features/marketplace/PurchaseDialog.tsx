import { AlertCircle, CheckCircle2, Clock3, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FundsGate, fmtNaira, fmtPoints } from "@/components/money/FundsGate";
import type { MarketplaceOrder } from "./orderState";

type Props = {
  open: boolean;
  order: MarketplaceOrder | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  busy?: boolean;
  onRetry?: () => void;
  onRefresh?: () => void;
  onViewOrder?: (reference: string) => void;
  onContactSupport?: (reference: string) => void;
};

export function PurchaseDialog({ open, order, onOpenChange, onConfirm, busy = false, onRetry, onRefresh, onViewOrder, onContactSupport }: Props) {
  const draft = order?.draft ?? null;
  const review = order?.status === "review";
  const pending = order?.status === "pending";
  const success = order?.status === "success";
  const failed = order?.status === "failed";
  const ambiguous = order?.status === "failed_ambiguous";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="max-h-[90dvh] overflow-y-auto border shadow-none sm:max-w-lg">
        <DialogHeader className="pr-7 text-left">
          <DialogTitle>{success ? "Purchase complete" : failed ? "Purchase failed" : ambiguous ? "Confirming your order" : pending ? "Order in escrow" : "Review your purchase"}</DialogTitle>
          <DialogDescription>
            {success ? "The vendor has fulfilled your order and the points have been credited." : pending ? "Your NGN payment is held in escrow. Points arrive when the vendor fulfils the order." : failed ? "The order could not be created." : ambiguous ? "The order outcome needs further confirmation." : "Review the package and NGN wallet impact before confirming."}
          </DialogDescription>
        </DialogHeader>

        {draft && (
          <section aria-label="Purchase summary" className="space-y-3 rounded-xl border p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="break-words font-semibold">{draft.productName}</p>
                <p className="text-sm text-muted-foreground">Vendor: {draft.vendorName}</p>
                <p className="text-sm text-muted-foreground">Quantity: {draft.quantity}</p>
              </div>
              <span className="shrink-0 font-semibold">{fmtNaira(draft.price)}</span>
            </div>
            <div className="flex items-center justify-between gap-3 border-t pt-3 text-sm">
              <span className="text-muted-foreground">Wallet after purchase</span><span className="font-medium">{fmtNaira(draft.walletAfter)}</span>
            </div>
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">Points reward</span><span className="font-semibold text-success">+{fmtPoints(draft.pointsReward)}</span>
            </div>
          </section>
        )}

        {review && draft && (
          <FundsGate balance={draft.walletBefore} cost={draft.price} fallback={<p role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">Insufficient NGN wallet balance. You can still review the package, but you cannot confirm this purchase.</p>}>
            <div className="rounded-lg border p-3 text-sm text-muted-foreground">
              NGN leaves your wallet and is held in escrow. The vendor must fulfil the order before points are credited.
            </div>
          </FundsGate>
        )}

        {pending && order && <div role="status" className="flex gap-3 rounded-lg border p-3 text-sm"><Clock3 className="mt-0.5 size-4 shrink-0" /><div><p className="font-medium">Funds in escrow</p><p className="break-all text-muted-foreground">Order reference: <span className="font-mono">{order.reference}</span></p><p className="mt-1 text-muted-foreground">This dialog can be closed safely. Track the order from your orders page.</p></div></div>}
        {success && order && <div role="status" className="space-y-3 rounded-lg border p-4">
          <div className="flex items-center gap-2 font-semibold"><CheckCircle2 className="size-5 text-success" /> Receipt</div>
          <p className="text-sm">Order reference: <span className="break-all font-medium">{order.reference}</span></p>
          <p className="text-sm">Paid: <span className="font-semibold">{fmtNaira(order.draft.price)}</span></p>
          <p className="text-sm">Wallet balance: <span className="font-semibold">{fmtNaira(order.walletAfter)}</span></p>
          <p className="text-sm">Points credited: <span className="font-semibold text-success">+{fmtPoints(order.pointsCredited)}</span></p>
        </div>}
        {failed && order && <div role="alert" className="space-y-2 rounded-lg border border-destructive/40 p-4 text-sm">
          <div className="flex items-center gap-2 font-semibold"><AlertCircle className="size-4" /> Purchase failed</div>
          <p>{order.reason}</p><p className="font-semibold">You were not charged.</p><p className="break-all text-muted-foreground">Reference: {order.reference}</p>
        </div>}
        {ambiguous && order && <div role="alert" className="space-y-2 rounded-lg border border-warning/40 p-4 text-sm">
          <div className="flex items-center gap-2 font-semibold"><AlertCircle className="size-4" /> Order outcome not fully confirmed</div>
          <p>Your payment was received, but points delivery is delayed. Ref {order.reference}. This will resolve automatically, or contact support.</p><p className="text-muted-foreground">{order.reason}</p>
        </div>}

        <DialogFooter className="gap-2 sm:gap-2">
          {review && <><Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button><Button onClick={onConfirm} disabled={busy || !draft || draft.walletBefore.kobo < draft.price.kobo}>{busy ? "Creating order…" : "Confirm purchase"}</Button></>}
          {pending && order && <><Button variant="outline" onClick={() => onOpenChange(false)}>Close safely</Button><Button variant="outline" onClick={onRefresh}>Refresh</Button><Button onClick={() => onViewOrder?.(order.reference)}>View order <ExternalLink className="size-4" /></Button></>}
          {success && order && <><Button variant="outline" onClick={() => onViewOrder?.(order.reference)}>View order</Button><Button onClick={() => onOpenChange(false)}>Done</Button></>}
          {failed && order && <><Button variant="outline" onClick={() => onContactSupport?.(order.reference)}>Contact support ({order.reference})</Button><Button onClick={onRetry}>Try again</Button></>}
          {ambiguous && order && <><Button variant="outline" onClick={() => onContactSupport?.(order.reference)}>Contact support ({order.reference})</Button><Button onClick={() => onOpenChange(false)}>Close</Button></>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default PurchaseDialog;
