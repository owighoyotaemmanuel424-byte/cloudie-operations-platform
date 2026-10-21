import { useState } from "react";
import { Link, useParams } from "react-router";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/components/admin/shared";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  Check,
  Circle,
  Clock,
  Gavel,
  Lock,
  PackageCheck,
  Wallet,
} from "lucide-react";

const ID_LIKE = /^[A-Za-z0-9_-]{8,64}$/;

const money = (minor: number) =>
  `₦${(minor / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

const when = (ts: number | null) =>
  ts ? new Date(ts).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : null;

type Order = NonNullable<FunctionReturnType<typeof api.pointMarket.getMyOrder>>;

export default function PointOrderDetail() {
  const { orderId = "" } = useParams();
  const valid = ID_LIKE.test(orderId);
  const order = useQuery(
    api.pointMarket.getMyOrder,
    valid ? { orderId: orderId as Id<"pointOrders"> } : "skip",
  );

  if (!valid || order === null) {
    return (
      <div className="mx-auto max-w-md space-y-3 py-16 text-center">
        <Gavel className="mx-auto h-8 w-8 text-muted-foreground" />
        <h1 className="text-lg font-semibold text-foreground">Order not available</h1>
        <p className="text-sm text-muted-foreground">
          This order doesn't exist, or it belongs to another account.
        </p>
        <Link to="/app/marketplace">
          <Button variant="outline">Back to marketplace</Button>
        </Link>
      </div>
    );
  }

  if (order === undefined) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  return <OrderBody order={order} />;
}

function OrderBody({ order }: { order: Order }) {
  const fulfill = useMutation(api.pointMarket.fulfillOrder);
  const dispute = useMutation(api.pointMarket.raiseDispute);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const buyer = order.buyerName || order.buyerEmail || "Buyer";
  const steps = [
    {
      key: "placed",
      title: "Order placed",
      actor: buyer,
      at: order.createdAt,
      icon: Circle,
    },
    {
      key: "paid",
      title: "Payment received",
      actor: "Wallet debit",
      at: order.paidAt,
      icon: Wallet,
    },
    {
      key: "escrow",
      title: "Escrow held",
      actor: "Cloudie escrow",
      at: order.escrowAt,
      icon: Lock,
    },
    {
      key: "fulfilled",
      title: "Vendor fulfills",
      actor: order.vendorName,
      at: order.fulfilledAt,
      icon: PackageCheck,
    },
    {
      key: "credited",
      title: "Points credited",
      actor: "Cloudie ledger",
      at: order.creditedAt,
      icon: BadgeCheck,
    },
  ];

  const currentNode =
    order.status === "disputed"
      ? "escrow"
      : order.status === "credited"
        ? "credited"
        : order.status === "fulfilled"
          ? "fulfilled"
          : order.status === "escrow"
            ? "escrow"
            : order.status === "paid"
              ? "paid"
              : order.status === "cancelled" || order.status === "refunded"
                ? "placed"
                : "placed";

  const canDispute =
    order.viewer === "buyer" &&
    (order.status === "escrow" || (order.overdue && order.status === "escrow"));
  const canFulfill = order.viewer === "vendor" && order.status === "escrow";

  async function submitDispute() {
    if (reason.trim().length < 10) {
      toast.error("Describe the problem in at least 10 characters.");
      return;
    }
    setBusy(true);
    try {
      await dispute({ orderId: order._id, reason: reason.trim() });
      toast.success("Dispute raised — escrow is frozen while it's reviewed");
      setDisputeOpen(false);
      setReason("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not raise the dispute");
    } finally {
      setBusy(false);
    }
  }

  async function releaseEscrow() {
    setBusy(true);
    try {
      await fulfill({ orderId: order._id });
      toast.success("Order fulfilled — buyer credited");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not fulfil the order");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Link
        to={order.viewer === "vendor" ? "/app/vendor" : "/app/marketplace"}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {order.viewer === "vendor" ? "Vendor dashboard" : "Marketplace"}
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
            Order {order._id.slice(-10).toUpperCase()}
          </p>
          <h1 className="mt-1 font-display text-xl font-semibold tracking-tight sm:text-2xl">
            {order.points.toLocaleString()} points
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={order.status} />
          {order.overdue && order.status === "escrow" && (
            <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning">
              fulfilment overdue
            </span>
          )}
        </div>
      </div>

      {order.status === "disputed" && (
        <div className="flex items-start gap-3 rounded-xl border border-error/35 bg-error/10 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-error" />
          <div className="text-sm">
            <p className="font-medium text-foreground">Escrow frozen — dispute under review</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{order.disputeReason}</p>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
        {/* Timeline */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Order timeline</CardTitle>
          </CardHeader>
          <CardContent className="pt-1">
            <ol>
              {steps.map((step, index) => {
                const done = Boolean(step.at);
                const current = step.key === currentNode && !step.at;
                const last = index === steps.length - 1;
                return (
                  <li key={step.key} className="relative flex gap-3 pb-5 last:pb-0">
                    {!last && (
                      <span
                        className="absolute left-[11px] top-6 h-[calc(100%-12px)] w-px"
                        style={{ background: done ? "var(--success)" : "var(--border)" }}
                      />
                    )}
                    <span
                      className={`relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                        done
                          ? "border-success/40 bg-success/12 text-success"
                          : current
                            ? "border-warning/40 bg-warning/10 text-warning"
                            : "border-border bg-surface-2 text-muted-foreground"
                      }`}
                    >
                      {done ? <Check className="h-3.5 w-3.5" /> : <step.icon className="h-3 w-3" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <p className={`text-sm ${done ? "font-medium text-foreground" : "text-muted-foreground"}`}>
                          {step.title}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {when(step.at) ?? (current ? "in progress" : "pending")}
                        </p>
                      </div>
                      <p className="text-[11px] text-muted-foreground">{step.actor}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
            {order.status === "disputed" && (
              <p className="mt-3 flex items-center gap-1.5 rounded-lg border border-border bg-surface-2/60 px-3 py-2 text-[11px] text-muted-foreground">
                <Clock className="h-3.5 w-3.5" /> Dispute opened {when(order.disputedAt)} — an admin will
                release or refund the escrow.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Summary */}
        <div className="space-y-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Order summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 pt-0 text-xs">
              {[
                ["Points", `${order.points.toLocaleString()} pts`],
                ["Price", money(order.priceMinor)],
                ["Vendor", order.vendorName],
                ["Buyer", buyer],
                ["Placed", when(order.createdAt) ?? "—"],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-3 border-b border-border/60 pb-2 last:border-0 last:pb-0">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="truncate font-mono text-foreground">{value}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          {(canDispute || canFulfill) && (
            <Card>
              <CardContent className="space-y-2 p-4">
                {canFulfill && (
                  <Button className="w-full gap-1.5" onClick={() => void releaseEscrow()} disabled={busy}>
                    <PackageCheck className="h-4 w-4" /> Release escrow & fulfil
                  </Button>
                )}
                {canDispute && (
                  <>
                    <Button
                      variant="outline"
                      className="w-full gap-1.5 text-error hover:text-error"
                      onClick={() => setDisputeOpen(true)}
                    >
                      <Gavel className="h-4 w-4" /> Raise dispute
                    </Button>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      Available until the vendor fulfils. Overdue orders can always be disputed.
                    </p>
                  </>
                )}
                <Separator />
                <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
                  <Lock className="mt-0.5 h-3 w-3 shrink-0" />
                  Escrow protects both sides: funds move only when fulfilment is confirmed.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Dialog open={disputeOpen} onOpenChange={(open) => !busy && setDisputeOpen(open)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Gavel className="h-4 w-4 text-error" /> Raise a dispute
            </DialogTitle>
            <DialogDescription>
              The escrow is frozen and an administrator reviews the order. This can't be undone from your
              side.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="dispute-reason">What went wrong?</Label>
            <Textarea
              id="dispute-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              className="min-h-24"
              placeholder="e.g. Paid 4 hours ago and the vendor has not delivered the points"
            />
            <p className="text-[11px] text-muted-foreground">{reason.trim().length}/10 characters minimum</p>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="ghost" onClick={() => setDisputeOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy || reason.trim().length < 10}
              onClick={() => void submitDispute()}
            >
              {busy ? "Raising…" : "Raise dispute"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
