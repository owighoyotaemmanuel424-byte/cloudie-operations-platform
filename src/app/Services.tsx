import { motion } from "framer-motion";
import { Download, ImageIcon, Mail, Send, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { usePlatform } from "@/platform/Provider";
import { PRICING, quoteCampaign, sendCampaign } from "@/platform/engine";
import { dateTime, points } from "@/platform/format";
import { EASE, Panel, Reveal, SectionLabel } from "@/platform/ui";
import { cn } from "@/lib/utils";

type Tab = "compose" | "log" | "studio";

const TEMPLATES = [
  {
    id: "delivery",
    label: "Delivery notice",
    subject: "Your consignment arrives Thursday",
    body: "Hello {{name}},\n\nYour consignment {{code}} is cleared for delivery on Thursday between 09:00 and 13:00.\n\n— Cloudie Desk",
  },
  {
    id: "invoice",
    label: "Invoice follow-up",
    subject: "Invoice {{code}} is ready",
    body: "Hello {{name}},\n\nInvoice {{code}} has been rendered and is attached to your workspace.\n\n— Cloudie Desk",
  },
  {
    id: "onboarding",
    label: "Portal onboarding",
    subject: "Your portal is live",
    body: "Hello {{name}},\n\nYour banking portal is live. Sign in, complete KYC and invite your team.\n\n— Cloudie Desk",
  },
];

const TABS: { id: Tab; label: string; icon: typeof Mail }[] = [
  { id: "compose", label: "Compose", icon: Mail },
  { id: "log", label: "Send log", icon: Send },
  { id: "studio", label: "Studio", icon: ImageIcon },
];

export default function ServicesPage() {
  const { db, user } = usePlatform();
  const campaigns = user ? db.campaigns.filter((campaign) => campaign.userId === user.id) : [];
  const [tab, setTab] = useState<Tab>("compose");

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <SectionLabel>Services workspace</SectionLabel>
        <h1 className="mt-2 font-display text-2xl font-semibold">Outreach & rendering studio</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Template-based email dispatch priced per recipient, with a send log and a graphics studio for campaign assets.
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
            <item.icon className="h-3.5 w-3.5" /> {item.label}
          </button>
        ))}
      </div>

      {tab === "compose" ? <Composer /> : null}
      {tab === "log" ? <SendLog campaigns={campaigns} /> : null}
      {tab === "studio" ? <Studio /> : null}
    </div>
  );
}

