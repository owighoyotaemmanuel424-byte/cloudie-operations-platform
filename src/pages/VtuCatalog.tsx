import { Link } from "react-router";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  ArrowRight,
  Info,
  LayoutGrid,
  Lightbulb,
  Plus,
  Radio,
  Wifi,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Reveal } from "@/components/motion";
import {
  VtuBand,
  VtuNav,
  VtuSection,
  VtuServiceIcon,
  VtuShell,
} from "@/components/vtu/shared";
import { formatNgn } from "@/lib/pricing";
import { vtuServiceTypeLabel } from "@/lib/vtu";
import { cn } from "@/lib/utils";

/**
 * Catalog browse — everything on sale, grouped by service type.
 *
 * READ-ONLY. It prices nothing itself and decides nothing itself: every number
 * on this page is a scalar the server resolved (`fixedNgn`, `fixedPoints`) or a
 * bound the catalog declares (`indicativeMinNgn`). Provider identity never
 * reaches this component, so there is nothing here to leak and nothing here to
 * re-derive.
 *
 * A product whose shape the backend cannot yet purchase is still LISTED, and
 * says so plainly. Hiding it would deny a customer the information that the
 * service exists; showing it as buyable would advertise a purchase the server
 * will refuse.
 */

const QUICK_LINKS = [
  { to: "/vtu/airtime", label: "Airtime", icon: Radio },
  { to: "/vtu/data", label: "Data", icon: Wifi },
  { to: "/vtu/electricity", label: "Electricity", icon: Lightbulb },
  { to: "/vtu/bills", label: "All bills", icon: LayoutGrid },
] as const;

/** The order the groups are stacked in. Catalogue tables carry no order. */
const GROUP_ORDER = ["airtime", "data", "cable", "electricity", "exam", "betting"];

type CatalogProduct = {
  productCode: string;
  displayName: string;
  customerIdentifierLabel: string;
  requiresAmount: boolean;
  fixedPoints: number | null;
  fixedNgn: number | null;
  indicativeMinPoints: number | null;
  indicativeMaxPoints: number | null;
  indicativeMinNgn: number | null;
  indicativeMaxNgn: number | null;
  purchasable: boolean;
  airtimeNetwork: string | null;
};

/**
 * The price to show for a product, in the wallet's own currency.
 *
 * A fixed-price product has one number and shows it. An amount-priced product
 * (airtime, a meter top-up) does not, so it shows the range the catalog
 * declares. A routing override can price a fixed product in points without a
 * naira price on the row, which is why the points fallback exists — it is
 * converted at the rate the server returned, never at one invented here.
 */
function priceLabel(product: CatalogProduct, ngnPerPoint: number): string | null {
  if (product.fixedNgn !== null) return formatNgn(product.fixedNgn);
  if (product.indicativeMinNgn !== null && product.indicativeMaxNgn !== null) {
    return `${formatNgn(product.indicativeMinNgn)} – ${formatNgn(product.indicativeMaxNgn)}`;
  }
  if (product.fixedPoints !== null) {
    return formatNgn(product.fixedPoints * ngnPerPoint);
  }
  return null;
}

/** Where a customer goes to buy THIS product. Airtime has its own screen. */
function productLink(product: CatalogProduct): string {
  if (product.airtimeNetwork) {
    return `/vtu/airtime?network=${encodeURIComponent(product.airtimeNetwork)}`;
  }
  return `/vtu/bills?product=${encodeURIComponent(product.productCode)}`;
}

