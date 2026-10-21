import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { usePricing, formatNgn } from "@/lib/pricing";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { ArrowLeft, Plus, Send } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

export default function EmailCampaign() {
  const { price, ngnPerPoint } = usePricing();
  const emailPrice = price("email_per_recipient", 10);
  const createCampaign = useMutation(api.assets.createCampaign);
  const campaigns = useQuery(api.assets.listCampaigns, { limit: 10 });
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    subject: "", senderName: "", content: "", recipientsText: "",
  });
  const update = (field: string, value: string) => setForm((p) => ({ ...p, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const recipients = form.recipientsText.split("\n").map((r) => r.trim()).filter(Boolean);
    if (recipients.length === 0) { toast.error("Add at least one recipient"); return; }
    const cost = recipients.length * emailPrice.points;
    if (!confirm(`This will send ${recipients.length} emails for ${cost} points (${formatNgn(emailPrice.ngn * recipients.length)}). Continue?`)) return;
    setLoading(true);
    try {
      await createCampaign({ ...form, recipients });
      toast.success("Campaign queued — delivery status appears in the admin email log.");
      setForm({ subject: "", senderName: "", content: "", recipientsText: "" });
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); } finally { setLoading(false); }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <Link to="/services"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Email Campaign</h1>
          <p className="mt-1 text-sm text-muted-foreground">Compose and send email campaigns. Cost: {emailPrice.label} per email.</p>
        </div>
        <Button asChild className="shrink-0 gap-2">
          <Link to="/services/email/new">
            <Plus className="h-4 w-4" /> New campaign
          </Link>
        </Button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card className="notebook-card">
          <CardContent className="grid gap-4 sm:grid-cols-2 p-6">
            <div className="space-y-1.5"><Label>Subject *</Label><Input required value={form.subject} onChange={(e) => update("subject", e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Sender Name *</Label><Input required value={form.senderName} onChange={(e) => update("senderName", e.target.value)} /></div>
            <div className="space-y-1.5 sm:col-span-2"><Label>Email Content (HTML supported) *</Label><Textarea required rows={8} value={form.content} onChange={(e) => update("content", e.target.value)} placeholder="<h1>Hello!</h1><p>Your email content here.</p>" /></div>
            <div className="space-y-1.5 sm:col-span-2"><Label>Recipients (one per line) *</Label><Textarea required rows={4} value={form.recipientsText} onChange={(e) => update("recipientsText", e.target.value)} placeholder="user1@example.com&#10;user2@example.com" /></div>
          </CardContent>
        </Card>
        <div className="flex justify-end">
          <Button type="submit" size="lg" disabled={loading} className="gap-2">
            <Send className="h-4 w-4" />
            {loading
              ? "Sending..."
              : `Send Campaign (${form.recipientsText.split("\n").filter((r) => r.trim()).length * emailPrice.points} pts · ${formatNgn(emailPrice.ngn * form.recipientsText.split("\n").filter((r) => r.trim()).length)})`}
          </Button>
        </div>
      </form>

      <Card className="notebook-card">
        <CardHeader><CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Previous Campaigns</CardTitle></CardHeader>
        <CardContent>
          {!campaigns ? <p className="text-sm text-muted-foreground animate-pulse">Loading...</p> : campaigns.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No campaigns yet.</p>
          ) : (
            <div className="space-y-2">
              {campaigns.map((c) => (
                <div key={c._id} className="flex items-center justify-between p-3 rounded-lg hover:bg-[var(--nb-ink)]/5">
                  <div><p className="text-sm font-medium text-[var(--nb-ink)]">{c.subject}</p><p className="text-xs text-muted-foreground">{c.totalRecipients} recipients • {c.pointsCost} pts · {formatNgn(c.pointsCost * ngnPerPoint)} • {new Date(c.createdAt).toLocaleDateString()}</p></div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
