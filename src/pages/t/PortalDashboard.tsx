import { Link } from "react-router";
import { TenantPortalShell, money, usePortal } from "@/components/tenant/TenantPortalShell";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, BadgeCheck, Clock, ShieldCheck, Wallet } from "lucide-react";

export default function PortalDashboard() {
  return (
    <TenantPortalShell>
      <DashboardBody />
    </TenantPortalShell>
  );
}

function startOfDay(ts: number) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function dayLabel(ts: number) {
  const today = startOfDay(Date.now());
  if (ts >= today) return "Today";
  if (ts >= today - 86_400_000) return "Yesterday";
  return new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function DashboardBody() {
  const { data, theme, subdomain } = usePortal();
  const { tenant, viewer, accounts, ledger, kyc } = data;

  const balanceMinor = accounts
    .filter((a) => a.isActive)
    .reduce((sum, account) => sum + account.balanceMinor, 0);
  const weekAgo = Date.now() - 7 * 86_400_000;
  const recent = ledger.filter((entry) => entry.createdAt >= weekAgo);
  const net = recent.reduce((sum, entry) => sum + entry.amount, 0);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const firstName = (viewer?.name || viewer?.email || "there").split(" ")[0];

  const kycLabel =
    kyc?.status === "approved"
      ? "Verified"
      : kyc?.status === "rejected"
        ? "Verification failed"
        : kyc
          ? "Verification in review"
          : "Verification needed";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs" style={{ color: theme.muted }}>
            {new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">
            {greeting}, {firstName}
          </h1>
        </div>
        <Link
          to={`/t/${subdomain}/kyc`}
          className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium"
          style={{
            borderColor: kyc?.status === "approved" ? "rgba(4,120,87,0.35)" : theme.border,
            color: kyc?.status === "approved" ? "#047857" : theme.muted,
            background: kyc?.status === "approved" ? "rgba(16,185,129,0.10)" : theme.panel,
          }}
        >
          {kyc?.status === "approved" ? <BadgeCheck className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
          {kycLabel}
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {/* Balance */}
        <section
          className="border p-4"
          style={{ background: theme.panel, borderColor: theme.border, borderRadius: theme.radius }}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wide" style={{ color: theme.muted }}>
              Total balance
            </span>
            <Wallet className="h-4 w-4" style={{ color: theme.primary }} />
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold tracking-tight">
            {money(balanceMinor, tenant.currency)}
          </p>
          <p className="mt-1 text-[11px]" style={{ color: theme.muted }}>
            {accounts.length === 0
              ? "No accounts open yet"
              : `${accounts.length} account${accounts.length === 1 ? "" : "s"} · ${accounts
                  .map((a) => a.name)
                  .slice(0, 2)
                  .join(", ")}`}
          </p>
        </section>

        {/* Activity */}
        <section
          className="border p-4"
          style={{ background: theme.panel, borderColor: theme.border, borderRadius: theme.radius }}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wide" style={{ color: theme.muted }}>
              Recent activity
            </span>
            <Clock className="h-4 w-4" style={{ color: theme.muted }} />
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold tracking-tight">
            {recent.length} <span className="text-sm font-normal" style={{ color: theme.muted }}>entries</span>
          </p>
          <p className="mt-1 text-[11px]" style={{ color: net >= 0 ? "#047857" : "#b91c1c" }}>
            {net >= 0 ? "+" : "−"}
            {money(Math.abs(net), tenant.currency)} net · last 7 days
          </p>
        </section>
      </div>

      {/* Ledger preview */}
      <section
        className="overflow-hidden border"
        style={{ background: theme.panel, borderColor: theme.border, borderRadius: theme.radius }}
      >
        <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: theme.divider }}>
          <h2 className="text-sm font-semibold">Recent transactions</h2>
          <Link
            to={`/t/${subdomain}/ledger`}
            className="inline-flex items-center gap-1 text-[11px] font-medium"
            style={{ color: theme.primary }}
          >
            View all <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        {ledger.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm font-medium">No transactions yet</p>
            <p className="mt-1 text-[11px]" style={{ color: theme.muted }}>
              Deposits, withdrawals and transfers on this site will appear here.
            </p>
          </div>
        ) : (
          <ul>
            {ledger.slice(0, 5).map((entry, index) => {
              const positive = entry.amount >= 0;
              return (
                <li
                  key={entry._id}
                  className="flex items-center gap-3 px-4 py-3"
                  style={{ borderTop: index === 0 ? "none" : `1px solid ${theme.divider}` }}
                >
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                    style={{
                      background: positive ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.10)",
                      color: positive ? "#047857" : "#b91c1c",
                    }}
                  >
                    {positive ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{entry.description}</p>
                    <p className="text-[11px] capitalize" style={{ color: theme.muted }}>
                      {entry.type.replace(/_/g, " ")} · {dayLabel(entry.createdAt)}
                    </p>
                  </div>
                  <span
                    className="shrink-0 font-mono text-xs font-medium"
                    style={{ color: positive ? "#047857" : "#b91c1c" }}
                  >
                    {positive ? "+" : "−"}
                    {money(Math.abs(entry.amount), tenant.currency)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {kyc?.status !== "approved" && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 border px-4 py-3"
          style={{
            background: theme.panelMuted,
            borderColor: theme.border,
            borderRadius: theme.radius,
          }}
        >
          <p className="text-xs" style={{ color: theme.muted }}>
            {kyc?.status === "rejected"
              ? "Your identity check needs another try before higher limits unlock."
              : "Verify your identity to unlock higher limits and faster transfers."}
          </p>
          <Link
            to={`/t/${subdomain}/kyc`}
            className="rounded px-3 py-1.5 text-[11px] font-semibold text-white"
            style={{ background: theme.primary, borderRadius: theme.radius }}
          >
            {kyc?.status === "rejected" ? "Retry verification" : "Start verification"}
          </Link>
        </div>
      )}
    </div>
  );
}
