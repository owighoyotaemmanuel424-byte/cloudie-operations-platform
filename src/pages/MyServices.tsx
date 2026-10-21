import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowUpRight, BriefcaseBusiness, FileText, Mail, Package, Palette,
  ShoppingBag, Sparkles, Smartphone, Wifi, Zap, Tv, GraduationCap,
  Search, SlidersHorizontal, Truck, LayoutGrid
} from "lucide-react";
import { Input } from "@/components/ui/input";

const catalog = [
  { key: "business", name: "Business Suite", category: "Business", icon: BriefcaseBusiness, path: "/business", description: "Websites, banking, investment and business operations." },
  { key: "shipments", name: "Shipments", category: "Logistics", icon: Package, path: "/shipments", description: "Create, track and manage your deliveries." },
  { key: "documents", name: "Document Studio", category: "Documents", icon: FileText, path: "/documents", description: "Templates, documents and professional exports." },
  { key: "email", name: "Email", category: "Communication", icon: Mail, path: "/services/email", description: "Campaigns, templates and delivery history." },
  { key: "render", name: "Image Studio", category: "Creative", icon: Palette, path: "/app/services/images", description: "Render on-brand images from templates." },
  { key: "marketplace", name: "Marketplace", category: "Commerce", icon: ShoppingBag, path: "/marketplace", description: "Digital products, numbers and social services." },
];

const essentials = [
  { name: "Airtime", icon: Smartphone, path: "/vtu/airtime", description: "Top up any Nigerian network." },
  { name: "Data", icon: Wifi, path: "/vtu/data", description: "Buy mobile data plans." },
  { name: "Electricity", icon: Zap, path: "/vtu/electricity", description: "Pay electricity bills." },
  { name: "TV", icon: Tv, path: "/vtu/bills", description: "Renew supported TV plans." },
  { name: "Exam Pins", icon: GraduationCap, path: "/vtu/exam-pins", description: "Purchase exam PINs." },
  { name: "Ship", icon: Truck, path: "/shipments/new", description: "Create a new shipment." },
];

export default function MyServices() {
  const services = useQuery(api.serviceHub.listMyServices, { limit: 50 });
  const syncMyServices = useMutation(api.serviceHub.syncMyServices);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");

  useEffect(() => {
    syncMyServices({}).catch(() => undefined);
  }, [syncMyServices]);

  const categories = ["All", ...Array.from(new Set(catalog.map((item) => item.category)))];
  const filteredCatalog = useMemo(() => catalog.filter((item) => {
    const matchesCategory = category === "All" || item.category === category;
    const query = search.trim().toLowerCase();
    return matchesCategory && (!query || [item.name, item.category, item.description].join(" ").toLowerCase().includes(query));
  }), [category, search]);

  return (
    <div className="space-y-7 sm:space-y-9">
      <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">Provider availability and fulfillment times can vary. Review the service details, total cost, and terms before confirming an order.</div>
      <section className="overflow-hidden rounded-3xl border border-primary/15 bg-gradient-to-br from-primary/[0.11] via-card to-card">
        <CardContent className="p-5 sm:p-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Cloudie service hub</p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Everything you need, in one place.</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Buy everyday services, manage active workspaces, and jump back into the tools you use most.</p>
            </div>
            <Button asChild className="gap-2">
              <Link to="/marketplace">Discover marketplace <ArrowUpRight className="h-4 w-4" /></Link>
            </Button>
          </div>
        </CardContent>
      </section>

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div><h2 className="text-lg font-bold text-foreground">Everyday services</h2><p className="text-xs text-muted-foreground">Fast access to the services customers use most.</p></div>
          <Link to="/vtu" className="text-xs font-semibold text-primary">Open VTU hub</Link>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {essentials.map((item) => {
            const Icon = item.icon;
            return <Link key={item.name} to={item.path} className="group rounded-2xl border border-border bg-card p-3 text-center transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-sm">
              <span className="mx-auto flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="size-5" /></span>
              <p className="mt-2 truncate text-xs font-semibold text-foreground">{item.name}</p>
              <p className="mt-1 hidden text-[10px] leading-4 text-muted-foreground sm:block">{item.description}</p>
            </Link>;
          })}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div><h2 className="text-lg font-bold text-foreground">Your services</h2><p className="text-xs text-muted-foreground">Active and recently used Cloudie workspaces.</p></div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><LayoutGrid className="size-3.5" /> {services?.length ?? 0} records</div>
        </div>
        {services === undefined ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[1,2,3].map((item) => <Card key={item} className="h-40 animate-pulse bg-muted/40" />)}</div>
        ) : services.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {services.map((service) => {
              const item = catalog.find((entry) => entry.key === service.serviceKey);
              const Icon = item?.icon ?? Sparkles;
              return <Link key={service._id} to={item?.path ?? "/dashboard"} className="group">
                <Card className="h-full transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="size-5" /></div>
                      <Badge variant="outline" className="capitalize">{service.status}</Badge>
                    </div>
                    <h3 className="mt-5 font-semibold text-foreground">{service.name}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{service.resourceLabel ?? service.planLabel ?? item?.description}</p>
                    {service.usageLabel && <p className="mt-4 text-xs font-medium text-primary">{service.usageLabel}</p>}
                    <div className="mt-5 flex items-center text-xs font-semibold text-muted-foreground group-hover:text-primary">Manage service <ArrowUpRight className="ml-1 size-3.5" /></div>
                  </CardContent>
                </Card>
              </Link>;
            })}
          </div>
        ) : <Card><CardContent className="p-6 text-center"><Sparkles className="mx-auto size-8 text-muted-foreground/50" /><p className="mt-3 text-sm font-semibold text-foreground">No active service records yet</p><p className="mt-1 text-xs text-muted-foreground">Start with an everyday service or open a Cloudie workspace below.</p></CardContent></Card>}
      </section>

      <section className="space-y-4">
        <div><h2 className="text-lg font-bold text-foreground">Cloudie workspaces</h2><p className="text-xs text-muted-foreground">Search and open any workspace without leaving your account.</p></div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search services..." className="pl-9" /></div>
          <div className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1">
            {categories.map((item) => <button key={item} type="button" onClick={() => setCategory(item)} className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition ${category === item ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}><SlidersHorizontal className="mr-1 inline size-3" />{item}</button>)}
          </div>
        </div>
        {filteredCatalog.length === 0 ? <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">No services match your search.</CardContent></Card> :
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredCatalog.map((item) => { const Icon = item.icon; return <Link key={item.key} to={item.path}><Card className="h-full transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:bg-primary/[0.025]"><CardContent className="flex gap-4 p-5"><div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground"><Icon className="size-5" /></div><div className="min-w-0"><p className="font-semibold text-foreground">{item.name}</p><p className="mt-1 text-sm leading-5 text-muted-foreground">{item.description}</p><p className="mt-4 text-xs font-semibold text-primary">Open workspace <ArrowUpRight className="ml-1 inline size-3.5" /></p></div></CardContent></Card></Link>; })}
          </div>}
      </section>
    </div>
  );
}
