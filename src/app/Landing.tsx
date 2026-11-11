import { motion } from "framer-motion";
import {
  ArrowRight,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  Fingerprint,
  KeyRound,
  LayoutGrid,
  Mail,
  Plane,
  ShieldCheck,
  Truck,
  Wallet,
} from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { EASE, Reveal, SectionLabel } from "@/platform/ui";
import { WORKSPACES } from "@/platform/model";
import { usePlatform } from "@/platform/Provider";
import { points } from "@/platform/format";

const ICONS = {
  personal: Wallet,
  shipments: Truck,
  ticketing: Plane,
  business: Building2,
  services: Mail,
} as const;

const CAPABILITIES: Record<string, string[]> = {
  personal: ["Points balance & history", "Vendor marketplace", "Order live chat", "Referral dashboard"],
  shipments: ["One-form creation wizard", "Live parcel tracker", "Public tracking link"],
  ticketing: ["Flight & hotel manager", "Invoice composer", "Print-ready receipts"],
  business: ["Tenant portal deployment", "KYC configuration", "Portal user management"],
  services: ["Template email composer", "Send-log monitor", "Graphics studio"],
};

function Nav() {
  const { user } = usePlatform();
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-lg">
      <div className="page-gutter mx-auto flex h-16 max-w-7xl items-center gap-6">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground">
            <LayoutGrid className="h-4 w-4" strokeWidth={2.4} />
          </span>
          <span className="leading-none">
            <span className="block font-display text-[17px] font-semibold">Cloudie</span>
            <span className="mt-1 block font-mono text-[9px] uppercase tracking-[0.24em] text-muted-foreground">
              Operations platform
            </span>
          </span>
        </Link>
        <nav className="ml-4 hidden items-center gap-6 text-[13px] text-muted-foreground md:flex">
          <a href="#workspaces" className="transition-colors hover:text-foreground">
            Workspaces
          </a>
          <a href="#ledger" className="transition-colors hover:text-foreground">
            Ledger
          </a>
          <a href="#security" className="transition-colors hover:text-foreground">
            Security
          </a>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {user ? (
            <Button asChild size="sm">
              <Link to="/app/personal">
                Open workspace <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
                <Link to="/auth">Sign in</Link>
              </Button>
              <Button asChild size="sm">
                <Link to="/auth?mode=register">
                  Start free <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 grid-field opacity-60" aria-hidden />
      <div className="page-gutter relative mx-auto grid max-w-7xl items-center gap-12 pb-16 pt-14 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16 lg:pb-24 lg:pt-20">
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE }}>
          <SectionLabel>Single sign-on · five workspaces</SectionLabel>
          <h1 className="mt-5 max-w-xl font-display text-[2.6rem] font-semibold leading-[1.02] tracking-[-0.03em] sm:text-6xl">
            One balance runs the whole operation.
          </h1>
          <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-muted-foreground">
            Cloudie consolidates logistics, travel documents, tenant portals and customer outreach into a single
            workspace architecture. Every action is priced, verified and written to one points ledger — before it
            commits.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button asChild size="lg" className="px-6">
              <Link to="/auth?mode=register">
                Create a workspace <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link to="/track/pub_demo_track">Track a live shipment</Link>
            </Button>
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-primary" /> Pre-flight ledger checks
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-primary" /> Installable PWA
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-primary" /> Print-ready PDFs
            </span>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, delay: 0.15, ease: EASE }}
          className="relative"
        >
          <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-2xl">
            <img
              src="https://images.unsplash.com/photo-1553413077-190dd305871c?auto=format&fit=crop&w=1200&q=70"
              alt="Warehouse floor with palletised freight"
              className="h-56 w-full object-cover sm:h-64"
              loading="eager"
            />
            <div className="space-y-4 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                    Shipment · CLD-8F42QK
                  </p>
                  <p className="mt-1 font-display text-lg font-semibold">Lagos → Accra</p>
                </div>
                <span className="rounded-full bg-primary/12 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-primary">
                  In transit
                </span>
              </div>
              <div className="flex items-center gap-2">
                {[0, 1, 2, 3, 4].map((index) => (
                  <div key={index} className="flex flex-1 items-center gap-2">
                    <span className={index < 3 ? "h-1.5 flex-1 rounded-full bg-primary" : "h-1.5 flex-1 rounded-full bg-border"} />
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between rounded-xl border border-border bg-surface px-3 py-2">
                <span className="text-xs text-muted-foreground">Cost verified at creation</span>
                <span className="font-mono text-xs font-medium">−346 pts</span>
              </div>
            </div>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.5, ease: EASE }}
            className="absolute -bottom-6 -left-3 w-56 rounded-2xl border border-border bg-elevated p-4 shadow-xl sm:-left-8"
          >
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Ledger balance</p>
            <p className="mt-1 font-display text-2xl font-semibold tabular-nums">
              4,820<span className="ml-1 text-xs font-medium text-muted-foreground">pts</span>
            </p>
            <p className="mt-1 text-[11px] text-[var(--brass)]">+5,000 pts · USDT top-up</p>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

function Workspaces() {
  return (
    <section id="workspaces" className="border-t border-border bg-surface/40 py-16 sm:py-24">
      <div className="page-gutter mx-auto max-w-7xl">
        <Reveal>
          <SectionLabel>Workspace architecture</SectionLabel>
          <div className="mt-4 flex flex-wrap items-end justify-between gap-6">
            <h2 className="max-w-xl font-display text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">
              Five modules, one context — switch without losing your place.
            </h2>
            <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
              Each workspace inherits the same session, the same balance and the same access rules. Nothing is
              re-authenticated, nothing is re-entered.
            </p>
          </div>
        </Reveal>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {WORKSPACES.map((workspace, index) => {
            const Icon = ICONS[workspace.id];
            return (
              <Reveal key={workspace.id} delay={index * 0.05}>
                <Link
                  to={workspace.route}
                  className="group flex h-full flex-col rounded-2xl border border-border bg-card p-5 transition-[transform,border-color,box-shadow] duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-lg"
                >
                  <div className="flex items-center justify-between">
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/12 text-primary">
                      <Icon className="h-5 w-5" />
                    </span>
                    <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                  </div>
                  <h3 className="mt-4 font-display text-lg font-semibold">{workspace.label}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{workspace.tagline}</p>
                  <ul className="mt-4 space-y-1.5 border-t border-border pt-4">
                    {CAPABILITIES[workspace.id].map((capability) => (
                      <li key={capability} className="flex items-start gap-2 text-[13px] text-muted-foreground">
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--brass)]" />
                        {capability}
                      </li>
                    ))}
                  </ul>
                </Link>
              </Reveal>
            );
          })}

          <Reveal delay={0.25}>
            <div className="flex h-full flex-col justify-between rounded-2xl border border-dashed border-border bg-card/60 p-5">
              <div>
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--brass-soft)] text-[var(--brass)]">
                  <ShieldCheck className="h-5 w-5" />
                </span>
                <h3 className="mt-4 font-display text-lg font-semibold">Shared guardrails</h3>
                <p className="mt-1 text-xs text-muted-foreground">Applies to every module, automatically.</p>
              </div>
              <ul className="mt-4 space-y-1.5">
                {["Session-bound auth", "Ownership ACL per record", "Sanitised input, filtered origin"].map((item) => (
                  <li key={item} className="flex items-start gap-2 text-[13px]">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function Ledger() {
  return (
    <section id="ledger" className="py-16 sm:py-24">
      <div className="page-gutter mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-2">
        <Reveal>
          <SectionLabel>Points ledger engine</SectionLabel>
          <h2 className="mt-4 font-display text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">
            Priced before it posts.
          </h2>
          <p className="mt-4 max-w-lg text-sm leading-relaxed text-muted-foreground">
            Charges are computed and verified against the customer balance before the record is committed. A shipment
            that cannot be funded is never written, and every deduction carries its own ledger line.
          </p>
          <div className="mt-6 space-y-3">
            {[
              { route: "POST /shipments/create", logic: "Quote → verify balance → write record" },
              { route: "POST /tickets/render", logic: "Deduct fixed points per document render" },
              { route: "POST /tenant/renew", logic: "Recurring billing per deployment cycle" },
              { route: "POST /services/email/send", logic: "Fee scales with recipient count" },
            ].map((row) => (
              <div key={row.route} className="flex flex-col gap-1 rounded-xl border border-border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <code className="font-mono text-[11px] text-primary">{row.route}</code>
                <span className="text-xs text-muted-foreground">{row.logic}</span>
              </div>
            ))}
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="rounded-3xl border border-border bg-card p-5 shadow-lg">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Ledger · this month</p>
              <span className="rounded-full bg-primary/12 px-2 py-0.5 font-mono text-[10px] text-primary">verified</span>
            </div>
            <ul className="divide-y divide-border">
              {[
                { reason: "Crypto top-up · USDT", amount: 5000, after: 5000 },
                { reason: "Shipment · Lagos → Accra", amount: -346, after: 4654 },
                { reason: "Flight itinerary render", amount: -45, after: 4609 },
                { reason: "Campaign · 3 recipients", amount: -6, after: 4603 },
                { reason: "Referral bonus", amount: 250, after: 4853 },
              ].map((row) => (
                <li key={row.reason} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="text-[13px] font-medium">{row.reason}</p>
                    <p className="font-mono text-[10px] text-muted-foreground">balance {points(row.after)} pts</p>
                  </div>
                  <span className={row.amount > 0 ? "font-mono text-sm text-primary" : "font-mono text-sm text-foreground"}>
                    {row.amount > 0 ? "+" : "−"}
                    {Math.abs(row.amount).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex items-center justify-between rounded-xl bg-surface px-3 py-2.5">
              <span className="text-xs text-muted-foreground">Commit rule</span>
              <span className="inline-flex items-center gap-1.5 font-mono text-[11px]">
                <KeyRound className="h-3.5 w-3.5 text-[var(--brass)]" /> balance ≥ charge
              </span>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Security() {
  const items = [
    { icon: Fingerprint, title: "Session binding", body: "Stateful session tokens prevent cross-workspace identity spoofing; every request resolves its own owner." },
    { icon: ShieldCheck, title: "Ownership ACL", body: "Resource-level verification at every route — a shipment, document or portal is only ever returned to its owner." },
    { icon: KeyRound, title: "Origin filtering", body: "Inbound payloads are validated and sanitised before they reach the ledger or the document engine." },
  ];
  return (
    <section id="security" className="border-t border-border bg-surface/40 py-16 sm:py-24">
      <div className="page-gutter mx-auto max-w-7xl">
        <Reveal>
          <SectionLabel>Security & access control</SectionLabel>
          <h2 className="mt-4 max-w-2xl font-display text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">
            Enterprise boundaries, without enterprise friction.
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {items.map((item, index) => (
            <Reveal key={item.title} delay={index * 0.06}>
              <div className="h-full rounded-2xl border border-border bg-card p-5">
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--brass-soft)] text-[var(--brass)]">
                  <item.icon className="h-4.5 w-4.5" />
                </span>
                <h3 className="mt-4 font-display text-base font-semibold">{item.title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{item.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function Closing() {
  return (
    <>
      <section className="page-gutter mx-auto max-w-7xl py-16 sm:py-20">
        <Reveal>
          <div className="grid gap-6 rounded-3xl border border-border bg-card p-8 sm:grid-cols-3 sm:p-10">
            {[
              { value: "5", label: "Integrated workspaces" },
              { value: "1", label: "Ledger across every module" },
              { value: "0", label: "Unverified charges" },
            ].map((stat) => (
              <div key={stat.label}>
                <p className="font-display text-4xl font-semibold tabular-nums">{stat.value}</p>
                <p className="mt-1 text-xs uppercase tracking-[0.14em] text-muted-foreground">{stat.label}</p>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      <section className="page-gutter mx-auto max-w-7xl pb-20">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl bg-primary px-6 py-14 text-primary-foreground sm:px-12">
            <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full border border-primary-foreground/20" aria-hidden />
            <div className="pointer-events-none absolute -bottom-28 right-24 h-64 w-64 rounded-full border border-primary-foreground/15" aria-hidden />
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] opacity-80">Ready when you are</p>
            <h2 className="mt-3 max-w-xl font-display text-3xl font-semibold sm:text-4xl">
              Bring shipments, documents and portals onto one balance.
            </h2>
            <div className="mt-7 flex flex-wrap gap-3">
              <Button asChild size="lg" variant="secondary" className="bg-background text-foreground hover:bg-background/90">
                <Link to="/auth?mode=register">
                  Start with 1,000 pts <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="border-primary-foreground/30 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
              >
                <Link to="/auth">Sign in to a workspace</Link>
              </Button>
            </div>
          </div>
        </Reveal>
      </section>
    </>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border py-10">
      <div className="page-gutter mx-auto flex max-w-7xl flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            <LayoutGrid className="h-4 w-4" />
          </span>
          <div>
            <p className="font-display text-sm font-semibold">Cloudie Operations</p>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Unified multi-workspace portal
            </p>
          </div>
        </div>
        <nav className="flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-muted-foreground">
          <a href="#workspaces" className="hover:text-foreground">Workspaces</a>
          <a href="#ledger" className="hover:text-foreground">Ledger</a>
          <a href="#security" className="hover:text-foreground">Security</a>
          <Link to="/track/pub_demo_track" className="hover:text-foreground">Tracking</Link>
        </nav>
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          © {new Date().getFullYear()} Cloudie
        </p>
      </div>
    </footer>
  );
}

export default function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <Nav />
      <Hero />
      <Workspaces />
      <Ledger />
      <Security />
      <Closing />
      <Footer />
    </div>
  );
}
