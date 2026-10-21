import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  Copy,
  GripVertical,
  Heading1,
  Image as ImageIcon,
  Loader2,
  MailCheck,
  Minus,
  Monitor,
  MousePointerClick,
  MoveVertical,
  PanelBottom,
  Send,
  Smartphone,
  Trash2,
  Type,
  Users,
} from "lucide-react";

import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { usePricing } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

/* ── Block model ───────────────────────────────────────────────── */

type BlockType = "text" | "heading" | "image" | "button" | "divider" | "spacer" | "footer";

type Block = {
  id: string;
  type: BlockType;
  /** heading + text body, button label, footer copy */
  text?: string;
  src?: string;
  alt?: string;
  href?: string;
  /** spacer only */
  size?: "sm" | "md" | "lg";
};

let blockSeq = 0;
const newId = () => `blk_${Date.now().toString(36)}_${(blockSeq += 1)}`;

function createBlock(type: BlockType): Block {
  switch (type) {
    case "heading":
      return { id: newId(), type, text: "A clear, punchy headline" };
    case "text":
      return {
        id: newId(),
        type,
        text: "Write your message here. Keep it short, lead with the benefit, and tell readers exactly what to do next.",
      };
    case "image":
      return {
        id: newId(),
        type,
        src: "https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=1200&q=80",
        alt: "Team working together",
      };
    case "button":
      return { id: newId(), type, text: "See what's new", href: "https://cloudie.example.com" };
    case "divider":
      return { id: newId(), type };
    case "spacer":
      return { id: newId(), type, size: "md" };
    case "footer":
      return {
        id: newId(),
        type,
        text: "You're receiving this because you signed up for Cloudie updates.\nUnsubscribe · Manage preferences · Lagos, Nigeria",
      };
  }
}

const BLOCK_LIBRARY: { type: BlockType; label: string; icon: typeof Type; hint: string }[] = [
  { type: "text", label: "Text", icon: Type, hint: "Paragraph copy" },
  { type: "heading", label: "Heading", icon: Heading1, hint: "Section title" },
  { type: "image", label: "Image", icon: ImageIcon, hint: "Banner or photo" },
  { type: "button", label: "Button", icon: MousePointerClick, hint: "Call to action" },
  { type: "divider", label: "Divider", icon: Minus, hint: "Horizontal rule" },
  { type: "spacer", label: "Spacer", icon: MoveVertical, hint: "Vertical breathing room" },
  { type: "footer", label: "Footer", icon: PanelBottom, hint: "Unsubscribe + address" },
];

const STARTER_BLOCKS: Block[] = [
  { id: newId(), type: "heading", text: "Your February update is here" },
  {
    id: newId(),
    type: "text",
    text: "Hi there — here's everything we shipped this month, plus one thing we think you'll love.",
  },
  { id: newId(), type: "button", text: "Read the update", href: "https://cloudie.example.com" },
  createBlock("footer"),
];

/* ── Recipient lists ───────────────────────────────────────────── */

