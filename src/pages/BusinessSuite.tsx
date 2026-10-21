import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Link } from "react-router";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { StatusBadge } from "@/components/admin/shared";
import { Reveal, StaggerGroup, StaggerItem } from "@/components/motion";
import {
  AlertTriangle,
  ArrowUpRight,
  Building2,
  Landmark,
  Lock,
  MoreHorizontal,
  Plus,
  Search,
  TrendingUp,
  Unlock,
  Users,
} from "lucide-react";

const DAY = 86_400_000;

/** "in 12 days" / "today" / "3 days overdue" — relative, deliberately terse. */
function renewalLabel(ts: number | null): { text: string; urgent: boolean } {
  if (!ts) return { text: "Not scheduled", urgent: false };
  const days = Math.ceil((ts - Date.now()) / DAY);
  if (days > 1) return { text: `in ${days} days`, urgent: days <= 7 };
  if (days === 1) return { text: "tomorrow", urgent: true };
  if (days === 0) return { text: "today", urgent: true };
  const overdue = Math.abs(days);
  return { text: `${overdue} day${overdue === 1 ? "" : "s"} overdue`, urgent: true };
}

type SiteRow = {
  _id: Id<"tenantSites">;
  siteName: string;
  siteType: string;
  subdomain: string;
  status: string;
  isActive: boolean;
  renewalDate: number | null;
  ledgerUsers: number;
  members: number;
  monthlyPoints: number;
};

