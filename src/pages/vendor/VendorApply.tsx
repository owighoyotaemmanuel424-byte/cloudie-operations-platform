import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/admin/shared";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BadgeCheck,
  Building2,
  CheckCircle2,
  FileText,
  Loader2,
  Mail,
  ShieldAlert,
  Store,
  Upload,
  Wallet,
  X,
} from "lucide-react";

const PAYOUT_METHODS = ["Bank transfer", "Paystack", "Flutterwave", "OPay"];

const STATUS_COPY: Record<string, { label: string; tone: string }> = {
  pending: { label: "Under review", tone: "Usually 1–2 business days." },
  approved: { label: "Approved", tone: "You can list point packages now." },
  rejected: { label: "Rejected", tone: "Fix the issue below and reapply." },
  suspended: { label: "Suspended", tone: "Selling is paused while support reviews your account." },
};

export default function VendorApply() {
  const vendor = useQuery(api.marketplace.getMyVendor);
  const apply = useMutation(api.pointMarket.applyAsVendor);

  const [form, setForm] = useState({
    businessName: "",
    description: "",
    contactName: "",
    contactEmail: "",
    contactPhone: "",
    website: "",
    category: "Points trading",
    payoutMethod: "",
    payoutDetails: "",
  });
  const [documents, setDocuments] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const set = (field: keyof typeof form, value: string) => setForm((prev) => ({ ...prev, [field]: value }));

  const missing = useMemo(() => {
    const list: string[] = [];
    if (form.businessName.trim().length < 2) list.push("business name");
    if (!form.contactEmail.includes("@")) list.push("contact email");
    if (!form.payoutMethod) list.push("payout method");
    if (form.payoutDetails.trim().length < 4) list.push("payout details");
    return list;
  }, [form]);

  if (vendor === undefined) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  // Approved, pending and suspended vendors see their status instead of the form.
  if (vendor && vendor.status !== "rejected") {
    const meta = STATUS_COPY[vendor.status];
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Vendor application</h1>
          <p className="mt-1 text-sm text-muted-foreground">{vendor.businessName}</p>
        </div>
        <Card>
          <CardContent className="space-y-4 p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Store className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium text-foreground">{vendor.businessName}</span>
              </div>
              <StatusBadge status={vendor.status} />
            </div>
            <p className="text-xs text-muted-foreground">{meta?.tone}</p>
            <div className="rounded-lg border border-border bg-surface-2/60 px-3 py-2 text-[11px] text-muted-foreground">
              Applied {new Date(vendor.createdAt).toLocaleDateString()} · {vendor.category ?? "Points trading"}
              {vendor.payoutMethod ? ` · ${vendor.payoutMethod}` : ""}
            </div>
            {vendor.status === "approved" && (
              <Link to="/app/vendor">
                <Button className="w-full gap-1.5">
                  <BadgeCheck className="h-4 w-4" /> Open vendor dashboard
                </Button>
              </Link>
            )}
            {vendor.status === "suspended" && vendor.statusReason && (
              <p className="rounded-lg border border-error/25 bg-error/5 px-3 py-2 text-[11px] text-error">
                {vendor.statusReason}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  async function submit() {
    if (missing.length > 0) {
      toast.error(`Add your ${missing.join(", ")} before submitting.`);
      return;
    }
    setBusy(true);
    try {
      await apply({
        businessName: form.businessName,
        description: form.description || undefined,
        contactName: form.contactName || undefined,
        contactEmail: form.contactEmail,
        contactPhone: form.contactPhone || undefined,
        website: form.website || undefined,
        category: form.category || undefined,
        payoutMethod: form.payoutMethod,
        payoutDetails: form.payoutDetails,
        documentNames: documents,
      });
      toast.success(vendor ? "Application resent for review" : "Application submitted for review");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not submit your application");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 pb-24 lg:pb-16">
      <div>
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          <Store className="h-3.5 w-3.5" /> Sell points
        </div>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight">Become a vendor</h1>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">
          Verified vendors sell point packages on the marketplace. Buyers pay into escrow and you're paid
          when you fulfil.
        </p>
      </div>

      {vendor?.status === "rejected" && (
        <div className="flex items-start gap-3 rounded-xl border border-error/35 bg-error/10 px-4 py-3">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-error" />
          <div className="text-sm">
            <p className="font-medium text-foreground">Previous application rejected</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {vendor.statusReason ?? "Update your details below and resubmit."}
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Building2 className="h-4 w-4" /> Business info
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <div className="space-y-1.5">
              <Label htmlFor="businessName">Business name *</Label>
              <Input
                id="businessName"
                value={form.businessName}
                onChange={(e) => set("businessName", e.target.value)}
                placeholder="Northline Points Ltd"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="description">What you sell</Label>
              <Textarea
                id="description"
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                className="min-h-20"
                maxLength={500}
                placeholder="Bulk point packages for small businesses, delivered within 30 minutes."
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="category">Category</Label>
              <Input id="category" value={form.category} onChange={(e) => set("category", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="website">Website (optional)</Label>
              <Input
                id="website"
                value={form.website}
                onChange={(e) => set("website", e.target.value)}
                placeholder="https://"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Mail className="h-4 w-4" /> Contact
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <div className="space-y-1.5">
              <Label htmlFor="contactName">Contact name</Label>
              <Input
                id="contactName"
                value={form.contactName}
                onChange={(e) => set("contactName", e.target.value)}
                placeholder="Ada Lovelace"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contactEmail">Contact email *</Label>
              <Input
                id="contactEmail"
                type="email"
                value={form.contactEmail}
                onChange={(e) => set("contactEmail", e.target.value)}
                placeholder="ops@northline.co"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contactPhone">Phone</Label>
              <Input
                id="contactPhone"
                value={form.contactPhone}
                onChange={(e) => set("contactPhone", e.target.value)}
                placeholder="+234 801 234 5678"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <FileText className="h-4 w-4" /> Documents
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <label className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border px-4 py-7 text-center transition-colors hover:border-primary/40">
              <Upload className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs font-medium text-foreground">Add business documents</span>
              <span className="text-[11px] text-muted-foreground">
                CAC certificate, ID, proof of address — PDF or image
              </span>
              <input
                type="file"
                multiple
                className="hidden"
                accept="application/pdf,image/jpeg,image/png"
                onChange={(e) => {
                  const names = Array.from(e.target.files ?? []).map((file) => file.name);
                  setDocuments((prev) => [...new Set([...prev, ...names])].slice(0, 6));
                  e.target.value = "";
                }}
              />
            </label>
            {documents.length > 0 ? (
              <ul className="space-y-1.5">
                {documents.map((name) => (
                  <li
                    key={name}
                    className="flex items-center gap-2 rounded-md border border-border bg-surface-2/60 px-2.5 py-1.5 text-[11px]"
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{name}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${name}`}
                      onClick={() => setDocuments((prev) => prev.filter((n) => n !== name))}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                No documents attached yet. Reviewers may request originals by email.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Wallet className="h-4 w-4" /> Payout method
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <div className="space-y-1.5">
              <Label htmlFor="payoutMethod">How should we pay you? *</Label>
              <Select value={form.payoutMethod} onValueChange={(value) => set("payoutMethod", value)}>
                <SelectTrigger id="payoutMethod">
                  <SelectValue placeholder="Choose a method" />
                </SelectTrigger>
                <SelectContent>
                  {PAYOUT_METHODS.map((method) => (
                    <SelectItem key={method} value={method}>
                      {method}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="payoutDetails">Payout account *</Label>
              <Input
                id="payoutDetails"
                value={form.payoutDetails}
                onChange={(e) => set("payoutDetails", e.target.value)}
                placeholder="Bank • 0123456789 • Northline Points Ltd"
                className="font-mono text-xs"
              />
            </div>
            <p className="rounded-lg border border-border bg-surface-2/60 px-3 py-2 text-[11px] text-muted-foreground">
              Payouts open automatically when you fulfil an order. Escrow settles to this account.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Sticky submit */}
      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 -mx-4 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:bottom-0">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <p className="min-w-0 truncate text-[11px] text-muted-foreground">
            {missing.length > 0 ? (
              <>Still needed: {missing.join(", ")}</>
            ) : (
              <span className="flex items-center gap-1.5 text-success">
                <CheckCircle2 className="h-3.5 w-3.5" /> Ready to submit
              </span>
            )}
          </p>
          <Button onClick={() => void submit()} disabled={busy} className="shrink-0 gap-1.5">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {busy ? "Submitting" : vendor ? "Reapply" : "Submit application"}
          </Button>
        </div>
      </div>
    </div>
  );
}