function makeAddresses(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}.${i + 1}@example.com`);
}

type RecipientList = { id: string; label: string; emails: string[] };

const RECIPIENT_LISTS: RecipientList[] = [
  { id: "all", label: "All contacts", emails: makeAddresses("contact", 196) },
  { id: "newsletter", label: "Newsletter subscribers", emails: makeAddresses("news", 142) },
  { id: "buyers", label: "Recent buyers", emails: makeAddresses("buyer", 88) },
  { id: "vip", label: "VIP customers", emails: makeAddresses("vip", 24) },
  { id: "early-access", label: "Early access (draft — empty)", emails: [] },
];

/* ── Helpers ───────────────────────────────────────────────────── */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Flatten the block tree into the inline-styled HTML the dispatcher sends. */
function blocksToHtml(blocks: Block[]): string {
  const parts = blocks.map((block) => {
    switch (block.type) {
      case "heading":
        return `<h2 style="margin:0 0 12px;font-size:24px;line-height:1.3;font-weight:700;color:#171717;">${escapeHtml(block.text ?? "")}</h2>`;
      case "text":
        return `<p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#404040;">${escapeHtml(block.text ?? "").replace(/\n/g, "<br/>")}</p>`;
      case "image":
        return `<img src="${escapeHtml(block.src ?? "")}" alt="${escapeHtml(block.alt ?? "")}" width="600" style="display:block;width:100%;max-width:600px;height:auto;border-radius:8px;margin:0 0 16px;" />`;
      case "button":
        return `<p style="margin:0 0 16px;"><a href="${escapeHtml(block.href ?? "#")}" style="display:inline-block;background:#171717;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:8px;">${escapeHtml(block.text ?? "Learn more")}</a></p>`;
      case "divider":
        return `<hr style="border:none;border-top:1px solid #e5e5e5;margin:8px 0;" />`;
      case "spacer": {
        const height = block.size === "lg" ? 48 : block.size === "sm" ? 12 : 28;
        return `<div style="height:${height}px;"></div>`;
      }
      case "footer":
        return `<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e5e5e5;font-size:12px;line-height:1.7;color:#737373;text-align:center;white-space:pre-line;">${escapeHtml(block.text ?? "")}</p>`;
    }
  });
  return `<div style="font-family:Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;padding:8px 0;">${parts.join("")}</div>`;
}

/* ── Segmented control (Desktop / Mobile preview) ──────────────── */

function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (next: T) => void;
  options: { value: T; label: string; icon: typeof Monitor }[];
  ariaLabel: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-1 rounded-xl border border-border bg-surface-2 p-1"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "relative flex min-h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active && (
              <motion.span
                layoutId="email-preview-toggle"
                className="absolute inset-0 rounded-lg border border-border bg-background shadow-xs"
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              />
            )}
            <span className="relative flex items-center gap-1.5">
              <option.icon className="size-3.5" />
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ── Canvas block preview ──────────────────────────────────────── */

function BlockContent({
  block,
  selected,
  onCommit,
}: {
  block: Block;
  selected: boolean;
  onCommit: (text: string) => void;
}) {
  const editable = selected && (block.type === "heading" || block.type === "text" || block.type === "button");

  const editableProps = {
    contentEditable: editable,
    suppressContentEditableWarning: true,
    spellCheck: false,
    className: cn("rounded outline-none", editable && "focus-visible:ring-2 focus-visible:ring-primary/60"),
    onBlur: (e: React.FocusEvent<HTMLDivElement>) => onCommit(e.currentTarget.textContent ?? ""),
  };

  switch (block.type) {
    case "heading":
      return (
        <div
          {...editableProps}
          className={cn(editableProps.className, "text-[22px] leading-tight font-bold text-neutral-900")}
        >
          {block.text || "Heading"}
        </div>
      );
    case "text":
      return (
        <div
          {...editableProps}
          className={cn(
            editableProps.className,
            "text-[15px] leading-[1.65] whitespace-pre-wrap text-neutral-700",
          )}
        >
          {block.text || "Write your message…"}
        </div>
      );
    case "image":
      return block.src ? (
        <img
          src={block.src}
          alt={block.alt ?? ""}
          loading="lazy"
          className="block w-full rounded-lg object-cover"
          style={{ maxHeight: 260 }}
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      ) : (
        <div className="flex h-32 items-center justify-center rounded-lg bg-neutral-100 text-xs text-neutral-400">
          Image unavailable
        </div>
      );
    case "button":
      return (
        <span
          {...editableProps}
          className={cn(
            editableProps.className,
            "inline-block rounded-lg bg-neutral-900 px-6 py-3 text-sm font-semibold text-white",
          )}
        >
          {block.text || "Button label"}
        </span>
      );
    case "divider":
      return <hr className="border-0 border-t border-neutral-200" />;
    case "spacer":
      return <div className={cn(block.size === "lg" ? "h-12" : block.size === "sm" ? "h-3" : "h-7")} />;
    case "footer":
      return (
        <div className="border-t border-neutral-200 pt-4 text-center text-xs leading-[1.7] whitespace-pre-wrap text-neutral-500">
          {block.text}
        </div>
      );
  }
}

/* ── Page ──────────────────────────────────────────────────────── */

type MobilePane = "blocks" | "canvas" | "settings";
type PreviewMode = "desktop" | "mobile";