export default function VtuCatalog() {
  const balance = useQuery(api.wallet.getBalance);
  const catalog = useQuery(api.vtuCatalog.listCatalog, {});

  const ngnPerPoint = catalog?.ngnPerPoint ?? 1;
  const groups = [...(catalog?.groups ?? [])].sort(
    (a, b) => GROUP_ORDER.indexOf(a.serviceType) - GROUP_ORDER.indexOf(b.serviceType),
  );

  return (
    <VtuShell>
      <VtuNav />

      <VtuBand>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] opacity-70">
              Airtime, data &amp; bills
            </p>
            <p className="mt-1 font-display text-2xl font-bold tabular-nums">
              {formatNgn(balance ?? 0)}
            </p>
            <p className="mt-1 max-w-md text-xs text-vtu-band-fg/75">
              Paid from your naira wallet. A top-up that does not go through
              returns your money automatically.
            </p>
          </div>
          <Button
            asChild
            variant="vtu"
            className="border border-vtu-band-fg/25 bg-vtu-band-fg/10 hover:bg-vtu-band-fg/20"
          >
            <Link to="/buy-points">
              <Plus className="h-4 w-4" />
              Fund wallet
            </Link>
          </Button>
        </div>
      </VtuBand>

      <Reveal>
        <VtuSection title="Quick links" hint="Straight to the thing you came for.">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {QUICK_LINKS.map((link) => (
              <Link
                key={link.label}
                to={link.to}
                className="vtu-chip flex min-h-11 items-center gap-2.5 rounded-xl px-3 py-3"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-vtu-chip text-vtu-text">
                  <link.icon className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0 truncate text-sm font-medium">
                  {link.label}
                </span>
              </Link>
            ))}
          </div>
        </VtuSection>
      </Reveal>

      {catalog === undefined ? (
        <div className="space-y-2">
          <Skeleton className="h-6 w-32 rounded-lg" />
          <Skeleton className="h-40 w-full rounded-2xl" />
          <Skeleton className="h-40 w-full rounded-2xl" />
        </div>
      ) : groups.length === 0 ? (
        <Reveal>
          <div className="vtu-panel p-8 text-center">
            <p className="text-sm font-semibold">Nothing is on sale yet</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-vtu-muted">
              Airtime, data and bill products are added by our team. In the
              meantime you can still top up airtime below.
            </p>
            <Button asChild variant="vtu" className="mt-4">
              <Link to="/vtu/airtime">Buy airtime</Link>
            </Button>
          </div>
        </Reveal>
      ) : (
        groups.map((group, index) => (
          <Reveal key={group.serviceType} delay={Math.min(index, 3) * 0.04}>
            <VtuSection
              title={vtuServiceTypeLabel(group.serviceType)}
              hint={
                group.serviceType === "airtime"
                  ? "Pick a network, then the amount."
                  : `${group.products.length} plan${
                      group.products.length === 1 ? "" : "s"
                    } available.`
              }
              action={
                group.serviceType === "airtime" ? (
                  <Link
                    to="/vtu/airtime"
                    className="flex min-h-9 items-center gap-1 text-xs font-semibold text-vtu-accent hover:underline"
                  >
                    Open
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </Link>
                ) : null
              }
            >
              <div className="overflow-hidden rounded-2xl border border-vtu-line bg-vtu-card">
                {group.products.map((product, productIndex) => {
                  const price = priceLabel(product as CatalogProduct, ngnPerPoint);
                  const disabled = !product.purchasable;

                  return (
                    <Link
                      key={product.productCode}
                      to={disabled ? "/vtu" : productLink(product as CatalogProduct)}
                      aria-disabled={disabled}
                      onClick={(event) => {
                        if (disabled) event.preventDefault();
                      }}
                      className={cn(
                        "flex min-h-[68px] items-center gap-3 px-4 py-3 transition-colors",
                        productIndex > 0 && "border-t border-vtu-line",
                        disabled
                          ? "cursor-not-allowed opacity-60"
                          : "hover:bg-vtu-chip active:bg-vtu-chip",
                      )}
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-vtu-chip text-vtu-text">
                        <VtuServiceIcon
                          serviceType={group.serviceType}
                          className="h-5 w-5"
                        />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">
                          {product.displayName || product.productCode}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-vtu-muted">
                          {disabled
                            ? "Temporarily unavailable"
                            : product.requiresAmount
                              ? "You choose the amount"
                              : `Delivered to your ${product.customerIdentifierLabel.toLowerCase()}`}
                        </span>
                      </span>
                      {price ? (
                        <span className="shrink-0 text-xs font-semibold tabular-nums">
                          {price}
                        </span>
                      ) : null}
                      {!disabled && (
                        <ArrowRight
                          className="h-4 w-4 shrink-0 text-vtu-muted"
                          aria-hidden
                        />
                      )}
                    </Link>
                  );
                })}
              </div>
            </VtuSection>
          </Reveal>
        ))
      )}

      <Reveal>
        <p className="flex items-start gap-2 px-1 text-[11px] text-vtu-muted">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Prices on a plan are the whole price — nothing is added at checkout. A
          product whose provider is offline is shown, but cannot be bought until
          it is back.
        </p>
      </Reveal>
    </VtuShell>
  );
}