function Composer() {
  const { user } = usePlatform();
  const template = TEMPLATES[0];
  const [templateId, setTemplateId] = useState(template.id);
  const [subject, setSubject] = useState(template.subject);
  const [body, setBody] = useState(template.body);
  const [recipients, setRecipients] = useState("ops@meridian.africa\nkofi@accraimports.gh");

  const list = useMemo(
    () => Array.from(new Set(recipients.split(/[\n,;]+/).map((value) => value.trim()).filter(Boolean))),
    [recipients],
  );
  const cost = quoteCampaign(list.length);
  const affordable = (user?.points ?? 0) >= cost;

  function pick(id: string) {
    const next = TEMPLATES.find((item) => item.id === id);
    if (!next) return;
    setTemplateId(next.id);
    setSubject(next.subject);
    setBody(next.body);
  }

  async function dispatch() {
    const result = await sendCampaign({ template: templateId, subject, body, recipients: list });
    if (result.ok) toast.success("Campaign dispatched", { description: `${list.length} recipients · ${points(cost)} pts.` });
    else toast.error(result.error);
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
      <Reveal>
        <Panel className="p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Template</Label>
              <Select value={templateId} onValueChange={pick}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TEMPLATES.map((item) => (
                    <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="subject">Subject</Label>
              <Input id="subject" value={subject} onChange={(event) => setSubject(event.target.value)} />
            </div>
          </div>

          <div className="mt-3 space-y-1.5">
            <Label htmlFor="body">Body</Label>
            <Textarea id="body" rows={8} value={body} onChange={(event) => setBody(event.target.value)} />
            <p className="text-[11px] text-muted-foreground">
              Merge tokens: <code className="font-mono text-foreground">{"{{name}}"}</code> ·{" "}
              <code className="font-mono text-foreground">{"{{code}}"}</code>
            </p>
          </div>

          <div className="mt-3 space-y-1.5">
            <Label htmlFor="recipients">Recipients · one per line</Label>
            <Textarea id="recipients" rows={4} value={recipients} onChange={(event) => setRecipients(event.target.value)} />
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-3 py-2.5">
            <p className="text-[11px] text-muted-foreground">
              {list.length} recipients × {PRICING.campaignPerRecipient} pts ={" "}
              <span className="font-mono text-foreground">{points(cost)} pts</span>
              {!affordable ? <span className="ml-1 text-destructive">· insufficient balance</span> : null}
            </p>
            <Button size="sm" onClick={dispatch} disabled={!affordable || list.length === 0}>
              <Send className="h-3.5 w-3.5" /> Verify & dispatch
            </Button>
          </div>
        </Panel>
      </Reveal>

      <Reveal delay={0.05}>
        <Panel className="p-5">
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-[var(--brass)]" />
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Live preview</p>
          </div>
          <div className="mt-3 rounded-xl border border-border bg-surface p-4">
            <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">From Cloudie Desk</p>
            <p className="mt-1 font-display text-[15px] font-semibold">{subject || "Untitled campaign"}</p>
            <div className="mt-3 whitespace-pre-wrap text-[13px] leading-relaxed text-muted-foreground">
              {body.replace(/\{\{name\}\}/g, "Kofi").replace(/\{\{code\}\}/g, "CLD-8F42QK")}
            </div>
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Fees are computed from the deduplicated recipient set before the campaign is written to the log.
          </p>
        </Panel>
      </Reveal>
    </div>
  );
}

function SendLog({ campaigns }: { campaigns: import("@/platform/model").Campaign[] }) {
  return (
    <Reveal>
      <Panel className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h2 className="font-display text-base font-semibold">Send log</h2>
          <Badge variant="secondary">{campaigns.length} campaigns</Badge>
        </div>
        {campaigns.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-muted-foreground">No campaigns dispatched yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {campaigns.map((campaign) => (
              <li key={campaign.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-[13px] font-semibold">{campaign.subject}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {campaign.recipients.length} recipients · {dateTime(campaign.sentAt)} · {campaign.template}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">{campaign.status}</span>
                    <p className="mt-1 font-mono text-[10px] text-muted-foreground">{points(campaign.pointsCharged)} pts</p>
                  </div>
                </div>
                <p className="mt-2 truncate text-[11px] text-muted-foreground">
                  {campaign.recipients.slice(0, 4).join(", ")}
                  {campaign.recipients.length > 4 ? ` +${campaign.recipients.length - 4} more` : ""}
                </p>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-border">
                  <div className="h-full rounded-full bg-[var(--brass)]" style={{ width: `${Math.min(100, (campaign.opens / Math.max(1, campaign.recipients.length)) * 100)}%` }} />
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">{campaign.opens} opens tracked</p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </Reveal>
  );
}

function Studio() {
  const [headline, setHeadline] = useState("Freight that keeps its promise");
  const [eyebrow, setEyebrow] = useState("Cloudie · Lagos → Accra");
  const [tone, setTone] = useState<"pine" | "brass" | "ink">("pine");

  const palette = {
    pine: { bg: "#0f2a22", ink: "#f2f8f4", accent: "#e5b769" },
    brass: { bg: "#c08a3e", ink: "#1c1408", accent: "#0f2a22" },
    ink: { bg: "#111614", ink: "#edf5ef", accent: "#7ddcb8" },
  }[tone];

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${palette.bg}"/>
  <g stroke="${palette.ink}" stroke-opacity="0.12">
    ${Array.from({ length: 18 }, (_, index) => `<line x1="${index * 70}" y1="0" x2="${index * 70}" y2="630"/>`).join("")}
  </g>
  <circle cx="1030" cy="120" r="210" fill="none" stroke="${palette.accent}" stroke-opacity="0.5"/>
  <text x="80" y="230" fill="${palette.accent}" font-family="monospace" font-size="22" letter-spacing="6">${escapeXml(eyebrow.toUpperCase())}</text>
  <text x="80" y="330" fill="${palette.ink}" font-family="Georgia, serif" font-size="64">${escapeXml(headline.slice(0, 28))}</text>
  <text x="80" y="392" fill="${palette.ink}" font-family="Georgia, serif" font-size="64">${escapeXml(headline.slice(28, 56))}</text>
  <text x="80" y="540" fill="${palette.ink}" fill-opacity="0.7" font-family="monospace" font-size="20">cloudie.africa · verified points ledger</text>
</svg>`;

  function download() {
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = "cloudie-campaign.svg";
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success("Asset exported");
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
      <Reveal>
        <Panel className="space-y-3 p-5">
          <div className="flex items-center gap-1.5">
            <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Studio controls</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="eyebrow">Eyebrow</Label>
            <Input id="eyebrow" value={eyebrow} onChange={(event) => setEyebrow(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="headline">Headline</Label>
            <Textarea id="headline" rows={2} value={headline} onChange={(event) => setHeadline(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Palette</Label>
            <div className="flex gap-2">
              {(["pine", "brass", "ink"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setTone(option)}
                  className={cn(
                    "flex-1 rounded-lg border px-2 py-1.5 text-[11px] capitalize transition-colors",
                    tone === option ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground",
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
          <Button size="sm" className="w-full" onClick={download}>
            <Download className="h-3.5 w-3.5" /> Export asset
          </Button>
          <p className="text-[11px] text-muted-foreground">1200 × 630 · SVG, ready for email headers and social.</p>
        </Panel>
      </Reveal>

      <Reveal delay={0.05}>
        <motion.div
          key={tone + headline}
          initial={{ opacity: 0.6 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, ease: EASE }}
          className="overflow-hidden rounded-2xl border border-border bg-card p-3"
        >
          <div className="overflow-hidden rounded-xl" dangerouslySetInnerHTML={{ __html: svg }} />
        </motion.div>
      </Reveal>
    </div>
  );
}

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
