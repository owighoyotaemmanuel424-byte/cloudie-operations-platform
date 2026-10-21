import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Download,
  Frame,
  ImagePlus,
  Loader2,
  MonitorPlay,
  RectangleHorizontal,
  RotateCcw,
  Smartphone,
  Sparkles,
  Square,
  Type,
  Palette,
} from "lucide-react";
import { toast } from "sonner";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { usePricing } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

/* ── Templates ─────────────────────────────────────────────────── */

type Shape = "circle" | "square" | "none";

type Template = {
  id: string;
  name: string;
  width: number;
  height: number;
  icon: typeof Square;
  hint: string;
};

const TEMPLATES: Template[] = [
  { id: "social", name: "Social post", width: 1080, height: 1080, icon: Square, hint: "1:1 feed" },
  { id: "banner", name: "Web banner", width: 1200, height: 630, icon: RectangleHorizontal, hint: "1.9:1 header" },
  { id: "story", name: "Story", width: 1080, height: 1920, icon: Smartphone, hint: "9:16 vertical" },
  { id: "thumbnail", name: "Thumbnail", width: 1280, height: 720, icon: MonitorPlay, hint: "16:9 cover" },
  { id: "poster", name: "Poster", width: 800, height: 1200, icon: Frame, hint: "2:3 print" },
];

type Params = {
  headline: string;
  subtitle: string;
  background: string;
  accent: string;
  shape: Shape;
  imageDataUrl: string | null;
};

const DEFAULT_PARAMS: Params = {
  headline: "Your next idea starts here",
  subtitle: "One canvas, every channel. Render on-brand artwork in seconds.",
  background: "#0b1220",
  accent: "#34d399",
  shape: "circle",
  imageDataUrl: null,
};

const BACKGROUNDS = ["#0b1220", "#111827", "#1c1917", "#0f2f2b", "#f8fafc", "#fdf6e9", "#eef2ff"];
const ACCENTS = ["#34d399", "#38bdf8", "#fbbf24", "#fb923c", "#a3e635", "#f87171"];

/* ── Canvas painting ───────────────────────────────────────────── */

