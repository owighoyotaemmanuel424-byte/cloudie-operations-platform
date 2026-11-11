import { useEffect, useState } from "react";
import { Navigate } from "react-router";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { usePlatform } from "@/platform/Provider";
import { dateTime, points } from "@/platform/format";
import { cn } from "@/lib/utils";
import { Panel, Reveal, SectionLabel } from "@/platform/ui";
import {
  listPendingDeposits,
  settleDeposit,
  refundLedgerGroup,
  listAuditLogs,
} from "@/platform/engine";

type Tab = "deposits" | "refund" | "audit";

const TABS: { id: Tab; label: string }[] = [
  { id: "deposits", label: "Pending deposits" },
  { id: "refund", label: "Issue refund" },
  { id: "audit", label: "Audit log" },
];

export default function AdminPage() {
  const { user } = usePlatform();
  const isAdmin = user?.role === "admin";

  const [tab, setTab] = useState<Tab>("deposits");
  const [pending, setPending] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [groupId, setGroupId] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const [deposits, auditLogs] = await Promise.all([
        listPendingDeposits(),
        listAuditLogs(100),
      ]);
      setPending(deposits);
      setLogs(auditLogs);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load admin data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isAdmin) return;
    void refresh();
  }, [isAdmin]);

  if (!user) {
    return null;
  }
  if (!isAdmin) {
    return <Navigate to="/app/personal" replace />;
  }

  async function handleSettle(id: string) {
    const result = await settleDeposit(id);
    if (result.ok) {
      toast.success("Deposit settled");
      await refresh();
    } else {
      toast.error(result.error);
    }
  }

  async function handleRefund(event: React.FormEvent) {
    event.preventDefault();
    if (!groupId.trim()) {
      toast.error("A ledger group id is required");
      return;
    }
    setSubmitting(true);
    try {
      const result = await refundLedgerGroup({ groupId: groupId.trim(), reason: reason.trim() || undefined });
      if (result.ok) {
        toast.success("Refund issued");
        setGroupId("");
        setReason("");
        await refresh();
      } else {
        toast.error(result.error);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <SectionLabel>Administration</SectionLabel>
        <h1 className="mt-2 font-display text-2xl font-semibold">Operator console</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Settle pending deposits, issue reversing refunds, and review the audit trail.
        </p>
      </div>

      <div className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-surface p-1">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors",
              tab === item.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {loading ? (
        <Panel className="p-8 text-center text-sm text-muted-foreground">Loading…</Panel>
      ) : null}

      {!loading && tab === "deposits" ? (
        <Reveal>
          <Panel className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
              <h2 className="font-display text-base font-semibold">Pending deposits</h2>
              <Badge variant="secondary">{pending.length} pending</Badge>
            </div>
            {pending.length === 0 ? (
              <p className="px-5 py-12 text-center text-sm text-muted-foreground">No pending deposits.</p>
            ) : (
              <ul className="divide-y divide-border">
                {pending.map((deposit) => {
                  const total = Number(deposit.points ?? 0) + Number(deposit.bonus ?? 0);
                  return (
                    <li key={deposit.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold">{deposit.label ?? "Top-up"}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {deposit.user_email ?? deposit.user_id} · {deposit.crypto ?? "crypto"} · {dateTime(deposit.created_at ?? deposit.createdAt)}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-[12px] tabular-nums">{points(total)} pts</span>
                        <Button size="sm" onClick={() => void handleSettle(String(deposit.id))}>
                          Settle
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </Reveal>
      ) : null}

      {!loading && tab === "refund" ? (
        <Reveal>
          <Panel className="p-5">
            <form onSubmit={handleRefund} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="groupId">Ledger group id</Label>
                <Input
                  id="groupId"
                  value={groupId}
                  onChange={(event) => setGroupId(event.target.value)}
                  placeholder="grp_…"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reason">Reason (optional)</Label>
                <Textarea
                  id="reason"
                  rows={3}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Why this refund is being issued"
                />
              </div>
              <Button type="submit" disabled={submitting || !groupId.trim()}>
                {submitting ? "Issuing…" : "Issue refund"}
              </Button>
            </form>
          </Panel>
        </Reveal>
      ) : null}

      {!loading && tab === "audit" ? (
        <Reveal>
          <Panel className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
              <h2 className="font-display text-base font-semibold">Audit log</h2>
              <Badge variant="secondary">{logs.length} entries</Badge>
            </div>
            {logs.length === 0 ? (
              <p className="px-5 py-12 text-center text-sm text-muted-foreground">No audit entries yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {logs.map((log) => (
                  <li key={log.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold">{log.action}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {log.actor_email ?? log.actor_user_id} · {log.target_type}
                          {log.target_id ? ` · ${log.target_id}` : ""}
                        </p>
                      </div>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {dateTime(log.created_at ?? log.createdAt)}
                      </span>
                    </div>
                    {log.details ? (
                      <pre className="mt-2 overflow-x-auto rounded-lg bg-surface p-2 font-mono text-[10px] text-muted-foreground">
                        {typeof log.details === "string" ? log.details : JSON.stringify(log.details)}
                      </pre>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </Reveal>
      ) : null}
    </div>
  );}
