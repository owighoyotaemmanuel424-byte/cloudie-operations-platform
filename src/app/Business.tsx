import { motion } from "framer-motion";
import {
  ArrowUpRight,
  Building2,
  CalendarClock,
  Check,
  Globe2,
  Plus,
  RefreshCcw,
  ShieldCheck,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { usePlatform } from "@/platform/Provider";
import {
  PRICING,
  deploySite,
  invitePortalUser,
  removePortalUser,
  renewSite,
  updateSiteConfig,
} from "@/platform/engine";
import type { SitePlan, TenantSite } from "@/platform/model";
import { countdown, dateTime, points, shortDate } from "@/platform/format";
import { EASE, Panel, Reveal, SectionLabel } from "@/platform/ui";
import { cn } from "@/lib/utils";

const PLANS: { id: SitePlan; label: string; detail: string }[] = [
  { id: "starter", label: "Starter", detail: "Single product portal · up to 250 customers" },
  { id: "growth", label: "Growth", detail: "Banking + investments · up to 2,000 customers" },
  { id: "scale", label: "Scale", detail: "Multi-product, custom domains, priority desk" },
];

export default function BusinessPage() {
  const { db, user } = usePlatform();
  const sites = user ? db.sites.filter((site) => site.userId === user.id) : [];
  const [selectedId, setSelectedId] = useState<string | null>(sites[0]?.id ?? null);
  const [deploying, setDeploying] = useState(false);
  const selected = sites.find((site) => site.id === selectedId) ?? sites[0] ?? null;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <SectionLabel>Business suite</SectionLabel>
          <h1 className="mt-2 font-display text-2xl font-semibold">Tenant portals & KYC</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Deploy a white-label banking or investment portal, configure KYC and manage its users. Renewal bills
            recur per deployment cycle.
          </p>
        </div>
        <Button onClick={() => setDeploying((value) => !value)}>
          {deploying ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {deploying ? "Cancel" : "Deploy portal"}
        </Button>
      </div>

      {deploying ? (
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: EASE }}>
          <DeployForm
            onDone={(site) => {
              setDeploying(false);
              setSelectedId(site.id);
            }}
          />
        </motion.div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <Reveal>
          <div className="space-y-3">
            {sites.length === 0 ? (
              <Panel className="flex flex-col items-center gap-2 px-5 py-14 text-center">
                <Building2 className="h-6 w-6 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">No portals deployed yet.</p>
              </Panel>
            ) : (
              sites.map((site) => (
                <button
                  key={site.id}
                  type="button"
                  onClick={() => setSelectedId(site.id)}
                  className={cn(
                    "w-full rounded-2xl border bg-card p-4 text-left transition-[border-color,background-color] hover:border-primary/40",
                    selected?.id === site.id ? "border-primary/50 bg-surface" : "border-border",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-display text-[15px] font-semibold">{site.name}</p>
                      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">/t/{site.slug}</p>
                    </div>
                    <Badge variant={site.status === "live" ? "default" : "secondary"} className="text-[10px]">
                      {site.status === "live" ? "live" : site.status.replace("_", " ")}
                    </Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                    <span className="capitalize">{site.plan} plan</span>
                    <span>{site.users.length} users</span>
                    <span className="inline-flex items-center gap-1">
                      <CalendarClock className="h-3 w-3" /> renews in {countdown(site.renewsAt)}
                    </span>
                    {site.kycRequired ? <span>KYC {site.kycLevel}</span> : <span>No KYC</span>}
                  </div>
                </button>
              ))
            )}
          </div>
        </Reveal>

        <Reveal delay={0.05}>
          {selected ? (
            <SiteDetail site={selected} />
          ) : (
            <Panel className="flex min-h-[320px] flex-col items-center justify-center gap-2 text-center">
              <Globe2 className="h-6 w-6 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Deploy a portal to manage its configuration.</p>
            </Panel>
          )}
        </Reveal>
      </div>
    </div>
  );
}

function DeployForm({ onDone }: { onDone: (site: TenantSite) => void }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [plan, setPlan] = useState<SitePlan>("growth");
  const [kycRequired, setKycRequired] = useState(true);
  const [kycLevel, setKycLevel] = useState<"basic" | "enhanced">("enhanced");
  const [bankingEnabled, setBankingEnabled] = useState(true);
  const [investmentEnabled, setInvestmentEnabled] = useState(false);

  const setup = PRICING.siteSetup[plan];
  const renewal = PRICING.siteRenewal[plan];

  async function submit() {
    const result = await deploySite({ name, slug, plan, kycRequired, kycLevel, bankingEnabled, investmentEnabled });
    if (result.ok) {
      toast.success(`${result.value.name} deployed`, { description: `${points(setup)} pts deducted · renews in 30 days.` });
      onDone(result.value);
    } else toast.error(result.error);
  }

  return (
    <Panel className="p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="site-name">Portal name</Label>
          <Input
            id="site-name"
            value={name}
            placeholder="Meridian Capital"
            onChange={(event) => {
              setName(event.target.value);
              setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="site-slug">Address</Label>
          <Input id="site-slug" value={slug} placeholder="meridian" onChange={(event) => setSlug(event.target.value)} />
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {PLANS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setPlan(option.id)}
            className={cn(
              "rounded-xl border p-3 text-left transition-colors",
              plan === option.id ? "border-primary bg-primary/8" : "border-border hover:border-primary/30",
            )}
          >
            <p className="text-[13px] font-semibold">{option.label}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{option.detail}</p>
            <p className="mt-2 font-mono text-[10px]">{points(PRICING.siteSetup[option.id])} pts setup</p>
          </button>
        ))}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="flex items-center justify-between rounded-xl border border-border px-3 py-2.5">
          <span>
            <span className="block text-[13px] font-medium">KYC required</span>
            <span className="block text-[11px] text-muted-foreground">Gate portal access behind verification</span>
          </span>
          <Switch checked={kycRequired} onCheckedChange={setKycRequired} aria-label="KYC required" />
        </label>
        <label className="flex items-center justify-between rounded-xl border border-border px-3 py-2.5">
          <span>
            <span className="block text-[13px] font-medium">Banking product</span>
            <span className="block text-[11px] text-muted-foreground">Accounts, transfers and balances</span>
          </span>
          <Switch checked={bankingEnabled} onCheckedChange={setBankingEnabled} aria-label="Banking enabled" />
        </label>
        <label className="flex items-center justify-between rounded-xl border border-border px-3 py-2.5">
          <span>
            <span className="block text-[13px] font-medium">Investment product</span>
            <span className="block text-[11px] text-muted-foreground">Portfolios and statements</span>
          </span>
          <Switch checked={investmentEnabled} onCheckedChange={setInvestmentEnabled} aria-label="Investment enabled" />
        </label>
        <div className="flex items-center justify-between gap-2 rounded-xl border border-border px-3 py-2.5">
          <span className="text-[13px] font-medium">KYC level</span>
          <Select value={kycLevel} onValueChange={(value) => setKycLevel(value as "basic" | "enhanced")}>
            <SelectTrigger className="h-8 w-32" aria-label="KYC level"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="basic">Basic</SelectItem>
              <SelectItem value="enhanced">Enhanced</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface px-3 py-2.5">
        <p className="text-[11px] text-muted-foreground">
          Setup <span className="font-mono text-foreground">{points(setup)} pts</span> · renewal{" "}
          <span className="font-mono text-foreground">{points(renewal)} pts</span> every 30 days
        </p>
        <Button size="sm" onClick={submit} disabled={!name.trim() || slug.length < 3}>
          <ShieldCheck className="h-3.5 w-3.5" /> Verify & deploy
        </Button>
      </div>
    </Panel>
  );
}

function SiteDetail({ site }: { site: TenantSite }) {
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"staff" | "viewer">("staff");

  async function toggle(key: "kycRequired" | "bankingEnabled" | "investmentEnabled", value: boolean) {
    const result = await updateSiteConfig(site.id, { [key]: value });
    if (result.ok) toast.success("Portal configuration saved");
    else toast.error(result.error);
  }

  async function renew() {
    const result = await renewSite(site.id);
    if (result.ok) toast.success(`${site.name} renewed`, { description: `${site.renewalPoints} pts deducted.` });
    else toast.error(result.error);
  }

  async function invite() {
    const result = await invitePortalUser(site.id, { name: inviteName, email: inviteEmail, role: inviteRole });
    if (result.ok) {
      setInviteName("");
      setInviteEmail("");
      toast.success("Portal user invited");
    } else toast.error(result.error);
  }

  return (
    <Panel className="overflow-hidden">
      <div className="border-b border-border px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Deployed portal</p>
            <h2 className="mt-0.5 font-display text-lg font-semibold">{site.name}</h2>
            <a
              href={`/t/${site.slug}`}
              className="mt-1 inline-flex items-center gap-1 font-mono text-[11px] text-primary hover:underline"
            >
              /t/{site.slug} <ArrowUpRight className="h-3 w-3" />
            </a>
          </div>
          <div className="text-right">
            <Badge variant={site.status === "live" ? "default" : "secondary"} className="text-[10px]">
              {site.status === "live" ? "live" : site.status.replace("_", " ")}
            </Badge>
            <p className="mt-1 text-[11px] text-muted-foreground">renews {shortDate(site.renewsAt)}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" onClick={renew}>
            <RefreshCcw className="h-3.5 w-3.5" /> Renew · {points(site.renewalPoints)} pts
          </Button>
          <Button size="sm" variant="outline" asChild>
            <a href={`/t/${site.slug}`}><Globe2 className="h-3.5 w-3.5" /> Open portal</a>
          </Button>
        </div>
      </div>

      <div className="space-y-2 px-5 py-4">
        {[
          { key: "kycRequired" as const, label: "KYC verification", detail: site.kycRequired ? `${site.kycLevel} checks before access` : "Open access", value: site.kycRequired },
          { key: "bankingEnabled" as const, label: "Banking product", detail: "Accounts, transfers, statements", value: site.bankingEnabled },
          { key: "investmentEnabled" as const, label: "Investment product", detail: "Portfolios and performance", value: site.investmentEnabled },
        ].map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5">
            <div>
              <p className="text-[13px] font-medium">{row.label}</p>
              <p className="text-[11px] text-muted-foreground">{row.detail}</p>
            </div>
            <Switch checked={row.value} onCheckedChange={(value) => toggle(row.key, value)} aria-label={row.label} />
          </div>
        ))}
      </div>

      <div className="border-t border-border px-5 py-4">
        <div className="flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5 text-muted-foreground" />
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Portal users</p>
        </div>
        <ul className="mt-2 divide-y divide-border">
          {site.users.map((member) => (
            <li key={member.id} className="flex items-center justify-between gap-3 py-2">
              <div>
                <p className="text-[13px] font-medium">{member.name}</p>
                <p className="text-[11px] text-muted-foreground">{member.email} · {member.role}</p>
              </div>
              {member.role === "owner" ? (
                <span className="inline-flex items-center gap-1 text-[10px] text-primary"><Check className="h-3 w-3" /> owner</span>
              ) : (
                <Button size="icon-sm" variant="ghost" aria-label={`Remove ${member.name}`} onClick={() => void removePortalUser(site.id, member.id)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </li>
          ))}
        </ul>
        <form
          className="mt-3 grid gap-2 sm:grid-cols-[1fr_1.2fr_auto_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            invite();
          }}
        >
          <Input value={inviteName} onChange={(event) => setInviteName(event.target.value)} placeholder="Name" aria-label="Invite name" />
          <Input value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="name@bank.com" aria-label="Invite email" />
          <Select value={inviteRole} onValueChange={(value) => setInviteRole(value as "staff" | "viewer")}>
            <SelectTrigger className="sm:w-24" aria-label="Invite role"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="staff">Staff</SelectItem>
              <SelectItem value="viewer">Viewer</SelectItem>
            </SelectContent>
          </Select>
          <Button type="submit" size="sm"><UserPlus className="h-3.5 w-3.5" /> Invite</Button>
        </form>
        <p className="mt-2 text-[10px] text-muted-foreground">Deployed {dateTime(site.createdAt)}</p>
      </div>
    </Panel>
  );
}
