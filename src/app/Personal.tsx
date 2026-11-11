import { motion } from "framer-motion";
import {
  ArrowUpRight,
  Check,
  Copy,
  Coins,
  MessageSquare,
  Send,
  Sparkles,
  Users,
  Wallet,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePlatform } from "@/platform/Provider";
import { buyPoints, postChatMessage, purchaseListing } from "@/platform/engine";
import { MARKETPLACE_LISTINGS, POINT_PACKS, WORKSPACES } from "@/platform/model";
import { dateTime, naira, points, relative, titleCase } from "@/platform/format";
import { EASE, Panel, Reveal, SectionLabel, Stat } from "@/platform/ui";
import { cn } from "@/lib/utils";

const POINT_VALUE_NGN = 12;

type Tab = "overview" | "marketplace" | "orders" | "referrals";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "marketplace", label: "Marketplace" },
  { id: "orders", label: "Orders & chat" },
  { id: "referrals", label: "Referrals" },
];

export default function PersonalPage() {
  const { db, user } = usePlatform();
  const [tab, setTab] = useState<Tab>("overview");
  const [filter, setFilter] = useState<"all" | "credit" | "debit">("all");
  const [selectedOrder, setSelectedOrder] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const ledger = useMemo(
    () => (user ? db.ledger.filter((entry) => entry.userId === user.id) : []),
    [db.ledger, user],
  );
  const orders = useMemo(
    () => (user ? db.orders.filter((order) => order.userId === user.id) : []),
    [db.orders, user],
  );
  const shipments = user ? db.shipments.filter((shipment) => shipment.userId === user.id) : [];
  const documents = user ? db.documents.filter((document) => document.userId === user.id) : [];
  const referred = user ? db.users.filter((candidate) => candidate.referredBy === user.referralCode) : [];
  const referralBonus = ledger
    .filter((entry) => entry.reason.startsWith("Referral bonus"))
    .reduce((sum, entry) => sum + entry.points, 0);

  if (!user) return null;

  const filtered = ledger.filter((entry) =>
    filter === "all" ? true : filter === "credit" ? entry.points > 0 : entry.points < 0,
  );
  const activeOrder = orders.find((order) => order.id === selectedOrder) ?? orders[0] ?? null;
  const messages = activeOrder ? db.messages.filter((message) => message.orderId === activeOrder.id) : [];

  async function handleBuy(pack: typeof POINT_PACKS[number]) {
    const result = await buyPoints(pack);
    if (result.ok) {
      toast.success("Top-up requested", {
        description: `${(pack.points + pack.bonus).toLocaleString()} pts credited once the ${pack.crypto} payment settles.`,
      });
    } else toast.error(result.error);
  }

  async function handlePurchase(listing: typeof MARKETPLACE_LISTINGS[number]) {
    const result = await purchaseListing(listing);
    if (result.ok) {
      setSelectedOrder(result.value.id);
      toast.success("Order placed", { description: `${listing.title} · ${listing.points} pts deducted.` });
      setTab("orders");
    } else {
      toast.error(result.error);
    }
  }

  async function handleSend(orderId: string) {
    const result = await postChatMessage(orderId, draft);
    if (result.ok) setDraft("");
    else toast.error(result.error);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: EASE }}>
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="grid gap-6 p-6 sm:grid-cols-[1.2fr_1fr] sm:p-7">
            <div>
              <SectionLabel>Personal workspace</SectionLabel>
              <p className="mt-3 font-display text-[2.1rem] font-semibold leading-none tabular-nums">
                {points(user.points)}
                <span className="ml-2 text-sm font-medium text-muted-foreground">points</span>
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                ≈ {naira(user.points * POINT_VALUE_NGN)} of platform credit · one balance across five workspaces
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setTab("marketplace")}>
                  <Coins className="h-4 w-4" /> Top up points
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <Link to="/app/shipments">
                    Create shipment <ArrowUpRight className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 self-center">
              <Stat label="Ledger entries" value={ledger.length} hint="all time" />
              <Stat label="In transit" value={shipments.filter((s) => s.status !== "delivered").length} hint="shipments" />
              <Stat label="Documents" value={documents.length} hint="rendered" />
              <Stat label="Orders" value={orders.length} hint="marketplace" />
            </div>
          </div>
          <div className="flex gap-1 overflow-x-auto border-t border-border bg-surface/60 px-3 py-2">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={cn(
                  "shrink-0 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors",
                  tab === item.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </motion.div>

      {tab === "overview" ? (
        <div className="grid gap-5 lg:grid-cols-[1.55fr_1fr]">
          <Reveal>
            <Panel className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3.5">
                <div>
                  <h2 className="font-display text-base font-semibold">Transaction ledger</h2>
                  <p className="text-[11px] text-muted-foreground">Every deduction is verified before it posts</p>
                </div>
                <div className="flex gap-1 rounded-lg border border-border bg-surface p-0.5">
                  {(["all", "credit", "debit"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setFilter(option)}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-[11px] capitalize transition-colors",
                        filter === option ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
                      )}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
              <ul className="divide-y divide-border">
                {filtered.length === 0 ? (
                  <li className="px-5 py-10 text-center text-sm text-muted-foreground">No ledger entries in this view.</li>
                ) : (
                  filtered.slice(0, 12).map((entry) => (
                    <li key={entry.id} className="flex items-center gap-3 px-5 py-3">
                      <span
                        className={cn(
                          "grid h-8 w-8 shrink-0 place-items-center rounded-lg",
                          entry.points > 0 ? "bg-primary/12 text-primary" : "bg-surface-2 text-muted-foreground",
                        )}
                      >
                        {entry.points > 0 ? <Sparkles className="h-3.5 w-3.5" /> : <Wallet className="h-3.5 w-3.5" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium">{entry.reason}</p>
                        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                          {entry.workspace} · {dateTime(entry.createdAt)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className={cn("font-mono text-[13px] tabular-nums", entry.points > 0 ? "text-primary" : "text-foreground")}>
                          {entry.points > 0 ? "+" : "−"}
                          {Math.abs(entry.points).toLocaleString()}
                        </p>
                        <p className="font-mono text-[10px] text-muted-foreground">{points(entry.balanceAfter)} pts</p>
                      </div>
                    </li>
                  ))
                )}
              </ul>
            </Panel>
          </Reveal>

          <Reveal delay={0.06}>
            <Panel className="p-5">
              <h2 className="font-display text-base font-semibold">Jump into a workspace</h2>
              <ul className="mt-3 space-y-2">
                {WORKSPACES.filter((workspace) => workspace.id !== "personal").map((workspace) => (
                  <li key={workspace.id}>
                    <Link
                      to={workspace.route}
                      className="group flex items-center justify-between rounded-xl border border-border bg-surface/60 px-3 py-2.5 transition-colors hover:border-primary/40 hover:bg-surface"
                    >
                      <span>
                        <span className="block text-[13px] font-medium">{workspace.label}</span>
                        <span className="block text-[11px] text-muted-foreground">{workspace.tagline}</span>
                      </span>
                      <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="mt-4 rounded-xl bg-[var(--brass-soft)] px-3 py-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--brass)]">Referral programme</p>
                <p className="mt-1 text-[13px] font-medium">
                  Earn 250 pts for every workspace you introduce.
                </p>
                <Button variant="ghost" size="sm" className="mt-2 h-auto px-0 text-xs text-[var(--brass)]" onClick={() => setTab("referrals")}>
                  View referral dashboard →
                </Button>
              </div>
            </Panel>
          </Reveal>
        </div>
      ) : null}

      {tab === "marketplace" ? (
        <div className="space-y-6">
          <Reveal>
            <div>
              <div className="flex items-end justify-between gap-4">
                <div>
                  <h2 className="font-display text-lg font-semibold">Crypto point top-ups</h2>
                  <p className="text-xs text-muted-foreground">Settled instantly into the same ledger balance</p>
                </div>
                <Badge variant="secondary" className="hidden sm:inline-flex">prepaid</Badge>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {POINT_PACKS.map((pack) => (
                  <div key={pack.id} className="flex flex-col rounded-xl border border-border bg-card p-4">
                    <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{pack.label}</p>
                    <p className="mt-1 font-display text-xl font-semibold tabular-nums">{pack.points.toLocaleString()} pts</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{naira(pack.priceNgn)} · {pack.crypto}</p>
                    {pack.bonus > 0 ? (
                      <p className="mt-1 text-[11px] text-[var(--brass)]">+{pack.bonus.toLocaleString()} bonus pts</p>
                    ) : (
                      <p className="mt-1 text-[11px] text-muted-foreground">No bonus on this pack</p>
                    )}
                    <Button size="sm" variant="outline" className="mt-3" onClick={() => handleBuy(pack)}>
                      Top up
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>

          <Reveal delay={0.05}>
            <div>
              <h2 className="font-display text-lg font-semibold">Vendor marketplace</h2>
              <p className="text-xs text-muted-foreground">Services fulfilled by vetted vendors, paid from your balance</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {MARKETPLACE_LISTINGS.map((listing) => (
                  <div key={listing.id} className="rounded-xl border border-border bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <Badge variant="secondary" className="mb-2 text-[10px]">{listing.tag}</Badge>
                        <h3 className="font-display text-[15px] font-semibold leading-snug">{listing.title}</h3>
                        <p className="mt-1 text-xs text-muted-foreground">{listing.detail}</p>
                      </div>
                      <span className="shrink-0 rounded-lg bg-surface px-2 py-1 font-mono text-[11px] tabular-nums">
                        {listing.points.toLocaleString()} pts
                      </span>
                    </div>
                    <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
                      <span className="text-[11px] text-muted-foreground">
                        {listing.vendor} · ★ {listing.rating.toFixed(1)}
                      </span>
                      <Button size="sm" onClick={() => handlePurchase(listing)}>Order</Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      ) : null}

      {tab === "orders" ? (
        <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
          <Reveal>
            <Panel className="overflow-hidden">
              <div className="border-b border-border px-4 py-3">
                <h2 className="font-display text-sm font-semibold">Your orders</h2>
              </div>
              {orders.length === 0 ? (
                <p className="px-4 py-8 text-center text-xs text-muted-foreground">
                  No orders yet. Place one from the marketplace.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {orders.map((order) => (
                    <li key={order.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedOrder(order.id)}
                        className={cn(
                          "w-full px-4 py-3 text-left transition-colors hover:bg-surface",
                          activeOrder?.id === order.id && "bg-surface",
                        )}
                      >
                        <p className="truncate text-[13px] font-medium">{order.title}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {order.vendor} · {relative(order.createdAt)}
                        </p>
                        <span className="mt-1 inline-block rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                          {titleCase(order.status)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </Reveal>

          <Reveal delay={0.05}>
            <Panel className="flex min-h-[420px] flex-col">
              {activeOrder ? (
                <>
                  <div className="flex items-center justify-between border-b border-border px-5 py-3">
                    <div>
                      <h2 className="font-display text-sm font-semibold">{activeOrder.title}</h2>
                      <p className="text-[11px] text-muted-foreground">{activeOrder.vendor} · order chat</p>
                    </div>
                    <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-medium text-primary">
                      {titleCase(activeOrder.status)}
                    </span>
                  </div>
                  <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
                    {messages.map((message) => (
                      <div
                        key={message.id}
                        className={cn("flex", message.from === "customer" ? "justify-end" : "justify-start")}
                      >
                        <div
                          className={cn(
                            "max-w-[78%] rounded-2xl px-3.5 py-2 text-[13px]",
                            message.from === "customer"
                              ? "bg-primary text-primary-foreground"
                              : "border border-border bg-surface",
                          )}
                        >
                          <p>{message.body}</p>
                          <p className={cn("mt-1 font-mono text-[9px]", message.from === "customer" ? "text-primary-foreground/60" : "text-muted-foreground")}>
                            {dateTime(message.at)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <form
                    className="flex items-center gap-2 border-t border-border px-3 py-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      handleSend(activeOrder.id);
                    }}
                  >
                    <Input
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      placeholder="Message the vendor…"
                      className="flex-1"
                    />
                    <Button type="submit" size="icon" aria-label="Send message">
                      <Send className="h-4 w-4" />
                    </Button>
                  </form>
                </>
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
                  <MessageSquare className="h-6 w-6 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Select an order to open its live chat.</p>
                </div>
              )}
            </Panel>
          </Reveal>
        </div>
      ) : null}

      {tab === "referrals" ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <Reveal>
            <Panel className="p-6">
              <SectionLabel>Referral dashboard</SectionLabel>
              <h2 className="mt-3 font-display text-2xl font-semibold">Earn 250 pts per workspace</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Share your code. The bonus posts to your ledger the moment the invited account is created.
              </p>
              <div className="mt-5 flex items-center gap-2 rounded-xl border border-dashed border-border bg-surface px-3 py-2.5">
                <code className="flex-1 font-mono text-sm tracking-[0.14em]">{user.referralCode}</code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(user.referralCode);
                      toast.success("Referral code copied");
                    } catch {
                      toast.error("Clipboard unavailable");
                    }
                  }}
                >
                  <Copy className="h-3.5 w-3.5" /> Copy
                </Button>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Stat label="Invited" value={referred.length} hint="accounts" />
                <Stat label="Earned" value={`${points(referralBonus)} pts`} hint="lifetime" />
              </div>
            </Panel>
          </Reveal>
          <Reveal delay={0.05}>
            <Panel className="p-6">
              <h2 className="font-display text-base font-semibold">Invited workspaces</h2>
              {referred.length === 0 ? (
                <div className="mt-6 flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-10 text-center">
                  <Users className="h-6 w-6 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">No invites have landed yet.</p>
                </div>
              ) : (
                <ul className="mt-3 divide-y divide-border">
                  {referred.map((member) => (
                    <li key={member.id} className="flex items-center justify-between py-3">
                      <div>
                        <p className="text-[13px] font-medium">{member.name}</p>
                        <p className="text-[11px] text-muted-foreground">{member.email}</p>
                      </div>
                      <span className="inline-flex items-center gap-1 text-[11px] text-primary">
                        <Check className="h-3.5 w-3.5" /> joined
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </Reveal>
        </div>
      ) : null}
    </div>
  );
}
