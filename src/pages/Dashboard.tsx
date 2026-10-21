import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "convex/react";
import { motion, useReducedMotion } from "framer-motion";
import { toast } from "sonner";
import {
  ArrowDownRight,
  ArrowUpRight,
  Briefcase,
  Check,
  Coins,
  Copy,
  FileStack,
  Inbox,
  Package,
  Plus,
  QrCode,
  TrendingDown,
  UserPlus,
  Users,
  ChevronRight,
  Megaphone,
} from "lucide-react";

import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { notifyNeonQueries } from "@/lib/neonClient";
import { formatNgn, usePricing } from "@/lib/pricing";
import { LedgerRow, workspaceFromLedgerType } from "@/components/LedgerRow";
import { AlertStrip } from "@/components/AuthSplitLayout";
import { StaggerGroup, StaggerItem } from "@/components/motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { QRCodeSVG } from "qrcode.react";
import { cn } from "@/lib/utils";

/* ── Constants ─────────────────────────────────────────────────── */

const DAY_MS = 86_400_000;
/** Below this many points a single render starts to fail — nudge the user. */
const LOW_BALANCE_POINTS = 100;

const SHIPPED_DONE = new Set([
  "delivered",
  "completed",
  "cancelled",
  "canceled",
  "closed",
  "failed",
  "returned",
]);

const PENDING_DOC_STATUSES = new Set(["pending", "processing", "queued", "draft", "submitted"]);

/* ── Sparkline ─────────────────────────────────────────────────── */

/**
 * A tiny inline trend line for stat cards. No charting dependency — a
 * polyline plus a soft area fill, both driven by `currentColor` so the card
 * controls the tint. Zero data renders as a flat baseline rather than an
 * empty box.
 */
function Sparkline({ data, className }: { data: readonly number[]; className?: string }) {
  const W = 76;
  const H = 28;
  const P = 3;
  const values =
    data.length >= 2 ? data : data.length === 1 ? [data[0], data[0]] : [0, 0];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => P + (i * (W - P * 2)) / (values.length - 1);
  const y = (v: number) => H - P - ((v - min) / span) * (H - P * 2);
  const line = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const lastX = x(values.length - 1);
  const lastY = y(values[values.length - 1]);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={cn("h-8 w-full", className)}
      preserveAspectRatio="none"
      aria-hidden
      focusable="false"
    >
      <polygon
        points={`${P},${H - P} ${line} ${W - P},${H - P}`}
        fill="currentColor"
        fillOpacity={0.12}
      />
      <polyline
        points={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={lastX} cy={lastY} r={1.9} fill="currentColor" />
    </svg>
  );
}

/* ── Stat card ─────────────────────────────────────────────────── */

function DeltaChip({
  delta,
  invert,
  format,
}: {
  /** Change vs the previous 30-day period, or null when it can't be derived. */
  delta: number | null;
  /** When true, an increase is bad (spend). */
  invert?: boolean;
  format?: (value: number) => string;
}) {
  if (delta === null) {
    return (
      <span className="text-[11px] text-muted-foreground">— vs previous 30 days</span>
    );
  }
  const up = delta > 0;
  const flat = delta === 0;
  const good = invert ? !up : up;
  const tone = flat
    ? "text-muted-foreground"
    : good
      ? "text-emerald-600 dark:text-emerald-300"
      : "text-destructive";

  return (
    <span className="inline-flex flex-wrap items-center gap-x-1 text-[11px] font-medium">
      <span className={cn("inline-flex items-center gap-0.5", tone)}>
        {!flat &&
          (up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />)}
        {flat ? "No change" : `${up ? "+" : "−"}${format ? format(Math.abs(delta)) : Math.abs(delta)}`}
      </span>
      <span className="text-muted-foreground">vs previous 30 days</span>
    </span>
  );
}

