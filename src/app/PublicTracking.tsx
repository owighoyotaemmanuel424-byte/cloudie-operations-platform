import { motion } from "framer-motion";
import { ArrowLeft, CheckCircle2, Circle, LayoutGrid, MapPin, Package } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { lookupPublicShipment } from "@/platform/engine";
import { SHIPMENT_STEPS, type Shipment } from "@/platform/model";
import { dateTime, titleCase } from "@/platform/format";
import { EASE, SectionLabel } from "@/platform/ui";
import { cn } from "@/lib/utils";

export default function PublicTracking() {
  const { token } = useParams();
  const [shipment, setShipment] = useState<Shipment | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    if (!token) {
      setShipment(null);
      return () => {
        alive = false;
      };
    }
    void lookupPublicShipment(token).then((result) => {
      if (alive) setShipment(result);
    });
    return () => {
      alive = false;
    };
  }, [token]);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="page-gutter mx-auto flex h-16 max-w-3xl items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
              <LayoutGrid className="h-4 w-4" />
            </span>
            <span className="font-display text-sm font-semibold">Cloudie Tracking</span>
          </Link>
          <Button asChild variant="ghost" size="sm">
            <Link to="/"><ArrowLeft className="h-4 w-4" /> Home</Link>
          </Button>
        </div>
      </header>

      <main className="page-gutter mx-auto max-w-3xl py-10">
        {shipment === undefined ? (
          <div className="flex justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
          </div>
        ) : !shipment ? (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: EASE }}
            className="rounded-2xl border border-border bg-card p-10 text-center"
          >
            <Package className="mx-auto h-7 w-7 text-muted-foreground" />
            <h1 className="mt-3 font-display text-xl font-semibold">Tracking link not recognised</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              This consignment is private or the link has expired. Ask the sender to re-share it.
            </p>
          </motion.div>
        ) : (
          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: EASE }}>
            <SectionLabel>Public tracking</SectionLabel>
            <h1 className="mt-3 font-display text-3xl font-semibold tracking-[-0.02em]">
              {shipment.origin} → {shipment.destination}
            </h1>
            <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              {shipment.code} · {titleCase(shipment.status)}
            </p>

            <div className="mt-6 rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /> Registered {dateTime(shipment.createdAt)}</span>
                <span>{shipment.weightKg} kg</span>
              </div>
              <div className="mt-4 flex items-center gap-1.5">
                {SHIPMENT_STEPS.map((step) => {
                  const reached = shipment.status === "delivered" || SHIPMENT_STEPS.findIndex((item) => item.id === shipment.status) >= SHIPMENT_STEPS.findIndex((item) => item.id === step.id);
                  return (
                    <span key={step.id} className={cn("h-1.5 flex-1 rounded-full", reached ? "bg-primary" : "bg-border")} />
                  );
                })}
              </div>
              <div className="mt-1.5 flex justify-between font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                <span>Registered</span>
                <span>Delivered</span>
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-border bg-card p-5">
              <h2 className="font-display text-base font-semibold">Movement history</h2>
              <ol className="mt-4 space-y-4">
                {[...shipment.events].reverse().map((event, index) => (
                  <li key={event.id} className="flex gap-3">
                    <span className="mt-0.5">
                      {index === 0 ? (
                        <CheckCircle2 className="h-4 w-4 text-primary" />
                      ) : (
                        <Circle className="h-4 w-4 text-muted-foreground/50" />
                      )}
                    </span>
                    <div>
                      <p className={cn("text-[13px]", index === 0 ? "font-semibold" : "font-medium")}>{event.label}</p>
                      <p className="text-[11px] text-muted-foreground">{event.location} · {dateTime(event.at)}</p>
                      {event.note ? <p className="mt-0.5 text-[11px] text-muted-foreground">{event.note}</p> : null}
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            <p className="mt-5 text-center text-[11px] text-muted-foreground">
              Recipient: {shipment.recipientName} · Consignment {shipment.code}
            </p>
          </motion.div>
        )}
      </main>
    </div>
  );
}
