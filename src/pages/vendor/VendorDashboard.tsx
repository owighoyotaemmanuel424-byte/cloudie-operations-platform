import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/admin/shared";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageTransition, Reveal } from "@/components/motion";
import {
  Coins,
  Loader2,
  Lock,
  Package,
  Pause,
  Pencil,
  Play,
  Plus,
  Store,
  Trash2,
  Wallet,
} from "lucide-react";

const naira = (minor: number) =>
  `₦${(minor / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

type Overview = NonNullable<FunctionReturnType<typeof api.pointMarket.vendorOverview>>;
type Listing = Overview["listings"][number];

export default function VendorDashboard() {
  const data = useQuery(api.pointMarket.vendorOverview);

  if (data === undefined) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-56" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (data === null) {
    return (
      <div className="mx-auto max-w-md space-y-3 py-16 text-center">
        <Store className="mx-auto h-8 w-8 text-muted-foreground" />
        <h1 className="text-lg font-semibold text-foreground">You're not a vendor yet</h1>
        <p className="text-sm text-muted-foreground">
          Apply once, then list point packages and get paid from escrow.
        </p>
        <Link to="/app/vendor/apply">
          <Button className="gap-1.5">
            <Plus className="h-4 w-4" /> Apply as a vendor
          </Button>
        </Link>
      </div>
    );
  }

  return <DashboardBody data={data} />;
}

function DashboardBody({ data }: { data: Overview }) {
  const { vendor, listings, payouts, stats } = data;
  const createPackage = useMutation(api.pointMarket.createPackage);
  const updatePackage = useMutation(api.pointMarket.updatePackage);
  const setActive = useMutation(api.pointMarket.setPackageActive);
  const deletePackage = useMutation(api.pointMarket.deletePackage);

  const [editing, setEditing] = useState<Listing | "new" | null>(null);
  const [deleting, setDeleting] = useState<Listing | null>(null);
  const [form, setForm] = useState({ name: "", points: "1000", price: "1500" });
  const [busy, setBusy] = useState(false);

  function openNew() {
    setForm({ name: "", points: "1000", price: "1500" });
    setEditing("new");
  }

  function openEdit(listing: Listing) {
    setForm({
      name: listing.name,
      points: String(listing.points),
      price: String(listing.priceMinor / 100),
    });
    setEditing(listing);
  }

  async function save() {
    const points = Number(form.points);
    const price = Number(form.price);
    if (form.name.trim().length < 3) {
      toast.error("Give the package a name.");
      return;
    }
    if (!Number.isFinite(points) || points < 100) {
      toast.error("Minimum package is 100 points.");
      return;
    }
    if (!Number.isFinite(price) || price < 100) {
      toast.error("Minimum price is ₦100.");
      return;
    }
    setBusy(true);
    try {
      if (editing === "new") {
        await createPackage({ name: form.name, points, priceNgn: price });
        toast.success("Listing created and live");
      } else if (editing) {
        await updatePackage({ packageId: editing._id, name: form.name, points, priceNgn: price });
        toast.success("Listing updated");
      }
      setEditing(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the listing");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(listing: Listing) {
    try {
      await setActive({ packageId: listing._id, isActive: !listing.isActive });
      toast.success(listing.isActive ? "Listing paused" : "Listing live");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the listing");
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      const result = await deletePackage({ packageId: deleting._id });
      toast.success(result.retired ? "Listing retired (orders keep their history)" : "Listing deleted");
      setDeleting(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete the listing");
    } finally {
      setBusy(false);
    }
  }

  const statCards = [
    { label: "Active listings", value: String(stats.activeListings), hint: `${stats.listings} total`, icon: Store },
    { label: "Orders", value: String(stats.orders), hint: "all time", icon: Package },
    { label: "Escrow held", value: naira(stats.escrowMinor), hint: "awaiting fulfilment", icon: Lock },
    {
      label: "Payouts",
      value: naira(stats.paidPayoutsMinor),
      hint: `${naira(stats.pendingPayoutsMinor)} pending`,
      icon: Wallet,
    },
  ];

  return (
    <PageTransition className="space-y-4 pb-20 lg:pb-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <Store className="h-3.5 w-3.5" /> Vendor
          </div>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight">{vendor.businessName}</h1>
          <div className="mt-1 flex items-center gap-2">
            <StatusBadge status={vendor.status} />
            <span className="text-[11px] text-muted-foreground">
              {vendor.totalSales.toLocaleString()} pts sold · {naira(Math.round(vendor.earnings * 100))} earned
            </span>
          </div>
        </div>
        {vendor.status === "approved" ? (
          <Button className="gap-1.5" onClick={openNew}>
            <Plus className="h-4 w-4" /> New listing
          </Button>
        ) : (
          <Link to="/app/vendor/apply">
            <Button variant="outline" className="gap-1.5">
              <Store className="h-4 w-4" /> View application
            </Button>
          </Link>
        )}
      </div>

      {vendor.status !== "approved" && (
        <div className="rounded-xl border border-warning/35 bg-warning/10 px-4 py-3 text-sm text-foreground">
          Your vendor account is {vendor.status}. Listings are hidden until it's approved.
          {vendor.statusReason ? ` ${vendor.statusReason}` : ""}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((card) => (
          <Card key={card.label}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{card.label}</span>
                <card.icon className="h-4 w-4 text-muted-foreground" />
              </div>
              <p className="mt-2 truncate font-mono text-lg font-semibold text-foreground">{card.value}</p>
              <p className="text-[11px] text-muted-foreground">{card.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-semibold">Listings</CardTitle>
          <span className="text-[11px] text-muted-foreground">{listings.length} package{listings.length === 1 ? "" : "s"}</span>
        </CardHeader>
        <CardContent className="pt-0">
          {listings.length === 0 ? (
            <div className="py-10 text-center">
              <Coins className="mx-auto h-6 w-6 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium text-foreground">No listings yet</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Create your first point package to appear on the marketplace.
              </p>
              {vendor.status === "approved" && (
                <Button variant="outline" size="sm" className="mt-3 gap-1.5" onClick={openNew}>
                  <Plus className="h-3.5 w-3.5" /> New listing
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-1">Package</TableHead>
                    <TableHead className="text-right">Points</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">Unit</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="pr-1 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {listings.map((listing) => (
                    <TableRow key={listing._id}>
                      <TableCell className="pl-1">
                        <p className="text-sm font-medium text-foreground">{listing.name}</p>
                        <p className="text-[11px] text-muted-foreground">{listing.totalSold.toLocaleString()} sold</p>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">{listing.points.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{naira(listing.priceMinor)}</TableCell>
                      <TableCell className="text-right font-mono text-[11px] text-muted-foreground">
                        {naira(Math.round((listing.priceMinor / listing.points) * 1000))}/1k
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={listing.isActive ? "active" : "paused"} />
                      </TableCell>
                      <TableCell className="pr-1">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            aria-label={listing.isActive ? "Pause listing" : "Activate listing"}
                            onClick={() => void toggle(listing)}
                          >
                            {listing.isActive ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            aria-label="Edit listing"
                            onClick={() => openEdit(listing)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-error hover:text-error"
                            aria-label="Delete listing"
                            onClick={() => setDeleting(listing)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-semibold">Payout ledger</CardTitle>
          <span className="text-[11px] text-muted-foreground">Escrow released on fulfilment</span>
        </CardHeader>
        <CardContent className="pt-0">
          {payouts.length === 0 ? (
            <p className="py-8 text-center text-[11px] text-muted-foreground">
              No payouts yet. They open as soon as you fulfil an order.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-1">Reference</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="pr-1 text-right">Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payouts.map((payout) => (
                    <TableRow key={payout._id}>
                      <TableCell className="pl-1 font-mono text-[11px] text-muted-foreground">{payout.reference}</TableCell>
                      <TableCell>
                        <StatusBadge status={payout.status} />
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">{naira(payout.amountMinor)}</TableCell>
                      <TableCell className="pr-1 text-right text-[11px] text-muted-foreground">
                        {new Date(payout.paidAt ?? payout.createdAt).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Reveal>
        <p className="text-[11px] text-muted-foreground">
          Buyers can dispute an order until it's fulfilled. Overdue escrow is refunded on review.
        </p>
      </Reveal>

      {/* Create / edit */}
      <Dialog open={editing !== null} onOpenChange={(open) => !busy && !open && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "New point package" : "Edit listing"}</DialogTitle>
            <DialogDescription>
              Buyers see the unit price automatically; it's the price per 1,000 points.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="pkg-name">Package name</Label>
              <Input
                id="pkg-name"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Starter bundle"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="pkg-points">Points</Label>
                <Input
                  id="pkg-points"
                  inputMode="numeric"
                  value={form.points}
                  onChange={(e) => setForm((prev) => ({ ...prev, points: e.target.value.replace(/[^\d]/g, "") }))}
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pkg-price">Price (₦)</Label>
                <Input
                  id="pkg-price"
                  inputMode="numeric"
                  value={form.price}
                  onChange={(e) => setForm((prev) => ({ ...prev, price: e.target.value.replace(/[^\d]/g, "") }))}
                  className="font-mono"
                />
              </div>
            </div>
            <p className="rounded-lg border border-border bg-surface-2/60 px-3 py-2 text-[11px] text-muted-foreground">
              Unit price:{" "}
              <span className="font-mono text-foreground">
                {Number(form.points) > 0
                  ? naira(Math.round((Number(form.price) / Number(form.points)) * 1000 * 100))
                  : "—"}{" "}
                / 1,000 pts
              </span>
            </p>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : editing === "new" ? "Create listing" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <Dialog open={Boolean(deleting)} onOpenChange={(open) => !busy && !open && setDeleting(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete {deleting?.name}?</DialogTitle>
            <DialogDescription>
              If it has orders, the listing is retired instead so order history stays intact.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="ghost" onClick={() => setDeleting(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void confirmDelete()} disabled={busy}>
              {busy ? "Deleting…" : "Delete listing"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageTransition>
  );
}
