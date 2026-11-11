import { motion } from "framer-motion";
import { FileText, Hotel, Plane, Plus, Receipt, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePlatform } from "@/platform/Provider";
import { PRICING, createDocument } from "@/platform/engine";
import type { DocumentKind, TravelDocument } from "@/platform/model";
import { dateTime, points } from "@/platform/format";
import { EASE, Panel, Reveal, SectionLabel } from "@/platform/ui";
import { cn } from "@/lib/utils";
import { DocumentSheet } from "./DocumentSheet";

type Tab = "documents" | "flight" | "hotel" | "invoice";

const TABS: { id: Tab; label: string; icon: typeof Plane }[] = [
  { id: "documents", label: "Documents", icon: FileText },
  { id: "flight", label: "Flight", icon: Plane },
  { id: "hotel", label: "Hotel", icon: Hotel },
  { id: "invoice", label: "Invoice", icon: Receipt },
];

export default function TicketingPage() {
  const { db, user } = usePlatform();
  const documents = user ? db.documents.filter((document) => document.userId === user.id) : [];
  const [tab, setTab] = useState<Tab>("documents");
  const [selectedId, setSelectedId] = useState<string | null>(documents[0]?.id ?? null);
  const selected = documents.find((document) => document.id === selectedId) ?? documents[0] ?? null;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <SectionLabel>Ticketing workspace</SectionLabel>
        <h1 className="mt-2 font-display text-2xl font-semibold">Travel documents & invoices</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Compose a booking, then render it through the native document engine. Each render draws fixed points.
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

      {tab === "documents" ? (
        <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
          <Reveal>
            <Panel className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h2 className="font-display text-sm font-semibold">Rendered documents</h2>
                <Badge variant="secondary">{documents.length}</Badge>
              </div>
              {documents.length === 0 ? (
                <p className="px-4 py-8 text-center text-xs text-muted-foreground">
                  Nothing rendered yet — compose a flight, hotel stay or invoice.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {documents.map((document) => (
                    <li key={document.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(document.id)}
                        className={cn(
                          "w-full px-4 py-3 text-left transition-colors hover:bg-surface",
                          selected?.id === document.id && "bg-surface",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-[13px] font-medium">{document.title}</p>
                          <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em]">
                            {document.kind}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {document.passenger || "—"} · {dateTime(document.createdAt)}
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </Reveal>
          <Reveal delay={0.05}>
            {selected ? (
              <DocumentSheet document={selected} />
            ) : (
              <Panel className="flex min-h-[300px] flex-col items-center justify-center gap-2 text-center">
                <FileText className="h-6 w-6 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Select a document to preview the print sheet.</p>
              </Panel>
            )}
          </Reveal>
        </div>
      ) : null}

      {tab === "flight" ? <FlightComposer onCreated={(document) => { setSelectedId(document.id); setTab("documents"); }} /> : null}
      {tab === "hotel" ? <HotelComposer onCreated={(document) => { setSelectedId(document.id); setTab("documents"); }} /> : null}
      {tab === "invoice" ? <InvoiceComposer onCreated={(document) => { setSelectedId(document.id); setTab("documents"); }} /> : null}
    </div>
  );
}

function CostBar({ kind, onRender, disabled }: { kind: DocumentKind; onRender: () => void; disabled?: boolean }) {
  const { user } = usePlatform();
  const cost = PRICING.document[kind];
  const affordable = (user?.points ?? 0) >= cost;
  return (
    <div className="sm:col-span-2 mt-1 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-3 py-2.5">
      <div className="text-[11px] text-muted-foreground">
        Render fee <span className="font-mono text-foreground">{points(cost)} pts</span> · balance {points(user?.points ?? 0)} pts
        {!affordable ? <span className="ml-1 text-destructive">· insufficient</span> : null}
      </div>
      <Button size="sm" onClick={onRender} disabled={disabled || !affordable}>
        <ShieldCheck className="h-3.5 w-3.5" /> Verify & render
      </Button>
    </div>
  );
}

function Field({ id, label, value, onChange, placeholder, type = "text" }: {
  id: string; label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function ComposerShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }}>
      <Panel className="p-5">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/12 text-primary"><Plus className="h-4 w-4" /></span>
          <div>
            <h2 className="font-display text-base font-semibold">{title}</h2>
            <p className="text-[11px] text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">{children}</div>
      </Panel>
    </motion.div>
  );
}

function FlightComposer({ onCreated }: { onCreated: (document: TravelDocument) => void }) {
  const [passenger, setPassenger] = useState("");
  const [carrier, setCarrier] = useState("Kenya Airways · KQ 533");
  const [route, setRoute] = useState("Lagos (LOS) → Accra (ACC)");
  const [departure, setDeparture] = useState("12 Dec 2026 · 08:40 WAT");
  const [arrival, setArrival] = useState("12 Dec 2026 · 10:05 GMT");
  const [fare, setFare] = useState("386000");

  async function render() {
    const result = await createDocument({
      kind: "flight",
      title: `Flight itinerary · ${route.split("→")[0].trim()}`,
      passenger,
      reference: `KQ-${Date.now().toString().slice(-6)}`,
      lines: [
        { label: "Carrier", value: carrier },
        { label: "Route", value: route },
        { label: "Departure", value: departure },
        { label: "Arrival", value: arrival },
      ],
      total: Number(fare) || null,
      currency: "NGN",
    });
    if (result.ok) {
      toast.success("Itinerary rendered", { description: `${PRICING.document.flight} pts deducted.` });
      onCreated(result.value);
    } else toast.error(result.error);
  }

  return (
    <ComposerShell title="Flight booking manager" subtitle="Compose an itinerary, then render a print-ready PDF">
      <Field id="passenger" label="Passenger" value={passenger} onChange={setPassenger} placeholder="Amara Okonjo" />
      <Field id="carrier" label="Carrier & flight" value={carrier} onChange={setCarrier} />
      <Field id="route" label="Route" value={route} onChange={setRoute} />
      <Field id="fare" label="Fare (₦)" type="number" value={fare} onChange={setFare} />
      <Field id="departure" label="Departure" value={departure} onChange={setDeparture} />
      <Field id="arrival" label="Arrival" value={arrival} onChange={setArrival} />
      <CostBar kind="flight" onRender={render} disabled={!passenger.trim()} />
    </ComposerShell>
  );
}

function HotelComposer({ onCreated }: { onCreated: (document: TravelDocument) => void }) {
  const [guest, setGuest] = useState("");
  const [hotel, setHotel] = useState("Kempinski Gold Coast City");
  const [nights, setNights] = useState("3");
  const [checkIn, setCheckIn] = useState("12 Dec 2026");
  const [checkOut, setCheckOut] = useState("15 Dec 2026");
  const [rate, setRate] = useState("420000");

  async function render() {
    const result = await createDocument({
      kind: "hotel",
      title: `Hotel reservation · ${hotel}`,
      passenger: guest,
      reference: `HTL-${Date.now().toString().slice(-6)}`,
      lines: [
        { label: "Property", value: hotel },
        { label: "Check-in", value: checkIn },
        { label: "Check-out", value: checkOut },
        { label: "Nights", value: nights },
        { label: "Room", value: "Deluxe king · breakfast included" },
      ],
      total: Number(rate) || null,
      currency: "NGN",
    });
    if (result.ok) {
      toast.success("Reservation rendered", { description: `${PRICING.document.hotel} pts deducted.` });
      onCreated(result.value);
    } else toast.error(result.error);
  }

  return (
    <ComposerShell title="Hotel booking manager" subtitle="Reservation letter with stay details and total">
      <Field id="guest" label="Guest" value={guest} onChange={setGuest} placeholder="Kofi Mensah" />
      <Field id="hotel" label="Property" value={hotel} onChange={setHotel} />
      <Field id="checkin" label="Check-in" value={checkIn} onChange={setCheckIn} />
      <Field id="checkout" label="Check-out" value={checkOut} onChange={setCheckOut} />
      <Field id="nights" label="Nights" type="number" value={nights} onChange={setNights} />
      <Field id="rate" label="Total (₦)" type="number" value={rate} onChange={setRate} />
      <CostBar kind="hotel" onRender={render} disabled={!guest.trim()} />
    </ComposerShell>
  );
}

function InvoiceComposer({ onCreated }: { onCreated: (document: TravelDocument) => void }) {
  const [client, setClient] = useState("");
  const [description, setDescription] = useState("Freight consolidation · Lagos → Accra");
  const [quantity, setQuantity] = useState("3");
  const [unit, setUnit] = useState("115000");
  const [tax, setTax] = useState("7.5");

  const subtotal = (Number(quantity) || 0) * (Number(unit) || 0);
  const total = Math.round(subtotal * (1 + (Number(tax) || 0) / 100));

  async function render() {
    const result = await createDocument({
      kind: "invoice",
      title: "Invoice composer",
      passenger: client,
      reference: `INV-${Date.now().toString().slice(-6)}`,
      lines: [
        { label: "Billed to", value: client },
        { label: "Description", value: description },
        { label: "Quantity", value: quantity },
        { label: "Unit price", value: `₦${(Number(unit) || 0).toLocaleString()}` },
        { label: "VAT", value: `${tax}%` },
        { label: "Subtotal", value: `₦${subtotal.toLocaleString()}` },
      ],
      total,
      currency: "NGN",
    });
    if (result.ok) {
      toast.success("Invoice rendered", { description: `${PRICING.document.invoice} pts deducted.` });
      onCreated(result.value);
    } else toast.error(result.error);
  }

  return (
    <ComposerShell title="Invoice composer" subtitle="Billable lines with VAT, rendered as a receipt-grade PDF">
      <Field id="client" label="Client" value={client} onChange={setClient} placeholder="Meridian Capital" />
      <Field id="desc" label="Description" value={description} onChange={setDescription} />
      <Field id="qty" label="Quantity" type="number" value={quantity} onChange={setQuantity} />
      <Field id="unit" label="Unit price (₦)" type="number" value={unit} onChange={setUnit} />
      <Field id="tax" label="VAT (%)" type="number" value={tax} onChange={setTax} />
      <div className="space-y-1.5">
        <Label>Total</Label>
        <div className="flex h-9 items-center rounded-md border border-border bg-surface px-3 font-mono text-sm">
          ₦{total.toLocaleString()}
        </div>
      </div>
      <CostBar kind="invoice" onRender={render} disabled={!client.trim()} />
    </ComposerShell>
  );
}