export default function EmailComposer() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { price, ngnPerPoint } = usePricing();
  /** Spec default: 1 point per recipient unless the admin configured a price. */
  const emailPrice = price("email_per_recipient", 1);

  const balanceNgn = useQuery(api.wallet.getBalance);
  const createCampaign = useMutation(api.assets.createCampaign);

  /* Blocks --------------------------------------------------------- */
  const [blocks, setBlocks] = useState<Block[]>(STARTER_BLOCKS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const blockEls = useRef(new Map<string, HTMLDivElement>());

  const selectedIndex = blocks.findIndex((b) => b.id === selectedId);
  const selectedBlock = selectedIndex >= 0 ? blocks[selectedIndex] : undefined;

  const addBlock = (type: BlockType, index?: number) => {
    const block = createBlock(type);
    setBlocks((prev) => {
      const next = [...prev];
      next.splice(index ?? next.length, 0, block);
      return next;
    });
    setSelectedId(block.id);
  };

  const updateBlock = (id: string, patch: Partial<Block>) =>
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));

  const moveBlock = (id: string, delta: number) =>
    setBlocks((prev) => {
      const from = prev.findIndex((b) => b.id === id);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });

  const duplicateBlock = (id: string) =>
    setBlocks((prev) => {
      const from = prev.findIndex((b) => b.id === id);
      if (from < 0) return prev;
      const copy = { ...prev[from], id: newId() };
      const next = [...prev];
      next.splice(from + 1, 0, copy);
      setSelectedId(copy.id);
      return next;
    });

  const deleteBlock = (id: string) => {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
    setSelectedId((current) => (current === id ? null : current));
  };

  /* Drag & drop ---------------------------------------------------- */
  const dropIndexFromEvent = (clientY: number) => {
    for (let i = 0; i < blocks.length; i += 1) {
      const el = blockEls.current.get(blocks[i].id);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return i;
    }
    return blocks.length;
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropIndex(dropIndexFromEvent(e.clientY));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const payload = e.dataTransfer.getData("text/plain");
    const index = dropIndexFromEvent(e.clientY);
    setDropIndex(null);
    if (payload.startsWith("new:")) {
      addBlock(payload.slice(4) as BlockType, index);
    } else if (payload.startsWith("move:")) {
      const id = payload.slice(5);
      setBlocks((prev) => {
        const from = prev.findIndex((b) => b.id === id);
        if (from < 0) return prev;
        const next = [...prev];
        const [moved] = next.splice(from, 1);
        next.splice(from < index ? index - 1 : index, 0, moved);
        return next;
      });
    }
  };

  /* Settings ------------------------------------------------------- */
  const now = new Date();
  const [subject, setSubject] = useState("");
  const [previewText, setPreviewText] = useState("");
  const [fromName, setFromName] = useState(user?.name ?? "");
  const [fromEmail, setFromEmail] = useState((user as { email?: string } | null)?.email ?? "");
  const [listId, setListId] = useState(RECIPIENT_LISTS[0].id);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("desktop");
  const [pane, setPane] = useState<MobilePane>("canvas");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [testing, setTesting] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const recipientList = RECIPIENT_LISTS.find((l) => l.id === listId) ?? RECIPIENT_LISTS[0];
  const recipientCount = recipientList.emails.length;

  /* Balance + cost -------------------------------------------------- */
  const [balanceTick, setBalanceTick] = useState(0);
  const [balanceStuck, setBalanceStuck] = useState(false);
  useEffect(() => {
    if (balanceNgn !== undefined) {
      setBalanceStuck(false);
      return;
    }
    const timer = window.setTimeout(() => setBalanceStuck(true), 8000);
    return () => window.clearTimeout(timer);
  }, [balanceNgn, balanceTick]);

  const rate = Number(ngnPerPoint) > 0 ? Number(ngnPerPoint) : 15;
  const pointsBalance =
    typeof balanceNgn === "number" ? Math.round(balanceNgn / rate) : undefined;
  const cost = recipientCount * emailPrice.points;
  const balanceAfter = pointsBalance !== undefined ? pointsBalance - cost : undefined;
  const insufficient = pointsBalance !== undefined && cost > pointsBalance;
  const balanceLoading = pointsBalance === undefined;

  /* Validation ------------------------------------------------------ */
  const subjectOk = subject.trim().length > 0;
  const fromEmailOk = EMAIL_RE.test(fromEmail.trim());
  const hasRecipients = recipientCount > 0;
  const canSend =
    subjectOk && fromEmailOk && hasRecipients && !insufficient && !balanceLoading && !sending;

  const emailHtml = useMemo(() => blocksToHtml(blocks), [blocks]);

  const handleSend = async () => {
    if (!canSend) return;
    setSendError(null);
    setSending(true);
    try {
      await createCampaign({
        subject: subject.trim(),
        senderName: fromName.trim() || "Cloudie",
        content: emailHtml,
        recipients: recipientList.emails,
      });
      toast.success(`Campaign queued for ${recipientCount} recipients.`);
      setConfirmOpen(false);
      navigate("/services/email");
    } catch (err) {
      const message = err instanceof Error ? err.message : "The campaign could not be sent.";
      setSendError(message.replace(/^MAX_RECIPIENTS:\s*/, ""));
      toast.error("Send failed");
      setConfirmOpen(false);
    } finally {
      setSending(false);
    }
  };

  const handleTestSend = async () => {
    const to = fromEmail.trim();
    if (!EMAIL_RE.test(to)) {
      toast.error("Enter a valid From email first");
      return;
    }
    setTesting(true);
    setSendError(null);
    try {
      await createCampaign({
        subject: `[TEST] ${subject.trim() || "Untitled campaign"}`,
        senderName: fromName.trim() || "Cloudie",
        content: emailHtml,
        recipients: [to],
      });
      toast.success(`Test email sent to ${to}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "The test email could not be sent.";
      setSendError(message);
      toast.error("Test send failed");
    } finally {
      setTesting(false);
    }
  };

  /* ── Pane content renderers ─────────────────────────────────── */

  const blocksPane = (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-3">
        <p className="text-xs font-semibold tracking-wide text-foreground uppercase">Blocks</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Drag onto the canvas, or click to add.
        </p>
      </div>
      <div className="flex flex-col gap-2 p-3">
        {BLOCK_LIBRARY.map(({ type, label, icon: Icon, hint }) => (
          <button
            key={type}
            type="button"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", `new:${type}`);
              e.dataTransfer.effectAllowed = "copy";
            }}
            onClick={() => addBlock(type)}
            className="group flex min-h-11 cursor-grab items-center gap-3 rounded-xl border border-border/70 bg-surface px-3 py-2.5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-sm active:cursor-grabbing"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors duration-200 group-hover:bg-primary/15">
              <Icon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-foreground">{label}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{hint}</span>
            </span>
            <GripVertical className="size-4 shrink-0 text-muted-foreground/60" />
          </button>
        ))}
      </div>
    </div>
  );

  const canvasPane = (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <p className="text-xs font-semibold tracking-wide text-foreground uppercase">Canvas</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {blocks.length} block{blocks.length === 1 ? "" : "s"} · click a block to edit it
          </p>
        </div>
        <SegmentedControl
          ariaLabel="Preview width"
          value={previewMode}
          onChange={setPreviewMode}
          options={[
            { value: "desktop", label: "Desktop", icon: Monitor },
            { value: "mobile", label: "Mobile", icon: Smartphone },
          ]}
        />
      </div>

      <div
        className="flex-1 overflow-y-auto bg-surface-2/40 px-4 py-10 sm:px-8"
        onClick={(e) => {
          if (e.target === e.currentTarget) setSelectedId(null);
        }}
        onDragOver={handleDragOver}
        onDragLeave={(e) => {
          if (e.target === e.currentTarget) setDropIndex(null);
        }}
        onDrop={handleDrop}
      >
        {/* The canvas is intentionally always a white card: the email must
            render exactly as it will in the inbox, in both app themes (same
            precedent as the QR code plate). */}
        <motion.div
          layout
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          className={cn(
            "mx-auto rounded-2xl border border-black/5 bg-white p-6 shadow-lg sm:p-8",
            previewMode === "mobile" ? "max-w-[375px]" : "max-w-[640px]",
          )}
        >
          {/* Header strip mimics the inbox chrome */}
          <div className="mb-5 flex items-center justify-between border-b border-neutral-100 pb-3">
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-full bg-neutral-900 text-[11px] font-bold text-white">
                {(fromName.trim() || "C").charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold text-neutral-900">
                  {subject.trim() || "No subject yet"}
                </p>
                <p className="truncate text-[11px] text-neutral-500">
                  {previewText.trim() || "Preview text appears here in the inbox"}
                </p>
              </div>
            </div>
            <span className="hidden text-[10px] text-neutral-400 sm:block">
              {now.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </span>
          </div>

          {blocks.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-neutral-200 px-6 py-12 text-center">
              <MailCheck className="size-6 text-neutral-300" />
              <p className="text-sm font-medium text-neutral-500">Your email is empty</p>
              <p className="text-xs text-neutral-400">
                Drag a block from the library, or click one to add it here.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {blocks.map((block, index) => {
                const selected = block.id === selectedId;
                return (
                  <div
                    key={block.id}
                    ref={(el) => {
                      if (el) blockEls.current.set(block.id, el);
                      else blockEls.current.delete(block.id);
                    }}
                    className="relative"
                  >
                    {/* drop indicator */}
                    {dropIndex === index && (
                      <span className="absolute -top-0.5 right-0 left-0 h-0.5 rounded bg-primary" />
                    )}

                    <AnimatePresence>
                      {selected && (
                        <motion.div
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 4 }}
                          transition={{ duration: 0.15 }}
                          className="absolute -top-3 left-1/2 z-10 flex -translate-x-1/2 -translate-y-full items-center gap-0.5 rounded-lg border border-border bg-background p-1 shadow-md"
                        >
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="size-7"
                            aria-label="Move block up"
                            disabled={index === 0}
                            onClick={() => moveBlock(block.id, -1)}
                          >
                            <ArrowUp className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="size-7"
                            aria-label="Move block down"
                            disabled={index === blocks.length - 1}
                            onClick={() => moveBlock(block.id, 1)}
                          >
                            <ArrowDown className="size-3.5" />
                          </Button>
                          <span className="mx-0.5 h-4 w-px bg-border" />
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="size-7"
                            aria-label="Duplicate block"
                            onClick={() => duplicateBlock(block.id)}
                          >
                            <Copy className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="size-7 text-error hover:text-error"
                            aria-label="Delete block"
                            onClick={() => deleteBlock(block.id)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <button
                      type="button"
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", `move:${block.id}`);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      aria-label={`Select ${block.type} block`}
                      onClick={() => setSelectedId(selected ? null : block.id)}
                      className={cn(
                        "block w-full cursor-pointer rounded-lg p-2 text-left transition-[box-shadow,background-color] duration-200",
                        selected
                          ? "ring-2 ring-primary ring-offset-2 ring-offset-white"
                          : "hover:bg-neutral-50",
                      )}
                    >
                      <BlockContent
                        block={block}
                        selected={selected}
                        onCommit={(text) => updateBlock(block.id, { text })}
                      />
                    </button>
                  </div>
                );
              })}
              {dropIndex === blocks.length && (
                <span className="block h-0.5 rounded bg-primary" />
              )}
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );

  const settingsPane = (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="border-b border-border px-4 py-3">
        <p className="text-xs font-semibold tracking-wide text-foreground uppercase">Settings</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">Message details and delivery.</p>
      </div>

      <div className="space-y-5 p-4">
        {sendError && (
          <div className="flex items-start gap-2 rounded-xl border border-error/30 bg-error/12 p-3 text-xs text-error">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <p className="min-w-0 flex-1 break-words">{sendError}</p>
            <button
              type="button"
              className="shrink-0 font-semibold underline-offset-2 hover:underline"
              onClick={() => setSendError(null)}
            >
              Dismiss
            </button>
          </div>
        )}

        {balanceStuck && (
          <div className="space-y-2 rounded-xl border border-error/30 bg-error/12 p-3">
            <p className="text-xs font-medium text-error">
              We couldn&apos;t load your points balance. Sending is paused until it loads.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setBalanceStuck(false);
                setBalanceTick((t) => t + 1);
              }}
            >
              Retry
            </Button>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="campaign-subject">Subject</Label>
          <Input
            id="campaign-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="What's new this month"
            maxLength={150}
          />
          <p className="text-[11px] text-muted-foreground">{subject.length}/150</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="campaign-preview-text">Preview text</Label>
          <Textarea
            id="campaign-preview-text"
            value={previewText}
            onChange={(e) => setPreviewText(e.target.value)}
            placeholder="The line readers see after the subject in their inbox"
            rows={2}
            className="min-h-0"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="campaign-from-name">From name</Label>
          <Input
            id="campaign-from-name"
            value={fromName}
            onChange={(e) => setFromName(e.target.value)}
            placeholder="Cloudie Team"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="campaign-from-email">From email</Label>
          <Input
            id="campaign-from-email"
            type="email"
            value={fromEmail}
            onChange={(e) => setFromEmail(e.target.value)}
            placeholder="hello@cloudie.example.com"
            aria-invalid={fromEmail.length > 0 && !fromEmailOk}
          />
          {fromEmail.length > 0 && !fromEmailOk && (
            <p className="text-[11px] text-error">Enter a valid email address.</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="campaign-recipients">Recipients</Label>
          <Select value={listId} onValueChange={setListId}>
            <SelectTrigger id="campaign-recipients" className="w-full" aria-label="Recipient list">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RECIPIENT_LISTS.map((list) => (
                <SelectItem key={list.id} value={list.id}>
                  {list.label} ({list.emails.length})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1.5 pt-0.5">
            <Users className="size-3.5 text-muted-foreground" />
            {balanceLoading ? (
              <Skeleton className="h-3.5 w-20" />
            ) : (
              <span className="text-[11px] font-medium text-muted-foreground">
                {recipientCount} recipient{recipientCount === 1 ? "" : "s"} ·{" "}
                {recipientList.label}
              </span>
            )}
          </div>
        </div>

        <Button
          variant="outline"
          className="w-full gap-2"
          disabled={testing || balanceLoading}
          onClick={handleTestSend}
        >
          {testing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <MailCheck className="size-4" />
          )}
          Test-send to my inbox
        </Button>

        {/* Cost panel */}
        <div className="space-y-3 rounded-xl border border-border bg-surface-2/60 p-3.5">
          {balanceLoading ? (
            <div className="space-y-2" role="status" aria-label="Loading cost">
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-2/3" />
            </div>
          ) : (
            <>
              <p className="text-xs leading-5 text-foreground">
                <span className="font-semibold">Cost:</span> {emailPrice.points} point
                {emailPrice.points === 1 ? "" : "s"} per recipient ·{" "}
                <span className="font-semibold">{recipientCount} recipient{recipientCount === 1 ? "" : "s"}</span>{" "}
                · Balance after:{" "}
                {balanceAfter !== undefined && balanceAfter >= 0 ? (
                  <span className="font-semibold">{balanceAfter}</span>
                ) : (
                  <span className="font-semibold text-error">—</span>
                )}
              </p>
              <p className="text-[11px] text-muted-foreground">
                ≈ {(cost * rate).toLocaleString("en-NG", { maximumFractionDigits: 0 })} NGN ·
                balance {pointsBalance} pts
              </p>

              {!hasRecipients && (
                <div className="flex items-start gap-2 rounded-lg border border-border bg-background p-2.5 text-[11px] leading-4 text-muted-foreground">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  This list has no recipients yet. Pick another list to send.
                </div>
              )}

              {insufficient && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-warning/30 bg-warning/12 p-2.5 text-[11px] leading-4 text-warning">
                  <span className="font-medium">
                    Not enough points — you need {cost - (pointsBalance ?? 0)} more.
                  </span>
                  <Link
                    to="/buy-points"
                    className="font-semibold underline underline-offset-2 hover:no-underline"
                  >
                    Top up
                  </Link>
                </div>
              )}
            </>
          )}
        </div>

        <Button size="lg" className="w-full gap-2" disabled={!canSend} onClick={() => setConfirmOpen(true)}>
          {sending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
          Send campaign (−{cost} pts)
        </Button>

        {!subjectOk && (
          <p className="text-center text-[11px] text-muted-foreground">Add a subject to send.</p>
        )}
      </div>
    </div>
  );

  /* ── Page shell ─────────────────────────────────────────────── */

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Button variant="outline" size="icon" asChild aria-label="Back to email campaigns">
            <Link to="/services/email">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div className="min-w-0">
            <p className="section-label text-primary">Email marketing</p>
            <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-foreground">
              New campaign
            </h1>
          </div>
        </div>
        <Badge variant="secondary" className="w-fit gap-1.5">
          <span className="size-1.5 rounded-full bg-primary" />
          {emailPrice.points} pt per recipient
        </Badge>
      </div>

      {/* Three-pane composer */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        {/* Mobile: stacked tabs */}
        <div className="border-b border-border p-2 lg:hidden">
          <div className="inline-flex w-full items-center gap-1 rounded-xl bg-surface-2 p-1">
            {(
              [
                { value: "blocks", label: "Blocks", icon: GripVertical },
                { value: "canvas", label: "Canvas", icon: Monitor },
                { value: "settings", label: "Settings", icon: MousePointerClick },
              ] as { value: MobilePane; label: string; icon: typeof Monitor }[]
            ).map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => setPane(tab.value)}
                aria-pressed={pane === tab.value}
                className={cn(
                  "relative flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors duration-200",
                  pane === tab.value ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {pane === tab.value && (
                  <motion.span
                    layoutId="email-pane-tab"
                    className="absolute inset-0 rounded-lg border border-border bg-background shadow-xs"
                    transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                  />
                )}
                <span className="relative flex items-center gap-1.5">
                  <tab.icon className="size-3.5" />
                  {tab.label}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="lg:grid lg:grid-cols-[240px_minmax(0,1fr)_320px] lg:items-start">
          {/* Left — Blocks */}
          <aside
            className={cn(
              "border-b border-border lg:block lg:max-h-[calc(100dvh-14rem)] lg:overflow-y-auto lg:border-r lg:border-b-0",
              pane === "blocks" ? "block" : "hidden",
            )}
          >
            {blocksPane}
          </aside>

          {/* Center — Canvas */}
          <main
            className={cn(
              "lg:block lg:max-h-[calc(100dvh-14rem)] lg:overflow-hidden",
              pane === "canvas" ? "block" : "hidden",
            )}
          >
            {canvasPane}
          </main>

          {/* Right — Settings */}
          <aside
            className={cn(
              "border-t border-border lg:block lg:max-h-[calc(100dvh-14rem)] lg:overflow-y-auto lg:border-t-0 lg:border-l",
              pane === "settings" ? "block" : "hidden",
            )}
          >
            {settingsPane}
          </aside>
        </div>
      </div>

      {/* Send confirmation */}
      <Dialog open={confirmOpen} onOpenChange={(open) => !open && !sending && setConfirmOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send to {recipientCount} recipients?</DialogTitle>
            <DialogDescription>
              This will cost {cost} points. Balance after:{" "}
              {balanceAfter !== undefined && balanceAfter >= 0 ? balanceAfter : "—"}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="rounded-xl border border-border bg-surface-2/60 p-3.5 text-xs leading-5">
              <p className="truncate">
                <span className="text-muted-foreground">Subject:</span>{" "}
                <span className="font-medium text-foreground">{subject.trim()}</span>
              </p>
              <p className="truncate pt-1">
                <span className="text-muted-foreground">From:</span>{" "}
                <span className="font-medium text-foreground">
                  {fromName.trim() || "Cloudie"} &lt;{fromEmail.trim()}&gt;
                </span>
              </p>
              <p className="truncate pt-1">
                <span className="text-muted-foreground">List:</span>{" "}
                <span className="font-medium text-foreground">
                  {recipientList.label} · {recipientCount} recipients
                </span>
              </p>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Emails start sending immediately and cannot be recalled.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" disabled={sending} onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={sending} onClick={handleSend}>
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Send {cost} pts
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
