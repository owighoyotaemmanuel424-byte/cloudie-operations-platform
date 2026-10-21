import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { StatusBadge } from "@/components/admin/shared";
import { Reveal } from "@/components/motion";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  BadgeCheck,
  Building2,
  CalendarClock,
  Copy,
  CreditCard,
  Globe,
  Image as ImageIcon,
  Landmark,
  Loader2,
  Lock,
  RefreshCw,
  ShieldCheck,
  Trash2,
  TrendingUp,
  Upload,
  UserMinus,
  UserPlus,
  Users,
  Wallet,
  X,
} from "lucide-react";

const DAY = 86_400_000;

const FONTS = [
  "Inter",
  "DM Sans",
  "Sora",
  "Manrope",
  "Space Grotesk",
  "IBM Plex Sans",
  "Source Serif 4",
  "Fraunces",
];

function timeAgo(ts: number) {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

function fmtDate(ts: number | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Relative days until a timestamp, signed. */
function daysUntil(ts: number | null) {
  if (!ts) return null;
  return Math.ceil((ts - Date.now()) / DAY);
}

const HEX6 = /^#[0-9a-fA-F]{6}$/;

/** Pick black or white text for a brand colour by perceived luminance. */
function readableOn(hex: string) {
  let value = hex.replace("#", "");
  // Expand shorthand (#abc) so a half-typed value still previews sensibly.
  if (value.length === 3) value = value.split("").map((c) => c + c).join("");
  if (value.length !== 6) return "#ffffff";
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#111827" : "#ffffff";
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  } catch {
    toast.error("Clipboard is blocked in this browser");
  }
}

type Overview = NonNullable<FunctionReturnType<typeof api.tenantSuite.getOverview>>;
type Site = Overview["site"];

/**
 * Guard the `:siteId` URL segment before handing it to Convex. It must look like
 * a row id (Convex ids are lowercase alphanumerics; the preview data layer uses
 * UUIDs), so a garbage URL shows the friendly empty state instead of a throw.
 */
const ID_LIKE = /^[A-Za-z0-9_-]{8,64}$/;

export default function BusinessSiteDetail() {
  const { siteId } = useParams();
  const validId = Boolean(siteId && ID_LIKE.test(siteId));
  const tenantId = siteId as Id<"tenantSites">;
  const overview = useQuery(
    api.tenantSuite.getOverview,
    validId ? { tenantId } : "skip",
  );
  const reactivate = useMutation(api.tenantSuite.reactivateSite);
  const lockdown = useMutation(api.tenantSuite.lockdownSite);
  const [lockingDown, setLockingDown] = useState(false);
  const [lockReason, setLockReason] = useState("");
  const [lockOpen, setLockOpen] = useState(false);

  if (!validId || overview === null) {
    return (
      <div className="mx-auto max-w-md space-y-4 py-12 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-surface-2">
          <Building2 className="h-5 w-5 text-muted-foreground" />
        </div>
        <div>
          <h1 className="font-display text-lg font-semibold text-foreground">Site not available</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            This tenant site does not exist, or your account does not have access to it.
          </p>
        </div>
        <Link to="/app/business">
          <Button variant="outline">Back to Business Suite</Button>
        </Link>
      </div>
    );
  }

  if (overview === undefined) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-10 w-full max-w-2xl" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const { site, stats, activity } = overview;
  const TypeIcon = site.siteType === "investment" ? TrendingUp : Landmark;

  async function confirmLockdown() {
    if (lockReason.trim().length < 8) {
      toast.error("Give a reason of at least 8 characters.");
      return;
    }
    setLockingDown(true);
    try {
      await lockdown({ tenantId: site._id, reason: lockReason });
      toast.success("Site locked down. Customer access is blocked.");
      setLockOpen(false);
      setLockReason("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not lock down this site.");
    } finally {
      setLockingDown(false);
    }
  }

  return (
    <div className="space-y-5">
      <Link
        to="/app/business"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Business Suite
      </Link>

      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-2">
            <TypeIcon className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate font-display text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                {site.siteName}
              </h1>
              <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {site.siteType}
              </span>
              <StatusBadge status={site.status} />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="font-mono">
                {site.subdomain}.cloudie.app
              </span>
              <span className="hidden sm:inline">·</span>
              <span>Renews {fmtDate(site.renewalDate)}</span>
              <span className="hidden sm:inline">·</span>
              <span>{site.monthlyPoints} pts / month</span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={`/site/${site._id}/banking`} target="_blank">
            <Button variant="outline" size="sm" className="gap-1.5">
              <Globe className="h-3.5 w-3.5" /> Portal
            </Button>
          </Link>
          <Link to={`/site/${site._id}/admin`} target="_blank">
            <Button variant="outline" size="sm" className="gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" /> Tenant admin
            </Button>
          </Link>
          {site.status === "active" ? (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-error hover:text-error"
              onClick={() => setLockOpen(true)}
            >
              <Lock className="h-3.5 w-3.5" /> Lockdown
            </Button>
          ) : (
            <Button
              size="sm"
              className="gap-1.5"
              onClick={async () => {
                try {
                  await reactivate({ tenantId: site._id, reason: "Reactivated from site detail" });
                  toast.success("Site reactivated");
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Could not reactivate");
                }
              }}
            >
              <RefreshCw className="h-3.5 w-3.5" /> Reactivate
            </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="overview" className="gap-4">
        <div className="-mx-1 overflow-x-auto pb-1">
          <TabsList className="h-auto w-max min-w-full justify-start gap-1 bg-muted/60 p-1">
            {[
              ["overview", "Overview"],
              ["users", "End users"],
              ["ledger", "Ledger"],
              ["kyc", "KYC"],
              ["theme", "Theme"],
              ["domains", "Domains"],
              ["billing", "Billing"],
              ["danger", "Danger zone"],
            ].map(([value, label]) => (
              <TabsTrigger
                key={value}
                value={value}
                className={`min-h-9 flex-none px-3 text-[13px] ${
                  value === "danger"
                    ? "data-[state=active]:bg-error/10 data-[state=active]:text-error"
                    : ""
                }`}
              >
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {/* ── Overview ─────────────────────────────────────────────── */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              icon={Users}
              label="End users"
              value={String(stats.users)}
              hint={`${stats.activeUsers} active`}
            />
            <StatCard
              icon={Wallet}
              label="Ledger volume"
              value={formatMoney(stats.ledgerVolume, site.currency)}
              hint={`${stats.ledgerCount} entries`}
              mono
            />
            <StatCard
              icon={BadgeCheck}
              label="KYC approved"
              value={`${stats.kycApprovedPct}%`}
              hint={`${stats.kycPending} awaiting review`}
            />
            <StatCard
              icon={CalendarClock}
              label="Days to renewal"
              value={daysUntil(site.renewalDate) === null ? "—" : String(daysUntil(site.renewalDate))}
              hint={site.renewalDate ? fmtDate(site.renewalDate) : "No renewal scheduled"}
              warn={daysUntil(site.renewalDate) !== null && (daysUntil(site.renewalDate) as number) <= 7}
            />
          </div>

          <Card>
            <CardHeader className="flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-semibold">Recent activity</CardTitle>
              <span className="text-[11px] text-muted-foreground">Last 8 events</span>
            </CardHeader>
            <CardContent className="pt-0">
              {activity.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No ledger or KYC activity on this site yet.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {activity.map((item) => (
                    <li key={item.id} className="flex items-start gap-3 py-3">
                      <span
                        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${
                          item.kind === "kyc"
                            ? "border-info/30 bg-info/10 text-info"
                            : "border-border bg-surface-2 text-muted-foreground"
                        }`}
                      >
                        {item.kind === "kyc" ? (
                          <BadgeCheck className="h-3.5 w-3.5" />
                        ) : (
                          <ArrowDownLeft className="h-3.5 w-3.5" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
                        <p className="truncate text-[11px] text-muted-foreground">{item.detail}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        {typeof item.amount === "number" && (
                          <p
                            className={`font-mono text-xs ${item.amount < 0 ? "text-error" : "text-success"}`}
                          >
                            {item.amount > 0 ? "+" : ""}
                            {formatMoney(item.amount, site.currency)}
                          </p>
                        )}
                        <p className="text-[11px] text-muted-foreground">{timeAgo(item.at)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── End users ────────────────────────────────────────────── */}
        <TabsContent value="users">
          <EndUsersTab tenantId={tenantId} currency={site.currency} />
        </TabsContent>

        {/* ── Ledger ───────────────────────────────────────────────── */}
        <TabsContent value="ledger">
          <LedgerTab tenantId={tenantId} currency={site.currency} />
        </TabsContent>

        {/* ── KYC ──────────────────────────────────────────────────── */}
        <TabsContent value="kyc">
          <KycTab tenantId={tenantId} />
        </TabsContent>

        {/* ── Theme ────────────────────────────────────────────────── */}
        <TabsContent value="theme">
          <ThemeTab key={site._id} site={site} />
        </TabsContent>

        {/* ── Domains ──────────────────────────────────────────────── */}
        <TabsContent value="domains">
          <DomainsTab tenantId={tenantId} subdomain={site.subdomain} />
        </TabsContent>

        {/* ── Billing ──────────────────────────────────────────────── */}
        <TabsContent value="billing">
          <BillingTab site={site} />
        </TabsContent>

        {/* ── Danger zone ──────────────────────────────────────────── */}
        <TabsContent value="danger">
          <DangerTab site={site} />
        </TabsContent>
      </Tabs>

      {/* Header-level lockdown dialog */}
      <Dialog open={lockOpen} onOpenChange={(open) => !lockingDown && setLockOpen(open)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="h-4 w-4 text-error" /> Lock down {site.siteName}
            </DialogTitle>
            <DialogDescription>
              Customer sign-in, transfers and the public portal stop immediately. Ledger, KYC and
              branding are preserved.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="detail-lock-reason">Reason (audit log)</Label>
            <Textarea
              id="detail-lock-reason"
              value={lockReason}
              onChange={(e) => setLockReason(e.target.value)}
              maxLength={400}
              className="min-h-20"
              placeholder="e.g. Regulatory review requested by compliance"
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="ghost" onClick={() => setLockOpen(false)} disabled={lockingDown}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={lockingDown || lockReason.trim().length < 8}
              onClick={() => void confirmLockdown()}
            >
              {lockingDown ? "Locking down…" : "Lock down site"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ─────────────────────────── Overview pieces ─────────────────────────── */

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  mono,
  warn,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint?: string;
  mono?: boolean;
  warn?: boolean;
}) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </span>
          <Icon className={`h-4 w-4 ${warn ? "text-warning" : "text-muted-foreground"}`} />
        </div>
        <div
          className={`mt-2 truncate text-xl font-semibold ${mono ? "font-mono" : ""} ${
            warn ? "text-warning" : "text-foreground"
          }`}
        >
          {value}
        </div>
        {hint && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

/* ─────────────────────────── End users ─────────────────────────── */

type EndUser = FunctionReturnType<typeof api.tenantSuite.listEndUsers>[number];

function EndUsersTab({ tenantId, currency }: { tenantId: Id<"tenantSites">; currency: string }) {
  const users = useQuery(api.tenantSuite.listEndUsers, { tenantId });
  const setStatus = useMutation(api.tenantSuite.setUserStatus);
  const [viewing, setViewing] = useState<EndUser | null>(null);
  const [target, setTarget] = useState<EndUser | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function apply(suspend: boolean) {
    if (!target) return;
    setBusy(true);
    try {
      await setStatus({
        tenantId,
        userId: target.userId,
        suspended: suspend,
        reason: reason.trim() || undefined,
      });
      toast.success(suspend ? `${target.name} suspended` : `${target.name} reinstated`);
      setTarget(null);
      setReason("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update this customer");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 pb-2">
        <CardTitle className="text-sm font-semibold">End users</CardTitle>
        <span className="text-[11px] text-muted-foreground">
          {users ? `${users.length} customer${users.length === 1 ? "" : "s"}` : "Loading…"}
        </span>
      </CardHeader>
      <CardContent className="pt-0">
        {users === undefined ? (
          <div className="space-y-2 py-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : users.length === 0 ? (
          <Empty className="border-0">
            <EmptyMedia variant="icon">
              <Users />
            </EmptyMedia>
            <EmptyHeader>
              <EmptyTitle>No customers yet</EmptyTitle>
              <EmptyDescription>
                Customers appear here as soon as they sign up on {`your portal`} or receive a
                ledger entry.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-1">Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>KYC</TableHead>
                  <TableHead className="text-right">Ledger balance</TableHead>
                  <TableHead className="w-24 pr-1 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.userId}>
                    <TableCell className="py-2.5 pl-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground">
                          {user.name}
                        </span>
                        {user.status === "suspended" && (
                          <span className="rounded border border-error/30 bg-error/10 px-1 py-0.5 text-[10px] font-medium text-error">
                            suspended
                          </span>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-40 truncate text-xs text-muted-foreground">
                      {user.email}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={user.kycStatus} />
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-foreground">
                      {formatMoney(user.balance, currency)}
                    </TableCell>
                    <TableCell className="pr-1 text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-[11px]"
                          onClick={() => setViewing(user)}
                        >
                          View
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className={`h-7 px-2 text-[11px] ${
                            user.status === "suspended" ? "text-success" : "text-error"
                          }`}
                          onClick={() => {
                            setReason("");
                            setTarget(user);
                          }}
                        >
                          {user.status === "suspended" ? "Reinstate" : "Suspend"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {/* Customer detail */}
      <Dialog open={Boolean(viewing)} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{viewing?.name}</DialogTitle>
            <DialogDescription>{viewing?.email}</DialogDescription>
          </DialogHeader>
          {viewing && (
            <dl className="divide-y divide-border text-sm">
              {[
                ["Role", viewing.role],
                ["Account status", viewing.status],
                ["KYC status", viewing.kycStatus.replace(/_/g, " ")],
                ["Ledger balance", formatMoney(viewing.balance, currency)],
                ["Joined", fmtDate(viewing.joinedAt)],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between py-2">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="font-mono text-xs capitalize text-foreground">{value}</dd>
                </div>
              ))}
            </dl>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewing(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Suspend / reinstate */}
      <Dialog open={Boolean(target)} onOpenChange={(open) => !busy && !open && setTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {target?.status === "suspended" ? (
                <>
                  <UserPlus className="h-4 w-4 text-success" /> Reinstate {target?.name}
                </>
              ) : (
                <>
                  <UserMinus className="h-4 w-4 text-error" /> Suspend {target?.name}
                </>
              )}
            </DialogTitle>
            <DialogDescription>
              {target?.status === "suspended"
                ? "The customer regains access to their portal and accounts."
                : "Sign-in and new transfers are blocked. Balances and statements are kept intact."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="user-reason">Reason (optional)</Label>
            <Input
              id="user-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={200}
              placeholder="e.g. Chargeback investigation"
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="ghost" onClick={() => setTarget(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant={target?.status === "suspended" ? "default" : "destructive"}
              disabled={busy}
              onClick={() => void apply(target?.status !== "suspended")}
            >
              {busy ? "Saving…" : target?.status === "suspended" ? "Reinstate customer" : "Suspend customer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/* ─────────────────────────── Ledger ─────────────────────────── */

function LedgerTab({ tenantId, currency }: { tenantId: Id<"tenantSites">; currency: string }) {
  const entries = useQuery(api.tenantSuite.listLedger, { tenantId });
  const total = useMemo(
    () => (entries ?? []).reduce((sum, entry) => sum + Math.abs(entry.amount), 0),
    [entries],
  );

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 pb-2">
        <CardTitle className="text-sm font-semibold">Tenant ledger</CardTitle>
        <span className="font-mono text-[11px] text-muted-foreground">
          {entries ? `${entries.length} entries · ${formatMoney(total, currency)} moved` : "Loading…"}
        </span>
      </CardHeader>
      <CardContent className="pt-0">
        {entries === undefined ? (
          <div className="space-y-2 py-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <Empty className="border-0">
            <EmptyMedia variant="icon">
              <Wallet />
            </EmptyMedia>
            <EmptyHeader>
              <EmptyTitle>No ledger entries</EmptyTitle>
              <EmptyDescription>
                Deposits, withdrawals and transfers made on this tenant will be listed here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-1">Date</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="pr-1 text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry._id}>
                    <TableCell className="whitespace-nowrap pl-1 font-mono text-[11px] text-muted-foreground">
                      {new Date(entry.createdAt).toLocaleDateString(undefined, {
                        day: "2-digit",
                        month: "short",
                      })}
                    </TableCell>
                    <TableCell className="max-w-40 truncate text-xs text-foreground">
                      {entry.customer}
                    </TableCell>
                    <TableCell className="max-w-64 truncate text-xs text-muted-foreground">
                      {entry.description}
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                        {entry.type.replace(/_/g, " ")}
                      </span>
                    </TableCell>
                    <TableCell
                      className={`pr-1 text-right font-mono text-xs ${
                        entry.amount < 0 ? "text-error" : "text-success"
                      }`}
                    >
                      {entry.amount > 0 ? "+" : ""}
                      {formatMoney(entry.amount, currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ─────────────────────────── KYC ─────────────────────────── */

function KycTab({ tenantId }: { tenantId: Id<"tenantSites"> }) {
  const records = useQuery(api.tenantSuite.listKyc, { tenantId });
  const pending = (records ?? []).filter((r) =>
    ["submitted", "under_review"].includes(r.status),
  ).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <span className="rounded-full border border-warning/30 bg-warning/10 px-2.5 py-1 text-[11px] font-medium text-warning">
          {pending} awaiting review
        </span>
        <span className="rounded-full border border-border bg-surface-2 px-2.5 py-1 text-[11px] text-muted-foreground">
          {records?.length ?? 0} records
        </span>
      </div>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Identity submissions</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {records === undefined ? (
            <div className="space-y-2 py-4">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : records.length === 0 ? (
            <Empty className="border-0">
              <EmptyMedia variant="icon">
                <ShieldCheck />
              </EmptyMedia>
              <EmptyHeader>
                <EmptyTitle>No KYC submissions</EmptyTitle>
                <EmptyDescription>
                  Identity documents uploaded through the tenant portal land here for review.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className="divide-y divide-border">
              {records.map((record) => (
                <li key={record._id} className="flex items-start gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        {record.fullName}
                      </span>
                      <StatusBadge status={record.status} />
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {record.documentName ?? "No document attached"} · submitted{" "}
                      {fmtDate(record.submittedAt)}
                      {record.reviewedAt ? ` · reviewed ${fmtDate(record.reviewedAt)}` : ""}
                    </p>
                    {record.rejectionReason && (
                      <p className="mt-1 rounded border border-error/25 bg-error/5 px-2 py-1 text-[11px] text-error">
                        {record.rejectionReason}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ─────────────────────────── Theme ─────────────────────────── */

function ThemeTab({ site }: { site: Site }) {
  const save = useMutation(api.tenantSuite.updateTheme);
  const [primary, setPrimary] = useState(site.branding.primaryColor ?? "#0f4c3a");
  const [accent, setAccent] = useState(site.branding.accentColor ?? "#c8a24a");
  const [surface, setSurface] = useState(site.branding.surfaceColor ?? "#f7f5ef");
  const [font, setFont] = useState(site.fontFamily || "Inter");
  const [logo, setLogo] = useState<string | null>(site.branding.logo ?? null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const dirty =
    primary !== (site.branding.primaryColor ?? "#0f4c3a") ||
    accent !== (site.branding.accentColor ?? "#c8a24a") ||
    surface !== (site.branding.surfaceColor ?? "#f7f5ef") ||
    font !== (site.fontFamily || "Inter") ||
    logo !== (site.branding.logo ?? null);

  function pickLogo(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Choose a PNG, SVG or JPG image.");
      return;
    }
    if (file.size > 400_000) {
      toast.error("Logo must be under 400 KB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setLogo(String(reader.result));
    reader.onerror = () => toast.error("Could not read that file.");
    reader.readAsDataURL(file);
  }

  async function submit() {
    setBusy(true);
    try {
      await save({
        tenantId: site._id,
        primaryColor: primary,
        accentColor: accent,
        surfaceColor: surface,
        fontFamily: font,
        logo: logo ?? "",
      });
      toast.success("Theme saved — customer pages update on next load.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the theme.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Brand kit</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5 pt-0">
          {/* Logo */}
          <div className="space-y-2">
            <Label>Logo</Label>
            <div className="flex items-center gap-3">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-border bg-surface-2">
                {logo ? (
                  <img src={logo} alt="Tenant logo" className="h-full w-full object-contain p-1" />
                ) : (
                  <ImageIcon className="h-5 w-5 text-muted-foreground" />
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  className="hidden"
                  onChange={(e) => pickLogo(e.target.files?.[0])}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload className="h-3.5 w-3.5" /> Upload
                </Button>
                {logo && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-muted-foreground"
                    onClick={() => setLogo(null)}
                  >
                    <X className="h-3.5 w-3.5" /> Remove
                  </Button>
                )}
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Square PNG or SVG, under 400 KB. Shown in the portal header and statements.
            </p>
          </div>

          <Separator />

          <ColorField label="Primary" value={primary} onChange={setPrimary} />
          <ColorField label="Accent" value={accent} onChange={setAccent} />
          <ColorField label="Background" value={surface} onChange={setSurface} />

          <div className="space-y-1.5">
            <Label htmlFor="font">Display font</Label>
            <Select value={font} onValueChange={setFont}>
              <SelectTrigger id="font">
                <SelectValue placeholder="Choose a font" />
              </SelectTrigger>
              <SelectContent>
                {FONTS.map((option) => (
                  <SelectItem key={option} value={option}>
                    <span style={{ fontFamily: `"${option}", sans-serif` }}>{option}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Button onClick={() => void submit()} disabled={busy || !dirty}>
              {busy ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Saving
                </>
              ) : (
                "Save theme"
              )}
            </Button>
            <Button
              variant="ghost"
              disabled={!dirty || busy}
              onClick={() => {
                setPrimary(site.branding.primaryColor ?? "#0f4c3a");
                setAccent(site.branding.accentColor ?? "#c8a24a");
                setSurface(site.branding.surfaceColor ?? "#f7f5ef");
                setFont(site.fontFamily || "Inter");
                setLogo(site.branding.logo ?? null);
              }}
            >
              Reset
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Live mock */}
      <Card className="overflow-hidden">
        <CardHeader className="flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-semibold">Live preview</CardTitle>
          <span className="text-[11px] text-muted-foreground">Mock customer page</span>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="rounded-xl border border-border bg-muted/40 p-3">
            <div
              className="overflow-hidden rounded-lg border border-black/5 shadow-sm"
              style={{ background: surface, fontFamily: `"${font}", sans-serif` }}
            >
              <div className="h-1.5 w-full" style={{ background: accent }} />
              <div className="flex items-center justify-between px-3 py-2.5">
                <div className="flex items-center gap-1.5">
                  {logo ? (
                    <img src={logo} alt="" className="h-5 w-5 rounded object-contain" />
                  ) : (
                    <span
                      className="flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold"
                      style={{ background: primary, color: readableOn(primary) }}
                    >
                      {site.siteName.slice(0, 1)}
                    </span>
                  )}
                  <span className="text-[11px] font-semibold" style={{ color: primary }}>
                    {site.siteName}
                  </span>
                </div>
                <div className="flex gap-1">
                  {["Accounts", "Pay", "Support"].map((item) => (
                    <span
                      key={item}
                      className="rounded px-1.5 py-0.5 text-[9px]"
                      style={{ color: primary, opacity: 0.7 }}
                    >
                      {item}
                    </span>
                  ))}
                </div>
              </div>
              <div className="px-4 pb-4 pt-3">
                <span
                  className="inline-block rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
                  style={{ background: `${accent}22`, color: primary }}
                >
                  {site.branding.tagline}
                </span>
                <h3
                  className="mt-2 text-base font-semibold leading-snug"
                  style={{ color: primary }}
                >
                  {site.branding.heroHeadline}
                </h3>
                <p className="mt-1 text-[10px] leading-relaxed" style={{ color: primary, opacity: 0.65 }}>
                  Open an account in minutes, move money instantly, and see every naira accounted
                  for.
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <span
                    className="rounded px-2.5 py-1 text-[10px] font-semibold"
                    style={{ background: primary, color: readableOn(primary) }}
                  >
                    Open an account
                  </span>
                  <span
                    className="rounded border px-2.5 py-1 text-[10px] font-semibold"
                    style={{ borderColor: `${primary}44`, color: primary }}
                  >
                    Sign in
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-1.5">
                  {["Savings", "Loans", "Groups"].map((item) => (
                    <div
                      key={item}
                      className="rounded border px-1.5 py-2"
                      style={{ borderColor: `${primary}22`, background: `${primary}0a` }}
                    >
                      <div
                        className="h-1.5 w-6 rounded-full"
                        style={{ background: accent }}
                      />
                      <p className="mt-1 text-[9px] font-medium" style={{ color: primary }}>
                        {item}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            Contrast is checked as you type — button labels flip between dark and light ink so the
            brand colour never hides a label.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`color-${label}`}>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          id={`color-${label}`}
          type="color"
          value={HEX6.test(value) ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} colour`}
          className="h-9 w-11 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-1"
        />
        <Input
          value={value}
          onChange={(e) => {
            const next = e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`;
            onChange(next.slice(0, 7));
          }}
          maxLength={7}
          className="font-mono text-xs uppercase"
          aria-label={`${label} hex value`}
        />
      </div>
    </div>
  );
}

/* ─────────────────────────── Domains ─────────────────────────── */

type Domain = FunctionReturnType<typeof api.tenantSuite.listDomains>[number];

function DomainsTab({
  tenantId,
  subdomain,
}: {
  tenantId: Id<"tenantSites">;
  subdomain: string;
}) {
  const domains = useQuery(api.tenantSuite.listDomains, { tenantId });
  const addDomain = useMutation(api.tenantSuite.addDomain);
  const removeDomain = useMutation(api.tenantSuite.removeDomain);
  const verify = useAction(api.tenantDomainVerify.verifyDomain);

  const [value, setValue] = useState("");
  const [adding, setAdding] = useState(false);
  const [checking, setChecking] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<Domain | null>(null);

  // Background polling: while any domain is unverified, re-check DNS on a slow
  // timer (max 4 attempts) so the badge flips without a manual click.
  const pendingKey = (domains ?? [])
    .filter((d) => d.status !== "verified")
    .map((d) => d._id)
    .join("|");
  const domainsRef = useRef<Domain[]>([]);
  domainsRef.current = domains ?? [];

  useEffect(() => {
    if (!pendingKey) return;
    let attempts = 0;
    let cancelled = false;
    const tick = async () => {
      if (cancelled || attempts >= 4) return;
      attempts += 1;
      for (const domain of domainsRef.current) {
        if (domain.status === "verified") continue;
        try {
          await verify({ domainId: domain._id });
        } catch {
          // Errors surface on the row itself; polling should stay quiet.
        }
      }
    };
    const timer = window.setInterval(tick, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pendingKey, verify]);

  async function submitDomain() {
    const raw = value.trim();
    if (!raw) return;
    setAdding(true);
    try {
      await addDomain({ tenantId, domain: raw });
      toast.success("Domain added — publish the TXT record to verify it.");
      setValue("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add that domain");
    } finally {
      setAdding(false);
    }
  }

  async function check(domainId: Id<"tenantDomains">) {
    setChecking(domainId);
    try {
      const result = await verify({ domainId });
      if (result.status === "verified") toast.success("Domain verified");
      else toast.error(result.message ?? "DNS record not found yet");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Verification failed");
    } finally {
      setChecking(null);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Addresses</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5 pt-0">
          <div className="space-y-1.5">
            <Label htmlFor="subdomain">Subdomain (read-only)</Label>
            <div className="flex items-center gap-2">
              <div className="flex min-w-0 flex-1 items-center rounded-md border border-input bg-muted/50">
                <span className="truncate px-3 py-2 font-mono text-xs text-foreground">
                  {subdomain}
                </span>
                <span className="shrink-0 border-l border-input px-2 py-2 font-mono text-[11px] text-muted-foreground">
                  .cloudie.app
                </span>
              </div>
              <Button
                variant="outline"
                size="icon"
                aria-label="Copy subdomain"
                onClick={() => void copyText(`${subdomain}.cloudie.app`)}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Subdomains are fixed after creation to keep customer links and certificates stable.
            </p>
          </div>

          <Separator />

          <div className="space-y-1.5">
            <Label htmlFor="custom-domain">Add a custom domain</Label>
            <div className="flex gap-2">
              <Input
                id="custom-domain"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="portal.yourbank.com"
                className="font-mono text-xs"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submitDomain();
                }}
              />
              <Button onClick={() => void submitDomain()} disabled={adding || !value.trim()}>
                {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Use a subdomain you control, e.g. <span className="font-mono">bank.acme.co</span>.
            </p>
          </div>

          <div className="space-y-2">
            {domains === undefined ? (
              <Skeleton className="h-16 w-full" />
            ) : domains.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                No custom domains yet.
              </p>
            ) : (
              domains.map((domain) => (
                <div key={domain._id} className="rounded-lg border border-border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-xs font-medium text-foreground">
                        {domain.domain}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {domain.status === "verified"
                          ? `Verified ${fmtDate(domain.verifiedAt)}`
                          : domain.lastCheckedAt
                            ? `Checked ${timeAgo(domain.lastCheckedAt)} · ${domain.attempts} attempt${
                                domain.attempts === 1 ? "" : "s"
                              }`
                            : "Not checked yet"}
                      </p>
                    </div>
                    <StatusBadge status={domain.status} />
                  </div>

                  {domain.status !== "verified" && (
                    <pre className="mt-2 overflow-x-auto rounded-md border border-border bg-muted/50 p-2.5 font-mono text-[10px] leading-relaxed text-foreground">
{`Type   TXT
Name   _cloudie-challenge.${domain.domain}
Value  ${domain.verificationToken}
TTL    300`}
                    </pre>
                  )}
                  {domain.lastError && domain.status !== "verified" && (
                    <p className="mt-1.5 text-[11px] text-warning">{domain.lastError}</p>
                  )}

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1 px-2 text-[11px]"
                      onClick={() =>
                        void copyText(
                          `_cloudie-challenge.${domain.domain} TXT "${domain.verificationToken}"`,
                        )
                      }
                    >
                      <Copy className="h-3 w-3" /> Copy record
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1 px-2 text-[11px]"
                      disabled={checking === domain._id}
                      onClick={() => void check(domain._id)}
                    >
                      {checking === domain._id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3 w-3" />
                      )}
                      Verify now
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 px-2 text-[11px] text-error hover:text-error"
                      onClick={() => setConfirmRemove(domain)}
                    >
                      <Trash2 className="h-3 w-3" /> Remove
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="h-fit">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">DNS instructions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-0 text-xs leading-relaxed text-muted-foreground">
          <p>
            1. In your DNS provider, create a <strong className="text-foreground">TXT</strong>{" "}
            record for the name shown on each domain.
          </p>
          <p>
            2. Paste the record value exactly, then return here. Verification runs automatically
            every 15 seconds while the tab is open.
          </p>
          <p>
            3. After verification, point a{" "}
            <strong className="text-foreground">CNAME</strong> for the domain at{" "}
            <span className="font-mono text-foreground">sites.cloudie.app</span>.
          </p>
          <pre className="overflow-x-auto rounded-lg border border-border bg-muted/50 p-3 font-mono text-[10px] leading-relaxed text-foreground">
{`portal.yourbank.com.  300  IN  CNAME  sites.cloudie.app.
_cloudie-challenge.portal.yourbank.com.  300  IN  TXT  "<token>"`}
          </pre>
          <p className="rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-[11px] text-foreground">
            DNS changes can take up to 24 hours to propagate. Customers keep using the{" "}
            <span className="font-mono">{subdomain}.cloudie.app</span> address in the meantime.
          </p>
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(confirmRemove)}
        onOpenChange={(open) => !open && setConfirmRemove(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove {confirmRemove?.domain}?</DialogTitle>
            <DialogDescription>
              The domain stops routing to this site. You can add it again later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="ghost" onClick={() => setConfirmRemove(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!confirmRemove) return;
                try {
                  await removeDomain({ tenantId, domainId: confirmRemove._id });
                  toast.success("Domain removed");
                  setConfirmRemove(null);
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Could not remove domain");
                }
              }}
            >
              Remove domain
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ─────────────────────────── Billing ─────────────────────────── */

function BillingTab({ site }: { site: Site }) {
  const pay = useMutation(api.tenantSuite.payRenewalEarly);
  const [busy, setBusy] = useState(false);
  const remaining = daysUntil(site.renewalDate);
  const overdue = remaining !== null && remaining < 0;
  const dueSoon = remaining !== null && remaining >= 0 && remaining <= 7;

  async function payEarly() {
    setBusy(true);
    try {
      const result = await pay({ tenantId: site._id });
      toast.success(
        `Renewed to ${fmtDate(result.renewalDate)} — ${result.charged} point${
          result.charged === 1 ? "" : "s"
        } charged.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not renew this site";
      toast.error(message.replace(/^INSUFFICIENT_POINTS:\s*/, ""));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {overdue && (
        <div className="flex items-start gap-3 rounded-xl border border-error/35 bg-error/10 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-error" />
          <div className="text-sm text-foreground">
            <p className="font-medium">Payment overdue by {Math.abs(remaining as number)} days</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Customer pages are in grace until {fmtDate(site.graceEndsAt)}. After that the portal
              becomes read-only until renewal.
            </p>
          </div>
        </div>
      )}
      {dueSoon && !overdue && (
        <div className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3">
          <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p className="text-sm text-foreground">
            Renewal in {remaining} day{remaining === 1 ? "" : "s"} — pay early to avoid a grace
            period.
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Renewal date
            </p>
            <p className="mt-1.5 font-mono text-sm font-semibold text-foreground">
              {fmtDate(site.renewalDate)}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {remaining === null
                ? "No schedule"
                : remaining >= 0
                  ? `${remaining} days remaining`
                  : `${Math.abs(remaining)} days overdue`}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Monthly point cost
            </p>
            <p className="mt-1.5 font-mono text-sm font-semibold text-foreground">
              {site.monthlyPoints} pts
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Charged per 30-day term</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Next invoice
            </p>
            <p className="mt-1.5 font-mono text-sm font-semibold text-foreground">
              {fmtDate(site.nextInvoiceAt)}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Grace period: {site.graceDays} days
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface-2 text-muted-foreground">
              <CreditCard className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-medium text-foreground">Pay early</p>
              <p className="text-[11px] text-muted-foreground">
                Extends the term 30 days from the later of today or the current renewal date.
                Charged from your point balance.
              </p>
            </div>
          </div>
          <Button className="gap-2" onClick={() => void payEarly()} disabled={busy}>
            {busy ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Charging
              </>
            ) : (
              <>
                Pay {site.monthlyPoints} pts <ArrowUpRight className="h-3.5 w-3.5" />
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

/* ─────────────────────────── Danger zone ─────────────────────────── */

function DangerTab({ site }: { site: Site }) {
  const suspend = useMutation(api.tenantSuite.suspendSite);
  const transfer = useMutation(api.tenantSuite.transferOwnership);
  const remove = useMutation(api.tenantSuite.deleteSite);
  const navigate = useNavigate();

  const [dialog, setDialog] = useState<"suspend" | "transfer" | "delete" | null>(null);
  const [reason, setReason] = useState("");
  const [email, setEmail] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const [busy, setBusy] = useState(false);

  function open(which: "suspend" | "transfer" | "delete") {
    setReason("");
    setEmail("");
    setConfirmName("");
    setDialog(which);
  }

  async function run() {
    setBusy(true);
    try {
      if (dialog === "suspend") {
        await suspend({ tenantId: site._id, reason });
        toast.success("Site suspended");
      } else if (dialog === "transfer") {
        await transfer({ tenantId: site._id, email, reason });
        toast.success("Ownership transferred");
      } else if (dialog === "delete") {
        await remove({ tenantId: site._id, confirmName, reason });
        toast.success("Site deleted");
        navigate("/app/business");
        return;
      }
      setDialog(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That action failed");
    } finally {
      setBusy(false);
    }
  }

  const rows = [
    {
      key: "suspend" as const,
      icon: Lock,
      title: "Suspend site",
      description:
        "Blocks customer sign-in and transfers immediately. Data, branding and ledger are kept.",
      label: "Suspend",
      disabled: site.status !== "active",
    },
    {
      key: "transfer" as const,
      icon: ArrowUpRight,
      title: "Transfer ownership",
      description:
        "Move this site to another Cloudie account. The new owner gains full billing and admin control.",
      label: "Transfer",
    },
    {
      key: "delete" as const,
      icon: Trash2,
      title: "Delete site",
      description:
        "Permanently retires the portal and frees the subdomain. Ledger and KYC records are retained for audit.",
      label: "Delete",
    },
  ];

  return (
    <>
      <Card className="border-error/30">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold text-error">
            <AlertTriangle className="h-4 w-4" /> Danger zone
          </CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-border pt-0">
          {rows.map((row) => (
            <div
              key={row.key}
              className="flex flex-col gap-2 py-3.5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-error/25 bg-error/5 text-error">
                  <row.icon className="h-4 w-4" />
                </span>
                <div className="max-w-lg">
                  <p className="text-sm font-medium text-foreground">{row.title}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                    {row.description}
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 self-start text-error hover:bg-error/10 hover:text-error sm:self-auto"
                disabled={row.disabled}
                onClick={() => open(row.key)}
              >
                <row.icon className="h-3.5 w-3.5" /> {row.label}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={dialog !== null} onOpenChange={(open) => !busy && !open && setDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {dialog === "suspend"
                ? `Suspend ${site.siteName}`
                : dialog === "transfer"
                  ? "Transfer ownership"
                  : `Delete ${site.siteName}`}
            </DialogTitle>
            <DialogDescription>
              {dialog === "suspend"
                ? "Customer access stops now. You can reactivate later from this page."
                : dialog === "transfer"
                  ? "The receiving account must already have a Cloudie login."
                  : "This cannot be undone. Type the site name exactly to confirm."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {dialog === "transfer" && (
              <div className="space-y-1.5">
                <Label htmlFor="transfer-email">New owner email</Label>
                <Input
                  id="transfer-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="owner@yourbank.com"
                />
              </div>
            )}
            {dialog === "delete" && (
              <div className="space-y-1.5">
                <Label htmlFor="confirm-name">
                  Type <span className="font-mono text-foreground">{site.siteName}</span>
                </Label>
                <Input
                  id="confirm-name"
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                  placeholder={site.siteName}
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="danger-reason">Reason (audit log)</Label>
              <Textarea
                id="danger-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="min-h-16"
                maxLength={400}
                placeholder={
                  dialog === "delete"
                    ? "e.g. Business closed — migrating customers to the parent bank"
                    : "Why is this change happening?"
                }
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="ghost" onClick={() => setDialog(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={
                busy ||
                reason.trim().length < (dialog === "delete" ? 10 : 8) ||
                (dialog === "transfer" && !email.includes("@")) ||
                (dialog === "delete" && confirmName.trim() !== site.siteName)
              }
              onClick={() => void run()}
            >
              {busy
                ? "Working…"
                : dialog === "suspend"
                  ? "Suspend site"
                  : dialog === "transfer"
                    ? "Transfer"
                    : "Delete permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