export default function BusinessSuite() {
  const sites = useQuery(api.tenantSuite.listSites);
  const lockdown = useMutation(api.tenantSuite.lockdownSite);
  const reactivate = useMutation(api.tenantSuite.reactivateSite);

  const [query, setQuery] = useState("");
  const [lockTarget, setLockTarget] = useState<SiteRow | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => {
    const list = (sites ?? []) as SiteRow[];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (s) =>
        s.siteName.toLowerCase().includes(q) || s.subdomain.toLowerCase().includes(q),
    );
  }, [sites, query]);

  const activeCount = (sites ?? []).filter((s) => s.status === "active").length;
  const expiring = (sites ?? []).filter(
    (s) => s.renewalDate && s.renewalDate - Date.now() < 7 * DAY,
  ).length;

  async function confirmLockdown() {
    if (!lockTarget) return;
    if (reason.trim().length < 8) {
      toast.error("Give a reason of at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      await lockdown({ tenantId: lockTarget._id, reason });
      toast.success(`${lockTarget.siteName} locked down. Customer login is blocked.`);
      setLockTarget(null);
      setReason("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not lock down this site.");
    } finally {
      setBusy(false);
    }
  }

  async function handleReactivate(site: SiteRow) {
    try {
      await reactivate({ tenantId: site._id, reason: "Reactivated from Business Suite" });
      toast.success(`${site.siteName} is active again.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not reactivate this site.");
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <Building2 className="h-3.5 w-3.5" />
            Tenant sites
          </div>
          <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Business Suite
          </h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            White-label banking and investment portals — branding, customers, ledger and renewals.
          </p>
        </div>
        <Link to="/business/sites/new" className="w-full sm:w-auto">
          <Button className="w-full gap-2 sm:w-auto">
            <Plus className="h-4 w-4" />
            New tenant site
          </Button>
        </Link>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-3 divide-x divide-border overflow-hidden rounded-xl border border-border bg-card">
        {[
          { label: "Sites", value: sites ? sites.length : "—" },
          { label: "Active", value: sites ? activeCount : "—" },
          { label: "Renew in 7d", value: sites ? expiring : "—" },
        ].map((stat) => (
          <div key={stat.label} className="px-4 py-3">
            <div className="font-mono text-lg font-semibold text-foreground">{stat.value}</div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {stat.label}
            </div>
          </div>
        ))}
      </div>

      {expiring > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p>
            {expiring} site{expiring === 1 ? "" : "s"} renew within 7 days. Pay early from the
            site&apos;s Billing tab to avoid a customer-facing grace period.
          </p>
        </div>
      )}

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by site or subdomain"
          className="pl-9"
          aria-label="Search tenant sites"
        />
      </div>

      {sites === undefined ? (
        <Card>
          <CardContent className="space-y-3 p-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : sites.length === 0 ? (
        <Empty className="rounded-xl border border-dashed border-border bg-card">
          <EmptyMedia variant="icon">
            <Building2 />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>No tenant sites yet</EmptyTitle>
            <EmptyDescription>
              Spin up a branded banking or investment portal with its own subdomain, ledger and
              customer sign-up.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Link to="/business/sites/new">
              <Button className="gap-2">
                <Plus className="h-4 w-4" /> New tenant site
              </Button>
            </Link>
          </EmptyContent>
        </Empty>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          No site matches “{query}”.
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-xl border border-border bg-card md:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-4">Site</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Subdomain</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Renewal</TableHead>
                  <TableHead className="text-right">Ledger users</TableHead>
                  <TableHead className="w-12 pr-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((site) => {
                  const renewal = renewalLabel(site.renewalDate);
                  const TypeIcon = site.siteType === "investment" ? TrendingUp : Landmark;
                  return (
                    <TableRow key={site._id} className="group">
                      <TableCell className="py-3 pl-4">
                        <Link to={`/app/business/${site._id}`} className="block">
                          <span className="flex items-center gap-2.5">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2 text-muted-foreground">
                              <TypeIcon className="h-4 w-4" />
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium text-foreground group-hover:text-primary">
                                {site.siteName}
                              </span>
                              <span className="block text-[11px] text-muted-foreground">
                                {site.members} member{site.members === 1 ? "" : "s"}
                              </span>
                            </span>
                          </span>
                        </Link>
                      </TableCell>
                      <TableCell>
                        <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {site.siteType}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {site.subdomain}
                        <span className="text-muted-foreground/60">.cloudie.app</span>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={site.status} />
                      </TableCell>
                      <TableCell>
                        <span
                          className={
                            renewal.urgent
                              ? "text-xs font-medium text-warning"
                              : "text-xs text-muted-foreground"
                          }
                        >
                          {renewal.text}
                        </span>
                        {site.renewalDate && (
                          <span className="block text-[11px] text-muted-foreground/70">
                            {new Date(site.renewalDate).toLocaleDateString(undefined, {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-foreground">
                        {site.ledgerUsers}
                      </TableCell>
                      <TableCell className="pr-4">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              aria-label={`Actions for ${site.siteName}`}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuItem asChild>
                              <Link to={`/app/business/${site._id}`} className="gap-2">
                                <ArrowUpRight className="h-4 w-4" /> View site
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="gap-2 text-error focus:text-error"
                              disabled={site.status !== "active"}
                              onSelect={() => {
                                setReason("");
                                setLockTarget(site);
                              }}
                            >
                              <Lock className="h-4 w-4" /> Lockdown
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="gap-2"
                              disabled={site.status === "active"}
                              onSelect={() => void handleReactivate(site)}
                            >
                              <Unlock className="h-4 w-4" /> Reactivate
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Mobile cards */}
          <StaggerGroup className="space-y-3 md:hidden">
            {rows.map((site) => {
              const renewal = renewalLabel(site.renewalDate);
              const TypeIcon = site.siteType === "investment" ? TrendingUp : Landmark;
              return (
                <StaggerItem key={site._id}>
                  <motion.div whileTap={{ scale: 0.995 }}>
                    <Card>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <Link to={`/app/business/${site._id}`} className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <TypeIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                              <span className="truncate text-sm font-semibold text-foreground">
                                {site.siteName}
                              </span>
                              <span className="rounded border border-border px-1.5 font-mono text-[10px] uppercase text-muted-foreground">
                                {site.siteType}
                              </span>
                            </div>
                            <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                              {site.subdomain}.cloudie.app
                            </div>
                          </Link>
                          <StatusBadge status={site.status} />
                        </div>
                        <div className="mt-3 flex items-center justify-between border-t border-border pt-2.5 text-xs">
                          <span className={renewal.urgent ? "font-medium text-warning" : "text-muted-foreground"}>
                            Renews {renewal.text}
                          </span>
                          <span className="flex items-center gap-1.5 text-muted-foreground">
                            <Users className="h-3.5 w-3.5" />
                            <span className="font-mono">{site.ledgerUsers}</span> ledger
                          </span>
                        </div>
                        <div className="mt-3 flex gap-2">
                          <Link to={`/app/business/${site._id}`} className="flex-1">
                            <Button variant="outline" size="sm" className="w-full gap-1.5">
                              <ArrowUpRight className="h-3.5 w-3.5" /> View
                            </Button>
                          </Link>
                          {site.status === "active" ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1.5 text-error hover:text-error"
                              onClick={() => {
                                setReason("");
                                setLockTarget(site);
                              }}
                            >
                              <Lock className="h-3.5 w-3.5" /> Lockdown
                            </Button>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1.5"
                              onClick={() => void handleReactivate(site)}
                            >
                              <Unlock className="h-3.5 w-3.5" /> Reactivate
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                </StaggerItem>
              );
            })}
          </StaggerGroup>
        </>
      )}

      <Reveal>
        <p className="rounded-xl border border-border bg-surface-2/60 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          Before publishing customer-facing financial pages, confirm your organization is
          authorized to offer the services and that all disclosures, controls and applicable
          compliance requirements are in place.
        </p>
      </Reveal>

      {/* Lockdown dialog */}
      <Dialog
        open={Boolean(lockTarget)}
        onOpenChange={(open) => {
          if (!open && !busy) setLockTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="h-4 w-4 text-error" /> Lock down {lockTarget?.siteName}
            </DialogTitle>
            <DialogDescription>
              Customer sign-in, transfers and the public portal stop immediately. The ledger,
              KYC records and theme are preserved, and you can reactivate at any time.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="lockdown-reason">Reason (stored in the audit log)</Label>
            <Textarea
              id="lockdown-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Suspected account takeover on three customer accounts"
              maxLength={400}
              className="min-h-20"
            />
            <p className="text-[11px] text-muted-foreground">
              {reason.trim().length}/8 characters minimum
            </p>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="ghost" onClick={() => setLockTarget(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void confirmLockdown()}
              disabled={busy || reason.trim().length < 8}
            >
              {busy ? "Locking down…" : "Lock down site"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
