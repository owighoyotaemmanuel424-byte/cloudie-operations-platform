import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, Copy, MapPin, Package, Plus, RefreshCcw, Truck, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { usePlatform } from "@/platform/Provider";
import { advanceShipment, createShipment, quoteShipment } from "@/platform/engine";
import { SHIPMENT_STEPS, type Shipment, type ShipmentStatus } from "@/platform/model";
import { dateTime, points, relative, titleCase } from "@/platform/format";
import { EASE, Panel, Reveal, SectionLabel } from "@/platform/ui";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<ShipmentStatus, string> = {
  registered: "bg-surface-2 text-foreground",
  in_transit: "bg-primary/12 text-primary",
  customs: "bg-[var(--brass-soft)] text-[var(--brass)]",
  out_for_delivery: "bg-info/12 text-info",
  delivered: "bg-success/12 text-success",
  on_hold: "bg-destructive/12 text-destructive",
};

function progressOf(shipment: Shipment) {
  if (shipment.status === "delivered") return 100;
  if (shipment.status === "on_hold") return 45;
  const index = SHIPMENT_STEPS.findIndex((step) => step.id === shipment.status);
  return Math.max(12, ((index + 1) / SHIPMENT_STEPS.length) * 100);
}

export default function ShipmentsPage() {
  const { db, user } = usePlatform();
  const shipments = user ? db.shipments.filter((shipment) => shipment.userId === user.id) : [];
  const [selectedId, setSelectedId] = useState<string | null>(shipments[0]?.id ?? null);
  const [creating, setCreating] = useState(false);
  const selected = shipments.find((shipment) => shipment.id === selectedId) ?? shipments[0] ?? null;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <SectionLabel>Shipments workspace</SectionLabel>
          <h1 className="mt-2 font-display text-2xl font-semibold">Consignments & public tracking</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            One form to register freight. Points are verified against your balance before the record is written.
          </p>
        </div>
        <Button onClick={() => setCreating((value) => !value)}>
          {creating ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {creating ? "Close wizard" : "New shipment"}
        </Button>
      </div>

      <AnimatePresence initial={false}>
        {creating ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="overflow-hidden"
          >
            <ShipmentWizard
              onDone={(shipment) => {
                setCreating(false);
                setSelectedId(shipment.id);
              }}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
        <Reveal>
          <Panel className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
              <h2 className="font-display text-base font-semibold">Your consignments</h2>
              <Badge variant="secondary">{shipments.length}</Badge>
            </div>
            {shipments.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-5 py-14 text-center">
                <Truck className="h-6 w-6 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">No shipments yet — register your first consignment.</p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {shipments.map((shipment) => (
                  <li key={shipment.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(shipment.id)}
                      className={cn(
                        "w-full px-5 py-4 text-left transition-colors hover:bg-surface",
                        selected?.id === shipment.id && "bg-surface",
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-mono text-[11px] tracking-[0.1em] text-muted-foreground">{shipment.code}</p>
                          <p className="mt-0.5 truncate font-display text-[15px] font-semibold">
                            {shipment.origin} → {shipment.destination}
                          </p>
                        </div>
                        <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-[10px] font-medium", STATUS_TONE[shipment.status])}>
                          {titleCase(shipment.status)}
                        </span>
                      </div>
                      <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-border">
                        <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${progressOf(shipment)}%` }} />
                      </div>
                      <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>{shipment.recipientName} · {shipment.weightKg} kg</span>
                        <span>{relative(shipment.createdAt)}</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </Reveal>

        <Reveal delay={0.06}>
          {selected ? <ShipmentDetail shipment={selected} /> : <EmptyDetail />}
        </Reveal>
      </div>
    </div>
  );
}

function EmptyDetail() {
  return (
    <Panel className="flex min-h-[340px] flex-col items-center justify-center gap-2 p-6 text-center">
      <Package className="h-6 w-6 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">Register a consignment to see its live timeline.</p>
    </Panel>
  );
}

function ShipmentDetail({ shipment }: { shipment: Shipment }) {
  const [status, setStatus] = useState<ShipmentStatus>("in_transit");
  const [location, setLocation] = useState("");
  const [note, setNote] = useState("");

  async function copyLink() {
    const url = `${window.location.origin}/track/${shipment.publicToken}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Public tracking link copied");
    } catch {
      toast.error("Clipboard unavailable", { description: url });
    }
  }

  async function addUpdate() {
    const result = await advanceShipment(shipment.id, { status, location, note });
    if (result.ok) {
      setLocation("");
      setNote("");
      toast.success("Status pushed to the tracker");
    } else {
      toast.error(result.error);
    }
  }

  return (
    <Panel className="overflow-hidden">
      <div className="border-b border-border px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{shipment.code}</p>
            <h2 className="mt-0.5 font-display text-lg font-semibold">
              {shipment.origin} → {shipment.destination}
            </h2>
          </div>
          <span className={cn("rounded-full px-2.5 py-1 text-[10px] font-medium", STATUS_TONE[shipment.status])}>
            {titleCase(shipment.status)}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {shipment.service} service</span>
          <span>{shipment.weightKg} kg</span>
          <span>{points(shipment.costPoints)} pts</span>
          <span>Recipient: {shipment.recipientName}</span>
        </div>
        <Button size="sm" variant="outline" className="mt-3" onClick={copyLink}>
          <Copy className="h-3.5 w-3.5" /> Copy public tracking link
        </Button>
      </div>

      <div className="max-h-[260px] space-y-4 overflow-y-auto px-5 py-4">
        {shipment.events.map((event, index) => (
          <div key={event.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className={cn("mt-1 h-2 w-2 rounded-full", index === shipment.events.length - 1 ? "bg-primary" : "bg-border")} />
              {index < shipment.events.length - 1 ? <span className="mt-1 w-px flex-1 bg-border" /> : null}
            </div>
            <div className="pb-1">
              <p className="text-[13px] font-medium">{event.label}</p>
              <p className="text-[11px] text-muted-foreground">{event.location} · {dateTime(event.at)}</p>
              {event.note ? <p className="mt-0.5 text-[11px] text-muted-foreground">{event.note}</p> : null}
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-border bg-surface/50 px-5 py-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Push a status update</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <Select value={status} onValueChange={(value) => setStatus(value as ShipmentStatus)}>
            <SelectTrigger aria-label="Status"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[...SHIPMENT_STEPS, { id: "on_hold" as ShipmentStatus, label: "On hold" }].map((step) => (
                <SelectItem key={step.id} value={step.id}>{step.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Location (e.g. Accra hub)" />
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Optional note shown on the public tracker"
            className="sm:col-span-2"
            rows={2}
          />
        </div>
        <Button size="sm" className="mt-2" onClick={addUpdate}>
          <RefreshCcw className="h-3.5 w-3.5" /> Publish update
        </Button>
      </div>
    </Panel>
  );
}

function ShipmentWizard({ onDone }: { onDone: (shipment: Shipment) => void }) {
  const { user } = usePlatform();
  const [step, setStep] = useState(0);
  const [origin, setOrigin] = useState("Lagos, NG");
  const [destination, setDestination] = useState("Accra, GH");
  const [service, setService] = useState<Shipment["service"]>("express");
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [contents, setContents] = useState("");
  const [weight, setWeight] = useState("2");
  const [declaredValue, setDeclaredValue] = useState("120000");

  const weightKg = Number(weight) || 0;
  const cost = quoteShipment(weightKg, service);
  const affordable = (user?.points ?? 0) >= cost;

  async function submit() {
    const result = await createShipment({
      origin,
      destination,
      recipientName,
      recipientPhone,
      contents,
      weightKg: Math.max(0.5, weightKg),
      declaredValue: Number(declaredValue) || 0,
      service,
    });
    if (result.ok) {
      toast.success(`${result.value.code} registered`, { description: `${points(cost)} pts deducted from your ledger.` });
      onDone(result.value);
    } else {
      toast.error(result.error);
    }
  }

  const steps = ["Route", "Parcel", "Confirm"];

  return (
    <Panel className="mb-5 p-5">
      <div className="flex items-center gap-2">
        {steps.map((label, index) => (
          <div key={label} className="flex flex-1 items-center gap-2">
            <span
              className={cn(
                "grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold",
                index <= step ? "bg-primary text-primary-foreground" : "bg-surface-2 text-muted-foreground",
              )}
            >
              {index < step ? <Check className="h-3.5 w-3.5" /> : index + 1}
            </span>
            <span className={cn("text-[11px]", index <= step ? "text-foreground" : "text-muted-foreground")}>{label}</span>
            {index < steps.length - 1 ? <span className="h-px flex-1 bg-border" /> : null}
          </div>
        ))}
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {step === 0 ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="origin">Origin</Label>
              <Input id="origin" value={origin} onChange={(event) => setOrigin(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="destination">Destination</Label>
              <Input id="destination" value={destination} onChange={(event) => setDestination(event.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Service level</Label>
              <Select value={service} onValueChange={(value) => setService(value as Shipment["service"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="express">Express · priority handling</SelectItem>
                  <SelectItem value="economy">Economy · consolidated</SelectItem>
                  <SelectItem value="freight">Freight · palletised</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </>
        ) : null}

        {step === 1 ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="recipient">Recipient name</Label>
              <Input id="recipient" value={recipientName} onChange={(event) => setRecipientName(event.target.value)} placeholder="Kofi Mensah" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Recipient phone</Label>
              <Input id="phone" value={recipientPhone} onChange={(event) => setRecipientPhone(event.target.value)} placeholder="+233 …" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="contents">Contents</Label>
              <Input id="contents" value={contents} onChange={(event) => setContents(event.target.value)} placeholder="Printed catalogues · 3 cartons" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="weight">Weight (kg)</Label>
              <Input id="weight" type="number" min="0.5" step="0.5" value={weight} onChange={(event) => setWeight(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="value">Declared value (₦)</Label>
              <Input id="value" type="number" min="0" value={declaredValue} onChange={(event) => setDeclaredValue(event.target.value)} />
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <div className="sm:col-span-2">
            <div className="rounded-xl border border-border bg-surface px-4 py-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Ledger charge</span>
                <span className="font-mono text-sm font-semibold">{points(cost)} pts</span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Balance available</span>
                <span className="font-mono text-sm">{points(user?.points ?? 0)} pts</span>
              </div>
              <div className={cn("mt-2 rounded-lg px-2.5 py-1.5 text-[11px]", affordable ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive")}>
                {affordable
                  ? "Pre-flight check passed — the charge will be deducted before the shipment is written."
                  : "Insufficient points. Top up in the Personal workspace before registering."}
              </div>
            </div>
            <dl className="mt-3 grid gap-2 text-[12px] sm:grid-cols-2">
              {[
                ["Route", `${origin} → ${destination}`],
                ["Service", titleCase(service)],
                ["Recipient", recipientName || "—"],
                ["Parcel", `${weightKg} kg · ${contents || "unlisted contents"}`],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-border px-3 py-2">
                  <dt className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">{label}</dt>
                  <dd className="mt-0.5">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => setStep((value) => Math.max(0, value - 1))} disabled={step === 0}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        {step < 2 ? (
          <Button size="sm" onClick={() => setStep((value) => value + 1)}>
            Continue <ArrowRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button size="sm" onClick={submit} disabled={!affordable}>
            <Check className="h-4 w-4" /> Register · {points(cost)} pts
          </Button>
        )}
      </div>
    </Panel>
  );
}
