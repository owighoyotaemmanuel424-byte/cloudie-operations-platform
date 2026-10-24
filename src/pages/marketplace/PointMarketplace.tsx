import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageTransition, Reveal, StaggerGroup, StaggerItem } from "@/components/motion";
import { ArrowRight, BadgeCheck, Coins, Search, ShieldCheck, ShoppingCart, Store } from "lucide-react";
import { fmtNaira, naira as moneyNaira, points as moneyPoints } from "@/components/money/FundsGate";
import type { MarketplaceOrder } from "@/features/marketplace/orderState";
import { PurchaseDialog } from "@/features/marketplace/PurchaseDialog";

const SORTS = [
  { value: "recommended", label: "Recommended" },
  { value: "unit_asc", label: "Best unit price" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "points_desc", label: "Most points" },
];

export function naira(minor: number) {
  return fmtNaira(moneyNaira(minor));
}

type Package = FunctionReturnType<typeof api.pointMarket.listPackages>[number];

export default function PointMarketplace() {
  const [search, setSearch] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [minPoints, setMinPoints] = useState("");
  const [maxPoints, setMaxPoints] = useState("");
  const [verifiedOnly, setVerifiedOnly] = useState(true);
  const [sort, setSort] = useState("recommended");

  const parse = (value: string) => {
    const n = Number(value);
    return Number.isFinite(n) && value.trim() !== "" ? n : undefined;
  };

  const packages = useQuery(api.pointMarket.listPackages, {
    search: search.trim() || undefined,
    minPrice: parse(minPrice),
    maxPrice: parse(maxPrice),
    minPoints: parse(minPoints),
    maxPoints: parse(maxPoints),
    verifiedOnly,
    sort,
  });

  const [selected, setSelected] = useState<Package | null>(null);
  const activeFilters =
    [search, minPrice, maxPrice, minPoints, maxPoints].filter((v) => v.trim() !== "").length +
    (verifiedOnly ? 0 : 1);

  return (
    <PageTransition className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <Store className="h-3.5 w-3.5" /> Points exchange
          </div>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight sm:text-3xl">Marketplace</h1>
          <p className="mt-1 text-sm text-muted-foreground">Buy points from verified vendors.</p>
        </div>
        <Link to="/app/vendor">
          <Button variant="outline" size="sm" className="gap-1.5">
            <ShoppingCart className="h-3.5 w-3.5" /> Sell points
          </Button>
        </Link>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search packages or vendors"
                className="pl-9"
                aria-label="Search packages"
              />
            </div>
            <Select value={sort} onValueChange={setSort}>
              <SelectTrigger className="sm:w-52">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                {SORTS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="w-[calc(50%-0.375rem)] sm:w-28">
              <Label htmlFor="min-price" className="text-[11px] text-muted-foreground">
                Min price (₦)
              </Label>
              <Input
                id="min-price"
                inputMode="numeric"
                value={minPrice}
                onChange={(e) => setMinPrice(e.target.value.replace(/[^\d]/g, ""))}
                placeholder="0"
                className="font-mono"
              />
            </div>
            <div className="w-[calc(50%-0.375rem)] sm:w-28">
              <Label htmlFor="max-price" className="text-[11px] text-muted-foreground">
                Max price (₦)
              </Label>
              <Input
                id="max-price"
                inputMode="numeric"
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value.replace(/[^\d]/g, ""))}
                placeholder="Any"
                className="font-mono"
              />
            </div>
            <div className="w-[calc(50%-0.375rem)] sm:w-28">
              <Label htmlFor="min-points" className="text-[11px] text-muted-foreground">
                Min points
              </Label>
              <Input
                id="min-points"
                inputMode="numeric"
                value={minPoints}
                onChange={(e) => setMinPoints(e.target.value.replace(/[^\d]/g, ""))}
                placeholder="0"
                className="font-mono"
              />
            </div>
            <div className="w-[calc(50%-0.375rem)] sm:w-28">
              <Label htmlFor="max-points" className="text-[11px] text-muted-foreground">
                Max points
              </Label>
              <Input
                id="max-points"
                inputMode="numeric"
                value={maxPoints}
                onChange={(e) => setMaxPoints(e.target.value.replace(/[^\d]/g, ""))}
                placeholder="Any"
                className="font-mono"
              />
            </div>
            <label className="flex min-h-9 cursor-pointer items-center gap-2 text-xs font-medium">
              <Switch checked={verifiedOnly} onCheckedChange={setVerifiedOnly} aria-label="Verified vendors only" />
              Verified only
            </label>
            {activeFilters > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto text-[11px] text-muted-foreground"
                onClick={() => {
                  setSearch("");
                  setMinPrice("");
                  setMaxPrice("");
                  setMinPoints("");
                  setMaxPoints("");
                  setVerifiedOnly(true);
                }}
              >
                Clear {activeFilters} filter{activeFilters === 1 ? "" : "s"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {packages === undefined ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-44 w-full" />
          ))}
        </div>
      ) : packages.length === 0 ? (
        <Empty className="rounded-xl border border-dashed border-border bg-card">
          <EmptyMedia variant="icon">
            <Coins />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>No packages match</EmptyTitle>
            <EmptyDescription>
              Try widening the price or points range, or turn off the verified-only filter.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Link to="/app/vendor/apply">
              <Button variant="outline" className="gap-1.5">
                <Store className="h-4 w-4" /> Become a vendor
              </Button>
            </Link>
          </EmptyContent>
        </Empty>
      ) : (
        <StaggerGroup className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {packages.map((pkg) => (
            <StaggerItem key={pkg._id}>
              <Card className="flex h-full flex-col">
                <CardContent className="flex flex-1 flex-col p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 truncate text-xs font-medium text-muted-foreground">
                        <span className="truncate">{pkg.vendorName}</span>
                        {pkg.vendorVerified && (
                          <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-success" aria-label="Verified vendor" />
                        )}
                      </p>
                      <p className="mt-0.5 truncate text-sm font-semibold text-foreground">{pkg.name}</p>
                    </div>
                    <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {pkg.totalSold.toLocaleString()} sold
                    </span>
                  </div>

                  <div className="mt-4 flex items-baseline gap-1.5">
                    <span className="font-mono text-2xl font-semibold tracking-tight text-foreground">
                      {pkg.points.toLocaleString()}
                    </span>
                    <span className="text-xs text-muted-foreground">pts</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
                    <span className="font-mono text-sm font-medium text-foreground">{naira(pkg.priceMinor)}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {naira(pkg.unitPriceMinor)} per 1,000 pts
                    </span>
                  </div>

                  <Separator className="my-3" />
                  <Button className="mt-auto w-full gap-1.5" onClick={() => setSelected(pkg)}>
                    Buy <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </CardContent>
              </Card>
            </StaggerItem>
          ))}
        </StaggerGroup>
      )}

      <Reveal>
        <p className="flex items-start gap-2 rounded-xl border border-border bg-surface-2/60 px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Every purchase is held in escrow. Points only reach your balance after the vendor fulfils, and
          vendors are paid only when they do.
        </p>
      </Reveal>

      <CheckoutDialog pkg={selected} onClose={() => setSelected(null)} />
    </PageTransition>
  );
}

