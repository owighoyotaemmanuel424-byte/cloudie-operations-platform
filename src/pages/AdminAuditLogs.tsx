import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Download, Search, ShieldAlert, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { AdminPageHeader, AdminEmpty, AdminSkeleton, downloadCsv, fmtDate } from "@/components/admin/shared";

type AuditLog = {
  _id: string;
  actorEmail?: string;
  action: string;
  resource: string;
  resourceId?: string;
  reason?: string;
  before?: unknown;
  after?: unknown;
  createdAt: number;
};

const PAGE_SIZE = 25;

const ACTION_FILTERS = [
  "USER_SUSPENDED",
  "USER_REACTIVATED",
  "USER_TERMINATED",
  "POINTS_CREDITED",
  "POINTS_DEDUCTED",
  "VENDOR_APPROVED",
  "VENDOR_REJECTED",
  "VENDOR_SUSPENDED",
  "ORDER_REFUNDED",
  "ESCROW_RELEASED",
  "DISPUTE_UNDER_REVIEW",
  "DISPUTE_REJECTED",
  "TENANT_LOCKED",
  "TENANT_UNLOCKED",
  "KYC_APPROVED",
  "KYC_REJECTED",
  "PRICING_CHANGED",
  "PRICING_CREATED",
  "SETTING_CHANGED",
  "NOTIFICATION_SENT",
] as const;

export default function AdminAuditLogs() {
  // Three states, never two: `undefined` = still loading, `null` = the trail
  // could not be read (outage), array = records. Collapsing null into [] made a
  // backend failure indistinguishable from a genuinely empty audit trail.
  const logs = useQuery(api.admin.getAuditLogs, { limit: 1000 }) as AuditLog[] | null | undefined;

  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [page, setPage] = useState(0);

  const filtered = useMemo<AuditLog[] | null | undefined>(() => {
    if (logs === null) return null;
    if (!logs) return undefined;
    let list = [...logs];
    if (actionFilter !== "all") list = list.filter((l) => l.action === actionFilter);
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter(
        (l) =>
          l.action.toLowerCase().includes(s) ||
          l.resource.toLowerCase().includes(s) ||
          (l.resourceId ?? "").toLowerCase().includes(s) ||
          (l.reason ?? "").toLowerCase().includes(s) ||
          (l.actorEmail ?? "").toLowerCase().includes(s),
      );
    }
    return list;
  }, [logs, search, actionFilter]);

  const paged = filtered?.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil((filtered?.length ?? 0) / PAGE_SIZE));

  const exportCsv = () => {
    if (!filtered?.length) return;
    downloadCsv(`cloudie-audit-${new Date().toISOString().split("T")[0]}.csv`, [
      ["Timestamp", "Actor", "Action", "Resource", "Resource ID", "Reason"],
      ...filtered.map((l) => [fmtDate(l.createdAt), l.actorEmail ?? "system", l.action, l.resource, l.resourceId ?? "", l.reason ?? ""]),
    ]);
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Audit Logs"
        description="Append-only record of every privileged action. Records cannot be edited or deleted."
        actions={
          <Button variant="outline" onClick={exportCsv} className="gap-1.5" disabled={!filtered?.length}>
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder="Search action, resource, actor, reason…"
            className="pl-9"
            aria-label="Search audit logs"
          />
        </div>
        <select
          aria-label="Filter by action"
          className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          value={actionFilter}
          onChange={(e) => { setActionFilter(e.target.value); setPage(0); }}
        >
          <option value="all">All actions</option>
          {ACTION_FILTERS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <ShieldCheck className="h-3.5 w-3.5 text-green-600" />
        {filtered === null
          ? "Audit trail unavailable"
          : filtered === undefined
            ? "Loading…"
            : `${filtered.length.toLocaleString()} records`}
        {filtered && filtered.length > 0 && <span className="text-slate-300 dark:text-slate-600">·</span>}
        {filtered && filtered.length > 0 && <span>Page {page + 1} of {totalPages}</span>}
      </div>

      {filtered === null ? (
        <div
          role="status"
          className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-amber-300 bg-amber-50 py-12 text-center dark:border-amber-500/40 dark:bg-amber-500/10"
        >
          <ShieldAlert className="h-8 w-8 text-amber-500" />
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
            Audit log storage is unavailable
          </p>
          <p className="max-w-md text-xs leading-relaxed text-amber-700 dark:text-amber-300">
            This is an outage, not an empty trail. No conclusion about recorded privileged activity can be
            drawn until the service recovers.
          </p>
        </div>
      ) : filtered === undefined ? (
        <AdminSkeleton rows={6} />
      ) : filtered.length === 0 ? (
        <AdminEmpty message="No audit records match your filters." />
      ) : (
        <div className="space-y-3">
          {paged!.map((log) => (
            <Card key={log._id} className="rounded-xl border-slate-200 shadow-sm transition-shadow hover:shadow-md dark:border-slate-700">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <Badge variant="outline" className="shrink-0 rounded-full border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-mono font-semibold text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
                    {log.action}
                  </Badge>
                  <span className="shrink-0 rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-white dark:bg-white dark:text-slate-900">
                    {fmtDate(log.createdAt)}
                  </span>
                </div>

                <div className="mt-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
                  <p className="break-all text-xs font-semibold text-slate-900 dark:text-white">{log.resource}</p>
                  {log.resourceId && (
                    <p className="mt-1 break-all font-mono text-[11px] text-slate-500 dark:text-slate-400">{log.resourceId}</p>
                  )}
                  {log.reason && (
                    <p className="mt-2 border-t border-slate-200 pt-2 text-xs leading-relaxed text-slate-600 dark:border-slate-700 dark:text-slate-400">
                      {log.reason}
                    </p>
                  )}
                </div>

                <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-[11px] dark:border-slate-800">
                  <span className="truncate font-medium text-slate-500 dark:text-slate-400">
                    by <span className="font-semibold text-slate-700 dark:text-slate-200">{log.actorEmail ?? "system"}</span>
                  </span>
                  <span className="shrink-0 text-slate-400">{fmtDate(log.createdAt)}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {filtered && filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-4 dark:border-slate-700">
          <p className="text-sm text-slate-500">Page {page + 1} of {totalPages} · {filtered.length.toLocaleString()} total</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