function isLight(hex: string): boolean {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return false;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62;
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function paint(ctx: CanvasRenderingContext2D, tpl: Template, params: Params, overlay: HTMLImageElement | null) {
  const w = tpl.width;
  const h = tpl.height;
  const light = isLight(params.background);
  const ink = light ? "#111827" : "#ffffff";
  const softInk = light ? "rgba(17,24,39,0.66)" : "rgba(255,255,255,0.72)";

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = params.background;
  ctx.fillRect(0, 0, w, h);

  // One soft accent bloom, kept far from the text block so copy stays readable.
  const glow = ctx.createRadialGradient(w * 0.86, h * 0.14, 4, w * 0.86, h * 0.14, Math.max(w, h) * 0.72);
  glow.addColorStop(0, `${params.accent}${light ? "26" : "3d"}`);
  glow.addColorStop(1, `${params.background}00`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  const unit = Math.min(w, h);

  if (overlay) {
    const radius = unit * 0.13;
    ctx.save();
    ctx.beginPath();
    ctx.arc(w * 0.77, h * 0.24, radius, 0, Math.PI * 2);
    ctx.clip();
    const scale = Math.max((radius * 2) / overlay.width, (radius * 2) / overlay.height);
    const dw = overlay.width * scale;
    const dh = overlay.height * scale;
    ctx.drawImage(overlay, w * 0.77 - dw / 2, h * 0.24 - dh / 2, dw, dh);
    ctx.restore();
  } else if (params.shape !== "none") {
    ctx.fillStyle = params.accent;
    if (params.shape === "circle") {
      ctx.beginPath();
      ctx.arc(w * 0.77, h * 0.24, unit * 0.11, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(w * 0.66, h * 0.24 - unit * 0.11, unit * 0.22, unit * 0.22);
    }
  }

  const margin = w * 0.09;
  const maxWidth = w * 0.74;
  const titleSize = Math.round(unit * (tpl.id === "story" ? 0.082 : tpl.id === "banner" ? 0.104 : 0.094));
  const bodySize = Math.round(titleSize * 0.38);

  ctx.textBaseline = "top";
  ctx.fillStyle = ink;
  ctx.font = `700 ${titleSize}px "Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif`;

  const titleLines = wrapLines(ctx, params.headline || "Untitled render", maxWidth).slice(0, 4);
  let y = h * 0.36;
  for (const line of titleLines) {
    ctx.fillText(line, margin, y, maxWidth);
    y += titleSize * 1.12;
  }

  ctx.fillStyle = params.accent;
  ctx.fillRect(margin, y + titleSize * 0.28, w * 0.12, Math.max(6, w * 0.009));

  ctx.fillStyle = softInk;
  ctx.font = `500 ${bodySize}px "Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif`;
  let subY = y + titleSize * 0.28 + Math.max(18, w * 0.02) + bodySize * 0.9;
  const subLines = wrapLines(ctx, params.subtitle, maxWidth * 0.94).slice(0, 4);
  for (const line of subLines) {
    ctx.fillText(line, margin, subY, maxWidth);
    subY += bodySize * 1.42;
  }
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function renderPng(tpl: Template, params: Params): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = tpl.width;
  canvas.height = tpl.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const overlay = params.imageDataUrl ? await loadImage(params.imageDataUrl) : null;
  paint(ctx, tpl, params, overlay);
  return await new Promise<Blob | null>((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
}

function fileNameFor(tpl: Template): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `cloudie-${tpl.id}-${stamp}.png`;
}

/* ── Page ──────────────────────────────────────────────────────── */

const STAGES = ["Charging points", "Drawing canvas", "Uploading PNG", "Saving to assets"] as const;

/**
 * Each stage stays visible for at least this long. A local render can finish in
 * a few milliseconds, and a progress panel that flickers past is worse than no
 * panel at all — this keeps the job readable without meaningfully delaying it.
 */
const MIN_STAGE_MS = 260;
const stageHold = () => new Promise((resolve) => setTimeout(resolve, MIN_STAGE_MS));

type RenderResult = { url: string; name: string; fileId: string | null };

export default function ImageStudio() {
  const { price, ngnPerPoint } = usePricing();
  /** Spec default: 1 point per render unless an admin configured a price. */
  const renderPrice = price("image_render", 1);

  const balanceNgn = useQuery(api.wallet.getBalance);
  const createJob = useMutation(api.imageRender.createJob);
  const completeJob = useMutation(api.imageRender.completeJob);
  const failJob = useMutation(api.imageRender.failJob);
  const generateUploadUrl = useMutation(api.storage.generateUploadUrl);
  const registerFile = useMutation(api.storage.registerFile);

  const [templateId, setTemplateId] = useState(TEMPLATES[0].id);
  const template = TEMPLATES.find((t) => t.id === templateId) ?? TEMPLATES[0];
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const [stage, setStage] = useState(0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RenderResult | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLImageElement | null>(null);
  const [overlayTick, setOverlayTick] = useState(0);

  /* Balance → points (same conversion the wallet surfaces use). */
  const rate = Number(ngnPerPoint) > 0 ? Number(ngnPerPoint) : 15;
  const pointsBalance =
    typeof balanceNgn === "number" && Number.isFinite(balanceNgn)
      ? Math.round(balanceNgn / rate)
      : undefined;
  const cost = renderPrice.points;
  const balanceAfter = pointsBalance !== undefined ? pointsBalance - cost : undefined;
  const insufficient = pointsBalance !== undefined && cost > pointsBalance;
  const balanceLoading = pointsBalance === undefined;
  const canRender = !running && !insufficient && !balanceLoading;

  const patch = (next: Partial<Params>) => setParams((prev) => ({ ...prev, ...next }));

  /* Overlay image: decode once per file, then repaint. */
  useEffect(() => {
    if (!params.imageDataUrl) {
      overlayRef.current = null;
      setOverlayTick((t) => t + 1);
      return;
    }
    let cancelled = false;
    void loadImage(params.imageDataUrl).then((img) => {
      if (cancelled) return;
      overlayRef.current = img;
      setOverlayTick((t) => t + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [params.imageDataUrl]);

  /* Live preview: repaint the on-screen canvas whenever a param changes. */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = template.width;
    canvas.height = template.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    paint(ctx, template, params, overlayRef.current);
  }, [template, params, overlayTick]);

  /* Release the object URL when a new result replaces it or the page unmounts. */
  useEffect(() => {
    const url = result?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [result?.url]);

  const handleImage = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Choose an image file.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error("Choose an image under 8 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => patch({ imageDataUrl: typeof reader.result === "string" ? reader.result : null });
    reader.readAsDataURL(file);
  };

  const handleRender = async () => {
    if (running) return;
    setError(null);
    setResult(null);
    setRunning(true);

    let jobId: string | null = null;
    try {
      setStage(1);
      const started = (await createJob({
        template: template.id,
        // Only a flag for the referenced artwork — never the data URL itself.
        params: {
          headline: params.headline,
          subtitle: params.subtitle,
          background: params.background,
          accent: params.accent,
          shape: params.shape,
          hasImage: Boolean(params.imageDataUrl),
        },
      })) as { jobId?: unknown; pointsCost?: unknown } | undefined;
      jobId = typeof started?.jobId === "string" ? started.jobId : null;

      await stageHold();
      setStage(2);
      const blob = await renderPng(template, params);
      if (!blob) throw new Error("The canvas could not be exported. Try a smaller overlay image.");

      await stageHold();
      setStage(3);
      let fileId: string | null = null;
      const uploadUrl = (await generateUploadUrl({})) as unknown;
      if (typeof uploadUrl === "string" && /^https?:/.test(uploadUrl)) {
        const name = fileNameFor(template);
        const upload = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": "image/png" },
          body: blob,
        });
        if (!upload.ok) throw new Error("The render could not be uploaded to your storage.");
        const body = (await upload.json()) as { storageId?: string };
        if (!body.storageId) throw new Error("Storage did not return a file id.");

        setStage(4);
        const registered = (await registerFile({
          storageId: body.storageId as Id<"_storage">,
          kind: "image",
          originalName: name,
          folder: "renders",
        })) as unknown;
        fileId =
          typeof registered === "string"
            ? registered
            : typeof (registered as { fileId?: unknown } | undefined)?.fileId === "string"
              ? ((registered as { fileId: string }).fileId)
              : null;

        if (fileId && jobId) {
          await completeJob({
            jobId: jobId as Id<"imageRenderJobs">,
            fileId: fileId as Id<"storageFiles">,
          });
        }
      }

      setResult({ url: URL.createObjectURL(blob), name: fileNameFor(template), fileId });
      toast.success("Render complete.");
    } catch (err) {
      const message =
        err instanceof Error ? err.message.replace(/^INSUFFICIENT_POINTS:\s*/, "") : "The render failed.";
      if (jobId) {
        await failJob({ jobId: jobId as Id<"imageRenderJobs">, reason: message }).catch(() => undefined);
      }
      setError(message);
      toast.error("Render failed");
    } finally {
      setStage(0);
      setRunning(false);
    }
  };

  const reset = () => {
    setParams(DEFAULT_PARAMS);
    setResult(null);
    setError(null);
  };

  const progressValue = useMemo(() => (stage === 0 ? 0 : Math.round((stage / STAGES.length) * 100)), [stage]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Button variant="outline" size="icon" asChild aria-label="Back to services">
            <Link to="/services">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div className="min-w-0">
            <p className="section-label text-primary">Creative studio</p>
            <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-foreground">Image studio</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="gap-1.5">
            <span className="size-1.5 rounded-full bg-primary" />
            {renderPrice.points} pt per render
          </Badge>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={reset}>
            <RotateCcw className="size-3.5" />
            Reset
          </Button>
        </div>
      </div>

      {/* Template picker */}
      <div>
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <p className="text-xs font-semibold tracking-wide text-foreground uppercase">Templates</p>
          <p className="text-[11px] text-muted-foreground">Swipe for more sizes</p>
        </div>
        <div className="-mx-1 flex snap-x gap-2.5 overflow-x-auto px-1 pb-2">
          {TEMPLATES.map((tpl) => {
            const active = tpl.id === template.id;
            return (
              <button
                key={tpl.id}
                type="button"
                onClick={() => setTemplateId(tpl.id)}
                aria-pressed={active}
                className={cn(
                  "group w-[148px] shrink-0 snap-start rounded-xl border p-2.5 text-left transition-[border-color,box-shadow,background-color] duration-200 outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary"
                    : "border-border bg-card hover:border-primary/40 hover:shadow-sm",
                )}
              >
                <span
                  className={cn(
                    "relative flex w-full items-center justify-center overflow-hidden rounded-lg",
                    active ? "bg-primary/10 text-primary" : "bg-surface-2 text-muted-foreground",
                  )}
                  style={{
                    aspectRatio: `${tpl.width} / ${tpl.height}`,
                    maxHeight: 74,
                  }}
                >
                  <tpl.icon className="size-6" strokeWidth={1.6} />
                  {active && (
                    <span className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check className="size-2.5" strokeWidth={3} />
                    </span>
                  )}
                </span>
                <span className="mt-2 block truncate text-[13px] font-semibold text-foreground">{tpl.name}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {tpl.width} × {tpl.height}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Param form + live preview */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <section className="rounded-2xl border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <p className="text-xs font-semibold tracking-wide text-foreground uppercase">Parameters</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Edits apply to the preview instantly.</p>
          </div>

          <div className="space-y-5 p-4">
            <div className="space-y-1.5">
              <Label htmlFor="studio-headline" className="flex items-center gap-1.5">
                <Type className="size-3.5 text-muted-foreground" />
                Headline
              </Label>
              <Input
                id="studio-headline"
                value={params.headline}
                maxLength={90}
                onChange={(e) => patch({ headline: e.target.value })}
                placeholder="Say it in eight words or fewer"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="studio-subtitle">Supporting text</Label>
              <Input
                id="studio-subtitle"
                value={params.subtitle}
                maxLength={140}
                onChange={(e) => patch({ subtitle: e.target.value })}
                placeholder="One line of context"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="studio-image" className="flex items-center gap-1.5">
                <ImagePlus className="size-3.5 text-muted-foreground" />
                Overlay image
              </Label>
              <Input
                id="studio-image"
                type="file"
                accept="image/*"
                className="cursor-pointer file:cursor-pointer"
                onChange={(e) => handleImage(e.target.files?.[0])}
              />
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-muted-foreground">Optional · PNG or JPG up to 8 MB</p>
                {params.imageDataUrl && (
                  <button
                    type="button"
                    className="text-[11px] font-semibold text-primary underline-offset-2 hover:underline"
                    onClick={() => patch({ imageDataUrl: null })}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <Palette className="size-3.5 text-muted-foreground" />
                Background
              </Label>
              <div className="flex flex-wrap items-center gap-1.5">
                {BACKGROUNDS.map((swatch) => (
                  <button
                    key={swatch}
                    type="button"
                    aria-label={`Background ${swatch}`}
                    aria-pressed={params.background.toLowerCase() === swatch.toLowerCase()}
                    onClick={() => patch({ background: swatch })}
                    className={cn(
                      "size-7 rounded-full border transition-transform duration-200 hover:scale-105",
                      params.background.toLowerCase() === swatch.toLowerCase()
                        ? "border-primary ring-2 ring-primary ring-offset-1 ring-offset-card"
                        : "border-border",
                    )}
                    style={{ backgroundColor: swatch }}
                  />
                ))}
                <Input
                  type="color"
                  aria-label="Custom background colour"
                  value={params.background}
                  onChange={(e) => patch({ background: e.target.value })}
                  className="h-8 w-10 cursor-pointer p-1"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Accent</Label>
              <div className="flex flex-wrap items-center gap-1.5">
                {ACCENTS.map((swatch) => (
                  <button
                    key={swatch}
                    type="button"
                    aria-label={`Accent ${swatch}`}
                    aria-pressed={params.accent.toLowerCase() === swatch.toLowerCase()}
                    onClick={() => patch({ accent: swatch })}
                    className={cn(
                      "size-7 rounded-full border transition-transform duration-200 hover:scale-105",
                      params.accent.toLowerCase() === swatch.toLowerCase()
                        ? "border-primary ring-2 ring-primary ring-offset-1 ring-offset-card"
                        : "border-border",
                    )}
                    style={{ backgroundColor: swatch }}
                  />
                ))}
                <Input
                  type="color"
                  aria-label="Custom accent colour"
                  value={params.accent}
                  onChange={(e) => patch({ accent: e.target.value })}
                  className="h-8 w-10 cursor-pointer p-1"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="studio-shape">Accent shape</Label>
              <Select value={params.shape} onValueChange={(value) => patch({ shape: value as Shape })}>
                <SelectTrigger id="studio-shape" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="circle">Circle</SelectItem>
                  <SelectItem value="square">Square</SelectItem>
                  <SelectItem value="none">No shape</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                An overlay image replaces the shape in the top-right corner.
              </p>
            </div>
          </div>
        </section>

        {/* Live preview — deliberately a white plate: the artwork is the subject,
            so the chrome around it must not tint the colours being judged. */}
        <section className="rounded-2xl border border-border bg-card">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold tracking-wide text-foreground uppercase">Live preview</p>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {template.name} · {template.width} × {template.height} px · {template.hint}
              </p>
            </div>
            <Badge variant="outline" className="shrink-0 gap-1">
              <Sparkles className="size-3" />
              {template.id}
            </Badge>
          </div>

          <div className="flex items-center justify-center bg-surface-2/50 p-4 sm:p-6">
            <div className="w-full max-w-[560px] rounded-xl bg-white p-3 shadow-lg sm:p-4">
              <canvas
                ref={canvasRef}
                aria-label={`${template.name} preview`}
                className="block h-auto max-h-[62vh] w-full rounded-lg object-contain"
                style={{ aspectRatio: `${template.width} / ${template.height}` }}
              />
              <div className="mt-2 flex items-center justify-between gap-2 px-0.5">
                <p className="truncate text-[10px] font-medium tracking-wide text-neutral-500 uppercase">
                  {params.headline.trim() || "Untitled render"}
                </p>
                <p className="shrink-0 text-[10px] text-neutral-400">
                  {template.width} × {template.height}
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Job progress / result / error */}
      <AnimatePresence mode="wait" initial={false}>
        {running && (
          <motion.div
            key="progress"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            className="rounded-2xl border border-border bg-card p-4"
            role="status"
            aria-live="polite"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold tracking-wide text-foreground uppercase">Render job</p>
              <span className="text-[11px] font-medium text-muted-foreground">
                Step {Math.min(stage, STAGES.length)} of {STAGES.length}
              </span>
            </div>
            <Progress value={progressValue} className="mt-2 h-1.5" />
            <ol className="mt-3 grid gap-1.5 sm:grid-cols-2">
              {STAGES.map((label, i) => {
                const index = i + 1;
                const done = stage > index;
                const active = stage === index;
                return (
                  <li key={label} className="flex items-center gap-2 text-[11px]">
                    <span
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded-full border",
                        done
                          ? "border-primary bg-primary text-primary-foreground"
                          : active
                            ? "border-primary text-primary"
                            : "border-border text-muted-foreground",
                      )}
                    >
                      {done ? (
                        <Check className="size-2.5" strokeWidth={3} />
                      ) : active ? (
                        <Loader2 className="size-2.5 animate-spin" />
                      ) : null}
                    </span>
                    <span className={cn(done || active ? "font-medium text-foreground" : "text-muted-foreground")}>
                      {label}
                    </span>
                  </li>
                );
              })}
            </ol>
          </motion.div>
        )}

        {!running && result && (
          <motion.div
            key="result"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            className="rounded-2xl border border-border bg-card p-4"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-border bg-white p-1">
                <img src={result.url} alt="Rendered image" className="h-full w-full rounded-lg object-cover" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">{result.name}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {template.width} × {template.height} px · PNG · {cost} pt charged
                </p>
                {result.fileId ? (
                  <Link
                    to="/app/services/assets?folder=renders"
                    className="mt-1 inline-block text-[11px] font-semibold text-primary underline-offset-2 hover:underline"
                  >
                    Open in assets
                  </Link>
                ) : (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Download available now — asset storage is not connected in this environment.
                  </p>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                <Button variant="outline" className="gap-1.5" onClick={handleRender} disabled={!canRender}>
                  <RotateCcw className="size-4" />
                  Re-render
                </Button>
                <Button asChild className="gap-1.5">
                  <a href={result.url} download={result.name}>
                    <Download className="size-4" />
                    Download
                  </a>
                </Button>
              </div>
            </div>
          </motion.div>
        )}

        {!running && error && (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-error/30 bg-error/10 px-4 py-3 text-xs text-error"
            role="alert"
          >
            <AlertTriangle className="size-4 shrink-0" />
            <p className="min-w-0 flex-1">{error}</p>
            <Button variant="outline" size="sm" onClick={handleRender} disabled={!canRender}>
              Retry
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setError(null)}>
              Dismiss
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sticky action bar */}
      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 rounded-2xl border border-border bg-card/95 px-3 py-3 backdrop-blur-xl sm:px-5 lg:bottom-0">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-1">
            {balanceLoading ? (
              <Skeleton className="h-3.5 w-56" />
            ) : (
              <p className="text-xs leading-5 text-foreground">
                <span className="font-semibold">Cost:</span> {cost} point{cost === 1 ? "" : "s"} per render ·
                Balance after:{" "}
                {balanceAfter !== undefined && balanceAfter >= 0 ? (
                  <span className="font-semibold">{balanceAfter}</span>
                ) : (
                  <span className="font-semibold text-error">—</span>
                )}
              </p>
            )}
            <p className="text-[11px] text-muted-foreground">
              {balanceLoading ? "Checking your balance…" : `${pointsBalance} pts available`}
            </p>
            {insufficient && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-warning/30 bg-warning/12 px-2.5 py-1.5 text-[11px] leading-4 text-warning">
                <span className="font-medium">
                  Not enough points — you need {cost - (pointsBalance ?? 0)} more.
                </span>
                <Link to="/buy-points" className="font-semibold underline underline-offset-2 hover:no-underline">
                  Top up
                </Link>
              </div>
            )}
          </div>

          <Button size="lg" className="w-full gap-2 sm:w-auto" onClick={handleRender} disabled={!canRender}>
            {running ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {running ? "Rendering…" : `Render image (−${cost} pt${cost === 1 ? "" : "s"})`}
          </Button>
        </div>
      </div>
    </div>
  );
}
