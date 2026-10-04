import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Ban, Check, RotateCcw, X, RefreshCw, Store, Boxes, PackageCheck } from "lucide-react";
import { AdminPageHeader, StatusBadge, AdminEmpty, AdminSkeleton, fmtDate } from "@/components/admin/shared";
import { useEffect, useMemo, useState } from "react";

const MARKETPLACE_I = [
  "Discord", "Texting Numbers", "Outlook", "Apple", "Emails", "VPN", "Snapchat",
  "Reddit", "Twitter", "Instagram", "TikTok", "Facebook", "Gomeo Edu",
  "Netflix Premium", "Clone Tiik.T0k", "Aged Farming Clones",
];
const MARKETPLACE_II = [
  "Facebook", "Instagram", "New FB Accounts", "Pinterest", "Random Countries FB",
  "Self-created and Nurtured Accounts", "TikTok Account",
];

const matches = (product: { category: string; name: string }, terms: string[]) => {
  const haystack = `${product.category} ${product.name}`.toLowerCase();
  return terms.some((term) => haystack.includes(term.toLowerCase()));
};

export default function AdminMarketplace() {
  const products = useQuery(api.marketplace.adminListAllProducts, { limit: 200 });
  const approve = useMutation(api.marketplace.adminApproveProduct);
  const toggleActive = useMutation(api.adminApi.adminToggleProductActive);
  const provider = useQuery(api.marketplace.getLogspanelAdminStatus, {});
  const providerProducts = useQuery(api.marketplace.getLogspanelProducts, { limit: 200 });
  const syncCatalog = useAction(api.logspanel.syncCatalog);
  const saveProvider = useMutation(api.marketplace.setLogspanelSettings);
  const [syncing, setSyncing] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [markup, setMarkup] = useState("0");

  useEffect(() => {
    if (provider) {
      setEnabled(provider.enabled);
      setMarkup(String(provider.markupPercent));
    }
  }, [provider?.enabled, provider?.markupPercent]);

  const summary = useMemo(() => {
    const all = products ?? [];
    const marketplaceI = all.filter((p) => matches(p, MARKETPLACE_I)).length;
    const marketplaceII = all.filter((p) => matches(p, MARKETPLACE_II)).length;
    const providerStock = all.reduce((sum, p) => sum + (p.providerAvailableQuantity ?? 0), 0);
    const lowStock = all.filter((p) => p.providerAvailableQuantity !== undefined && p.providerAvailableQuantity <= 10).length;
    return { total: all.length, marketplaceI, marketplaceII, providerStock, lowStock };
  }, [products]);

  const sync = async () => {
    setSyncing(true);
    try {
      const result = await syncCatalog({});
      toast.success(`Logspanel synced: ${result.created} created, ${result.updated} updated.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Catalog sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const saveProviderSettings = async () => {
    try {
      await saveProvider({ enabled, markupPercent: Number(markup) });
      toast.success("Logspanel settings saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save settings");
    }
  };

  const act = async (productId: string, doApprove: boolean) => {
    try {
      await approve({ productId: productId as never, approve: doApprove });
      toast.success(doApprove ? "Product approved" : "Product rejected");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Operation failed");
    }
  };

  const toggle = async (productId: string, isActive: boolean) => {
    try {
      await toggleActive({ productId: productId as never, isActive: !isActive });
      toast.success(isActive ? "Product disabled" : "Product re-enabled");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Operation failed");
    }
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Marketplace Administration"
        description="Manage the dual marketplace catalog, provider inventory, pricing and product visibility."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          ["Products", summary.total, Boxes],
          ["Marketplace I", summary.marketplaceI, Store],
          ["Marketplace II", summary.marketplaceII, Store],
          ["Provider stock", summary.providerStock.toLocaleString(), PackageCheck],
          ["Low stock", summary.lowStock, PackageCheck],
        ].map(([label, value, Icon]) => (
          <Card key={String(label)} className="rounded-xl border-slate-200 shadow-sm dark:border-slate-700">
            <CardContent className="p-4">
              <Icon className="h-4 w-4 text-muted-foreground" />
              <p className="mt-3 text-xs text-muted-foreground">{label}</p>
              <p className="mt-1 text-xl font-bold">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="rounded-xl border-slate-200 shadow-sm dark:border-slate-700">
        <CardContent className="p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-3">
              <Store className="mt-1 h-5 w-5" />
              <div>
                <h2 className="font-semibold">Logspanel Provider</h2>
                <p className="text-sm text-muted-foreground">External provider with server-side fulfillment and catalog synchronization.</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {provider?.configured ? "API key configured" : "Set LOGSPANEL_API_KEY in Convex"}
                  {" · "}
                  {provider?.syncedProducts ?? 0} products synced
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={!provider?.configured || syncing} onClick={sync}>
                <RefreshCw className={syncing ? "mr-2 h-4 w-4 animate-spin" : "mr-2 h-4 w-4"} />
                {syncing ? "Syncing..." : "Sync catalog"}
              </Button>
              <Button onClick={saveProviderSettings}>Save settings</Button>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">Provider enabled</span>
              <select
                className="h-10 w-full rounded-md border bg-background px-3"
                value={enabled ? "true" : "false"}
                onChange={(event) => setEnabled(event.target.value === "true")}
              >
                <option value="false">Disabled</option>
                <option value="true">Enabled</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">Markup %</span>
              <input
                className="h-10 w-full rounded-md border bg-background px-3"
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={markup}
                onChange={(event) => setMarkup(event.target.value)}
              />
            </label>
          </div>
        </CardContent>
      </Card>

      {products === undefined ? (
        <AdminSkeleton rows={5} />
      ) : products.length === 0 ? (
        <AdminEmpty message="No marketplace products yet. Sync the provider catalog or approve vendor products." />
      ) : (
        <div className="space-y-2">
          {products.map((product) => {
            const stock = product.providerAvailableQuantity;
            return (
              <Card key={product._id} className="rounded-xl border-slate-200 shadow-sm dark:border-slate-700">
                <CardContent className="flex flex-wrap items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{product.name}</p>
                      <Badge variant="outline" className="text-[10px]">{product.category}</Badge>
                      {product.provider && <Badge variant="secondary" className="text-[10px]">{product.provider}</Badge>}
                    </div>
                    <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
                      {product.pointsPrice} pts · {product.totalSold} sold · {stock === undefined ? "stock provider-managed" : `${stock.toLocaleString()} in stock`} · {fmtDate(product.createdAt)}
                    </p>
                  </div>
                  <StatusBadge status={product.isApproved ? (product.isActive ? "active" : "paused") : "draft"} />
                  <div className="flex shrink-0 gap-1">
                    {!product.isApproved ? (
                      <>
                        <Button size="sm" className="bg-green-600 text-white hover:bg-green-700" onClick={() => act(product._id, true)}>
                          <Check className="mr-1 h-3 w-3" /> Approve
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => act(product._id, false)}>
                          <X className="mr-1 h-3 w-3" />
                        </Button>
                      </>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => toggle(product._id, product.isActive)}>
                        {product.isActive ? <><Ban className="mr-1 h-3 w-3" /> Disable</> : <><RotateCcw className="mr-1 h-3 w-3" /> Re-enable</>}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {providerProducts !== undefined && providerProducts.length > 0 && (
        <Card className="rounded-xl border-slate-200 shadow-sm dark:border-slate-700">
          <CardContent className="p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">Provider inventory snapshot</h2>
                <p className="text-xs text-muted-foreground">Read-only view of the products currently mapped to the provider.</p>
              </div>
              <Badge variant="outline">{providerProducts.length} mapped</Badge>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
