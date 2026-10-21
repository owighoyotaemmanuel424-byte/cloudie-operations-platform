import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, Loader2 } from "lucide-react";

/**
 * Privileged adjustment dialog.
 *
 * Two things are mandatory before Apply enables: a non-zero signed amount and a
 * written reason of at least `minReasonLength` characters. The reason is stored
 * on the audit entry, and the success toast links straight to that trail.
 */
export function ReasonRequiredDialog({
  open,
  onClose,
  title,
  description,
  currentBalance,
  amountLabel = "Amount (NGN)",
  submitLabel = "Apply adjustment",
  minReasonLength = 10,
  destructive = false,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  currentBalance: string;
  amountLabel?: string;
  submitLabel?: string;
  minReasonLength?: number;
  destructive?: boolean;
  onSubmit: (args: { amount: number; reason: string }) => Promise<void>;
}) {
  const navigate = useNavigate();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setAmount("");
      setReason("");
      setBusy(false);
    }
  }, [open]);

  const parsed = Number(amount);
  const amountValid = Number.isFinite(parsed) && parsed !== 0;
  const reasonValid = reason.trim().length >= minReasonLength;

  async function apply() {
    if (!amountValid || !reasonValid) return;
    setBusy(true);
    try {
      await onSubmit({ amount: parsed, reason: reason.trim() });
      toast.success("Adjustment applied", {
        description: "Recorded in the audit trail.",
        action: { label: "View audit entry", onClick: () => navigate("/admin/audit") },
      });
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Adjustment failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-lg border border-border bg-surface-2/60 px-3 py-2 text-xs">
            <span className="text-muted-foreground">Current balance </span>
            <span className="font-mono font-semibold text-foreground">{currentBalance}</span>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="adjust-amount">{amountLabel}</Label>
            <Input
              id="adjust-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.-]/g, ""))}
              placeholder="e.g. 5000 for a credit, -5000 for a debit"
              className="font-mono"
              autoFocus
            />
            <p className="text-[11px] text-muted-foreground">
              Positive credits the balance, negative debits it.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="adjust-reason">Reason (required)</Label>
            <Textarea
              id="adjust-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="min-h-20"
              maxLength={400}
              placeholder="e.g. Refund for failed VTU order #88213"
            />
            <p className="text-[11px] text-muted-foreground">
              {reason.trim().length}/{minReasonLength} characters minimum — stored on the audit entry.
            </p>
          </div>

          {destructive && (
            <p className="flex items-start gap-1.5 text-[11px] text-warning">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Debits fail if the balance would go negative.
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={busy || !amountValid || !reasonValid}
            onClick={() => void apply()}
          >
            {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