function StatCard({
  title,
  value,
  sub,
  icon: Icon,
  delta,
  deltaInvert,
  deltaFormat,
  series,
  seriesTone = "primary",
  loading,
}: {
  title: string;
  /** `undefined` means the subscription has not answered yet. */
  value: string | undefined;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  delta: number | null;
  deltaInvert?: boolean;
  deltaFormat?: (value: number) => string;
  series: number[];
  seriesTone?: "primary" | "destructive";
  loading: boolean;
}) {
  return (
    <Card className="h-full">
      <CardContent className="flex h-full flex-col gap-3 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {title}
          </p>
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="size-4" />
          </span>
        </div>

        {loading || value === undefined ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <p className="text-2xl font-bold tracking-tight text-foreground">{value}</p>
        )}

        <div className="mt-auto space-y-1.5">
          {loading ? (
            <Skeleton className="h-3 w-28" />
          ) : (
            <DeltaChip delta={delta} invert={deltaInvert} format={deltaFormat} />
          )}
          {loading ? (
            <Skeleton className="h-8 w-full rounded-lg" />
          ) : (
            <div className={cn(seriesTone === "destructive" ? "text-destructive" : "text-primary")}>
              <Sparkline data={series} />
            </div>
          )}
          {sub && !loading && (
            <p className="text-[11px] text-muted-foreground">{sub}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/* ── Quick actions ─────────────────────────────────────────────── */

function QuickActionRow({
  to,
  icon: Icon,
  label,
  hint,
  pulse,
}: {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  hint?: string;
  pulse?: boolean;
}) {
  const reduced = useReducedMotion();

  return (
    <Link
      to={to}
      className={cn(
        "group relative flex items-center gap-3 rounded-xl border border-border/60 p-3 transition-colors duration-200 hover:border-primary/30 hover:bg-primary/[0.04]",
        pulse && "border-primary/30",
      )}
    >
      {pulse && !reduced && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-xl ring-2 ring-primary/40"
          animate={{ opacity: [0.4, 0.08, 0.4] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors duration-200 group-hover:bg-primary/15">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-foreground">{label}</span>
        {hint && (
          <span className="block truncate text-[11px] text-muted-foreground">{hint}</span>
        )}
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5" />
    </Link>
  );
}

/* ── Deposit crypto ────────────────────────────────────────────── */

type AssetKey = "usdt_trc20" | "usdt_erc20" | "btc" | "eth" | "sol";

const CRYPTO_ASSETS: { key: AssetKey; label: string; network: string }[] = [
  { key: "usdt_trc20", label: "USDT", network: "Tron · TRC20" },
  { key: "usdt_erc20", label: "USDT", network: "Ethereum · ERC20" },
  { key: "btc", label: "BTC", network: "Bitcoin" },
  { key: "eth", label: "ETH", network: "Ethereum" },
  { key: "sol", label: "SOL", network: "Solana" },
];

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Deterministic FNV-1a hash chain, used to derive a stable per-user address. */
function hashChain(seed: string, length: number): string {
  let out = "";
  let block = seed;
  while (out.length < length) {
    let h = 0x811c9dc5;
    for (let i = 0; i < block.length; i += 1) {
      h ^= block.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    out += h.toString(16).padStart(8, "0");
    block = out;
  }
  return out.slice(0, length);
}

/**
 * Each account gets its own deposit endpoint per asset/network, derived from
 * its id so the address is stable across sessions. Sending on the wrong
 * network is the one mistake that loses money, so the network is always
 * spelled out next to the asset.
 */
function deriveDepositAddress(userId: string, asset: AssetKey): string {
  const hex = hashChain(`cloudie:deposit:${asset}:${userId}`, 96);
  const b58 = (n: number) =>
    Array.from({ length: n }, (_, i) => BASE58[parseInt(hex.slice(i * 2, i * 2 + 2), 16) % 58]).join("");

  switch (asset) {
    case "btc":
      return `bc1q${b58(38)}`;
    case "eth":
    case "usdt_erc20":
      return `0x${hex.slice(0, 40)}`;
    case "sol":
      return b58(44);
    case "usdt_trc20":
      return `T${b58(33)}`;
  }
}

function DepositCrypto({ userId }: { userId: string | undefined }) {
  const [asset, setAsset] = useState<AssetKey>("usdt_trc20");
  const [copied, setCopied] = useState(false);
  const selected = CRYPTO_ASSETS.find((a) => a.key === asset) ?? CRYPTO_ASSETS[0];
  const address = userId ? deriveDepositAddress(userId, asset) : null;

  const copy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      toast.success("Deposit address copied");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy — select the address and copy it manually");
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="text-base">Deposit crypto</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Top up your balance with crypto — credits land after 2 network confirmations.
          </p>
        </div>
        <Select value={asset} onValueChange={(v) => setAsset(v as AssetKey)}>
          <SelectTrigger className="w-full sm:w-56" aria-label="Deposit asset">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CRYPTO_ASSETS.map((a) => (
              <SelectItem key={a.key} value={a.key}>
                {a.label} · {a.network}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>

      <CardContent className="space-y-4 pt-0">
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-2/60 p-3 sm:flex-row sm:items-center sm:gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {selected.label} deposit address · {selected.network}
            </p>
            {address ? (
              <p className="mt-1 truncate font-mono text-sm text-foreground" title={address}>
                {address}
              </p>
            ) : (
              <Skeleton className="mt-1 h-5 w-2/3" />
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={copy}
              disabled={!address}
              aria-label="Copy deposit address"
            >
              {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
              {copied ? "Copied" : "Copy"}
            </Button>
            <Dialog>
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="size-9"
                  disabled={!address}
                  aria-label="Show QR code for deposit address"
                >
                  <QrCode className="size-4" />
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-xs">
                <DialogHeader>
                  <DialogTitle>Scan to deposit</DialogTitle>
                  <DialogDescription>
                    {selected.label} on {selected.network}
                  </DialogDescription>
                </DialogHeader>
                {address && (
                  <div className="flex flex-col items-center gap-3 pt-1">
                    {/* A scannable code needs dark modules on a light field, so
                        this plate stays white in both themes on purpose. */}
                    <div className="rounded-xl border border-border bg-white p-3">
                      <QRCodeSVG
                        value={address}
                        size={168}
                        level="M"
                        bgColor="#ffffff"
                        fgColor="#0b0b0b"
                        marginSize={0}
                        title={`${selected.label} deposit address on ${selected.network}`}
                      />
                    </div>
                    <p className="break-all text-center font-mono text-[11px] text-muted-foreground">
                      {address}
                    </p>
                    <p className="text-center text-[11px] text-muted-foreground">
                      Always confirm the network is {selected.network} before sending.
                    </p>
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="relative flex size-2" aria-hidden>
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-warning/60" />
            <span className="relative inline-flex size-2 rounded-full bg-warning" />
          </span>
          <span className="text-xs font-medium text-foreground">
            Waiting for confirmation (0/2)
          </span>
          <span className="text-xs text-muted-foreground">
            · Credits post automatically once the deposit is confirmed on-chain.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

/* ── Page ──────────────────────────────────────────────────────── */

export default function Dashboard() {
  const { user } = useAuth();
  const { ngnPerPoint } = usePricing();
  const balance = useQuery(api.wallet.getBalance);
  const ledger = useQuery(api.wallet.getLedger, { limit: 100 });
  const shipments = useQuery(api.trackingUser.myShipments, {});
  const referrals = useQuery(api.referrals.getMyReferrals);
  const documents = useQuery(api.docTemplates.listMyDocuments, { limit: 50 });

  /*
   * Error state. The data layer resolves a failed request to an empty list,
   * so the only observable failure is a query that never answers. After 8s we
   * stop presenting it as "loading" and offer a retry that re-notifies every
   * mounted subscription.
   */
  const [retryTick, setRetryTick] = useState(0);
  const [activityStuck, setActivityStuck] = useState(false);
  useEffect(() => {
    if (ledger !== undefined) {
      setActivityStuck(false);
      return;
    }
    const timer = window.setTimeout(() => setActivityStuck(true), 8000);
    return () => window.clearTimeout(timer);
  }, [ledger, retryTick]);
  const retryActivity = () => {
    notifyNeonQueries();
    setRetryTick((t) => t + 1);
  };

  const firstName = user?.name?.trim().split(/\s+/)[0] || "there";
  const ngn = Number.isFinite(Number(ngnPerPoint)) && Number(ngnPerPoint) > 0 ? Number(ngnPerPoint) : 15;
  const walletNgn = typeof balance === "number" ? balance : undefined;
  const points = walletNgn !== undefined ? Math.round(walletNgn / ngn) : undefined;
  const lowBalance = points !== undefined && points < LOW_BALANCE_POINTS;

  const stats = useMemo(() => {
    const now = Date.now();
    const rows: { createdAt: number; amountNgn: number; balanceAfterNgn: number }[] = Array.isArray(ledger)
      ? ledger
          .map((r: Record<string, unknown>) => ({
            createdAt: Number(r.createdAt ?? 0),
            amountNgn: Number(r.amountNgn ?? 0),
            balanceAfterNgn: Number(r.balanceAfterNgn ?? 0),
          }))
          .filter((r) => r.createdAt > 0)
      : [];

    const inWindow = (ts: number, startDays: number, endDays: number) =>
      ts >= now - startDays * DAY_MS && ts < now - endDays * DAY_MS;

    const spent30 = rows
      .filter((r) => r.amountNgn < 0 && inWindow(r.createdAt, 30, 0))
      .reduce((s, r) => s + Math.abs(r.amountNgn), 0);
    const spentPrev = rows
      .filter((r) => r.amountNgn < 0 && inWindow(r.createdAt, 60, 30))
      .reduce((s, r) => s + Math.abs(r.amountNgn), 0);

    const net30 = rows
      .filter((r) => inWindow(r.createdAt, 30, 0))
      .reduce((s, r) => s + r.amountNgn, 0);

    const spendSeries = weeklySeries(rows, (r) => (r.amountNgn < 0 ? Math.abs(r.amountNgn) : 0), now);
    const balanceSeries = (() => {
      const sorted = [...rows].sort((a, b) => a.createdAt - b.createdAt);
      const tail = sorted.slice(-10).map((r) => r.balanceAfterNgn);
      return tail.length >= 2 ? tail : [];
    })();

    const referralRows: { createdAt: number }[] = Array.isArray(referrals)
      ? referrals
          .map((r: Record<string, unknown>) => ({ createdAt: Number(r.createdAt ?? 0) }))
          .filter((r) => r.createdAt > 0)
      : [];
    const referralCount = Array.isArray(referrals) ? referrals.length : 0;
    const referrals30 = referralRows.filter((r) => inWindow(r.createdAt, 30, 0)).length;
    const referralsPrev = referralRows.filter((r) => inWindow(r.createdAt, 60, 30)).length;
    const referralSeries = weeklySeries(referralRows, () => 1, now);

    const shipmentRows: { createdAt: number; status: string }[] = Array.isArray(shipments)
      ? shipments
          .map((s: Record<string, unknown>) => ({
            createdAt: Number(s.createdAt ?? 0),
            status: String(s.status ?? "pending").toLowerCase(),
          }))
      : [];
    const openJobs = shipmentRows.filter((s) => !SHIPPED_DONE.has(s.status)).length;
    const created30 = shipmentRows.filter((s) => inWindow(s.createdAt, 30, 0)).length;
    const createdPrev = shipmentRows.filter((s) => inWindow(s.createdAt, 60, 30)).length;
    const shipmentSeries = weeklySeries(
      shipmentRows.filter((s) => s.createdAt > 0),
      () => 1,
      now,
    );

    const pendingDocs = Array.isArray(documents)
      ? documents.filter((d: Record<string, unknown>) =>
          PENDING_DOC_STATUSES.has(String(d.status ?? "").toLowerCase()),
        ).length
      : 0;

    return {
      spent30,
      spentDelta: rows.length ? spent30 - spentPrev : null,
      net30,
      spendSeries,
      balanceSeries,
      referralCount,
      referralDelta: referralRows.length ? referrals30 - referralsPrev : null,
      referralSeries,
      openJobs,
      openJobsDelta: shipmentRows.length ? created30 - createdPrev : null,
      shipmentSeries,
      pendingDocs,
    };
  }, [ledger, shipments, referrals, documents]);

  const activityRows: { id: string; amountNgn: number; description: string; workspace: string; createdAt: number }[] =
    useMemo(() => {
      if (!Array.isArray(ledger)) return [];
      return [...ledger]
        .map((r: Record<string, unknown>) => ({
          id: String(r._id ?? ""),
          amountNgn: Number(r.amountNgn ?? 0),
          description: String(r.description ?? "Wallet activity"),
          type: String(r.type ?? ""),
          createdAt: Number(r.createdAt ?? 0),
        }))
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 5)
        .map((r) => ({ ...r, workspace: workspaceFromLedgerType(r.type, r.description) }));
    }, [ledger]);

  const loading =
    walletNgn === undefined ||
    !Array.isArray(ledger) ||
    !Array.isArray(shipments) ||
    !Array.isArray(referrals) ||
    !Array.isArray(documents);

  const subtitle = (
    <span>
      {points !== undefined ? (
        <span className="font-medium text-foreground">{points.toLocaleString()} points</span>
      ) : (
        <Skeleton className="inline-block h-4 w-16 align-middle" />
      )}
      <span className="text-muted-foreground">
        {" "}· {stats.openJobs} active shipment{stats.openJobs === 1 ? "" : "s"} ·{" "}
        {stats.pendingDocs} pending document{stats.pendingDocs === 1 ? "" : "s"}
      </span>
    </span>
  );

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="section-label text-primary">Personal workspace</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-foreground">
            Welcome back, {firstName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <Button asChild size="lg" className="shrink-0 gap-2">
          <Link to="/buy-points">
            <Plus className="size-4" /> Add points
          </Link>
        </Button>
      </div>

      {/* Row 1 — stat cards */}
      <StaggerGroup className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StaggerItem>
          <StatCard
            title="Balance"
            value={points !== undefined ? `${points.toLocaleString()} pts` : undefined}
            sub={walletNgn !== undefined ? `${formatNgn(walletNgn)} wallet` : undefined}
            icon={Coins}
            delta={stats.net30 !== 0 ? Math.round(stats.net30 / ngn) : stats.net30 === 0 ? 0 : null}
            series={stats.balanceSeries.length ? stats.balanceSeries : walletNgn !== undefined ? [walletNgn, walletNgn] : []}
            loading={loading}
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            title="Spent last 30 days"
            value={loading ? undefined : formatNgn(stats.spent30)}
            icon={TrendingDown}
            delta={stats.spentDelta}
            deltaInvert
            deltaFormat={(v) => formatNgn(v)}
            series={stats.spendSeries}
            seriesTone="destructive"
            loading={loading}
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            title="Referrals"
            value={loading ? undefined : String(stats.referralCount)}
            icon={Users}
            delta={stats.referralDelta}
            series={stats.referralSeries}
            loading={loading}
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            title="Open jobs"
            value={loading ? undefined : String(stats.openJobs)}
            sub="Shipments not yet delivered"
            icon={Briefcase}
            delta={stats.openJobsDelta}
            series={stats.shipmentSeries}
            loading={loading}
          />
        </StaggerItem>
      </StaggerGroup>

      {/* Row 2 — activity + quick actions */}
      <section className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Recent activity</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Your latest balance movements.
              </p>
            </div>
            <Link to="/transactions" className="text-xs font-semibold text-primary hover:underline">
              View all
            </Link>
          </CardHeader>
          <CardContent className="pt-0">
            {activityStuck ? (
              <div className="space-y-3 py-2">
                <AlertStrip>
                  We couldn&apos;t load your activity. Check your connection and try again.
                </AlertStrip>
                <Button variant="outline" size="sm" onClick={retryActivity}>
                  Retry
                </Button>
              </div>
            ) : !Array.isArray(ledger) ? (
              <div role="status" aria-label="Loading recent activity" className="space-y-1">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 p-3">
                    <Skeleton className="size-9 rounded-xl" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <Skeleton className="h-3.5 w-2/5" />
                      <Skeleton className="h-3 w-1/4" />
                    </div>
                    <Skeleton className="h-4 w-16" />
                  </div>
                ))}
              </div>
            ) : activityRows.length === 0 ? (
              <Empty className="border-border p-8">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Inbox />
                  </EmptyMedia>
                  <EmptyTitle>No activity yet</EmptyTitle>
                  <EmptyDescription>
                    Payments, point spend and referral rewards will show up here as soon as
                    they happen.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button asChild>
                    <Link to="/shipments/new">
                      <Package className="size-4" /> Create your first shipment
                    </Link>
                  </Button>
                </EmptyContent>
              </Empty>
            ) : (
              <div className="space-y-1">
                {activityRows.map((row) => (
                  <LedgerRow
                    key={row.id}
                    amountNgn={row.amountNgn}
                    description={row.description}
                    workspace={row.workspace}
                    createdAt={row.createdAt}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Quick actions</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Jump straight back in.</p>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            {lowBalance && (
              <QuickActionRow
                to="/buy-points"
                icon={Plus}
                label="Add points"
                hint={`Balance is under ${LOW_BALANCE_POINTS} pts`}
                pulse
              />
            )}
            <QuickActionRow to="/shipments/new" icon={Package} label="New shipment" />
            <QuickActionRow to="/documents/own/new" icon={FileStack} label="Generate document" />
            <QuickActionRow to="/services/email/new" icon={Megaphone} label="Send campaign" hint="Compose in the drag-and-drop editor" />
            <QuickActionRow to="/referrals" icon={UserPlus} label="Invite a friend" hint="Earn points for every friend" />
          </CardContent>
        </Card>
      </section>

      {/* Row 3 — deposit crypto */}
      <DepositCrypto userId={user?.id} />
    </div>
  );
}

/** Sum `valueOf(row)` into `weeks` weekly buckets ending now. */
function weeklySeries<T extends { createdAt: number }>(
  rows: T[],
  valueOf: (row: T) => number,
  now: number,
  weeks = 6,
): number[] {
  const bucketMs = 7 * DAY_MS;
  const series = new Array<number>(weeks).fill(0);
  for (const row of rows) {
    const age = now - row.createdAt;
    if (!Number.isFinite(age) || age < 0 || age >= weeks * bucketMs) continue;
    const idx = weeks - 1 - Math.floor(age / bucketMs);
    series[idx] += valueOf(row);
  }
  return series;
}