function CheckoutDialog({ pkg, onClose }: { pkg: Package | null; onClose: () => void }) {
  const createOrder = useMutation(api.pointMarket.createOrder);
  const walletBalance = useQuery(api.wallet.getBalance);
  const navigate = useNavigate();
  const [orderId, setOrderId] = useState<FunctionReturnType<typeof api.pointMarket.createOrder>["orderId"] | null>(null);
  const [orderState, setOrderState] = useState<MarketplaceOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const liveOrder = useQuery(api.pointMarket.getMyOrder, orderId ? { orderId } : "skip");

  const price = pkg ? moneyNaira(pkg.priceMinor) : moneyNaira(0);
  const balance = moneyNaira(Math.max(0, Math.round((walletBalance ?? 0) * 100)));
  const draft = pkg ? {
    productId: String(pkg._id),
    productName: pkg.name,
    vendorName: pkg.vendorName,
    quantity: 1,
    price,
    pointsReward: moneyPoints(pkg.points),
    walletBefore: balance,
    walletAfter: moneyNaira(Math.max(0, balance.kobo - price.kobo)),
  } : null;

  // Convex query is reactive: escrow stays pending until the vendor credits points.
  useEffect(() => {
    if (!orderId || !liveOrder || !draft) return;
    if (liveOrder.status === "credited") {
      setOrderState({ status: "success", reference: String(orderId), draft, pointsCredited: moneyPoints(liveOrder.points), walletAfter: balance });
    } else {
      setOrderState({ status: "pending", reference: String(orderId), draft });
    }
  }, [orderId, liveOrder, draft?.productId, draft?.price.kobo, draft?.pointsReward.amount, balance.kobo]);

  function close() {
    setOrderState(null);
    setOrderId(null);
    setBusy(false);
    onClose();
  }

  async function confirm() {
    if (!pkg || !draft || busy) return;
    setBusy(true);
    try {
      const result = await createOrder({ packageId: pkg._id });
      setOrderId(result.orderId);
      setOrderState({ status: "pending", reference: String(result.orderId), draft });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Purchase could not be completed.";
      setOrderState({
        status: "failed",
        reference: "not-created",
        draft,
        reason: /insufficient|wallet balance is too low/i.test(message)
          ? "Your wallet balance is too low for this package."
          : message,
        charged: false,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <PurchaseDialog
      open={Boolean(pkg)}
      order={orderState ?? (draft ? { status: "review", draft } : null)}
      onOpenChange={(open) => { if (!open && !busy) close(); }}
      onConfirm={() => void confirm()}
      busy={busy}
      onRetry={() => setOrderState(draft ? { status: "review", draft } : null)}
      onRefresh={() => {
        if (!orderId || !draft || !liveOrder) return;
        if (liveOrder.status === "credited") {
          setOrderState({ status: "success", reference: String(orderId), draft, pointsCredited: moneyPoints(liveOrder.points), walletAfter: balance });
        } else {
          setOrderState({ status: "pending", reference: String(orderId), draft });
        }
      }}
      onViewOrder={(reference) => navigate(`/app/marketplace/orders/${reference}`)}
      onContactSupport={() => navigate("/app/support")}
    />
  );
}