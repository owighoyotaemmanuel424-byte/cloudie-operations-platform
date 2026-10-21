import {
  Component,
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type ReactNode,
} from "react";
import { Link, useSearchParams } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronRight,
  CloudUpload,
  Copy,
  File as FileIcon,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderInput,
  FolderOpen,
  HardDrive,
  House,
  Image as ImageIcon,
  LayoutGrid,
  List as ListIcon,
  Loader2,
  MoreHorizontal,
  Pencil,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";

/* ── Policy + formatting ───────────────────────────────────────── */

/** Mirrors the free-tier allowance the backend reports in `storage.getUsage`. */
const FALLBACK_QUOTA_BYTES = 5 * 1024 * 1024 * 1024;

const GENERIC_TYPES = [
  "text/csv",
  "text/plain",
  "application/json",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

type FileRow = {
  fileId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  kind: "kyc_document" | "pdf_document" | "image" | "generic";
  createdAt: number;
  folder: string;
  url?: string;
};

type ViewMode = "grid" | "list";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 100 || unit === 0 ? Math.round(value) : Number(value.toFixed(1));
  return `${rounded} ${units[unit]}`;
}

function normalizeFolder(value: string | null): string {
  return (value ?? "").replace(/^\/+|\/+$/g, "");
}

function kindOf(mimeType: string): "image" | "pdf_document" | "generic" {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "application/pdf") return "pdf_document";
  return "generic";
}

function fileIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) return ImageIcon;
  if (mimeType === "application/pdf") return FileText;
  if (mimeType.includes("spreadsheet") || mimeType === "text/csv") return FileSpreadsheet;
  return FileIcon;
}

function shortDate(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/* ── Load-error boundary ───────────────────────────────────────── */

class AssetBoundary extends Component<{ children: ReactNode }, { failed: boolean; attempt: number }> {
  state = { failed: false, attempt: 0 };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="rounded-2xl border border-border bg-card p-8 text-center">
          <div className="mx-auto flex size-10 items-center justify-center rounded-lg bg-error/12 text-error">
            <AlertTriangle className="size-5" />
          </div>
          <p className="mt-3 text-sm font-semibold text-foreground">We couldn&apos;t load your assets</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
            The storage service did not answer. Your files are safe — try again in a moment.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => this.setState((prev) => ({ failed: false, attempt: prev.attempt + 1 }))}
          >
            Try again
          </Button>
        </div>
      );
    }
    return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>;
  }
}

/* ── Row menu ──────────────────────────────────────────────────── */

function AssetMenu({
  file,
  onCopy,
  onRename,
  onMove,
  onDelete,
  className,
}: {
  file: FileRow;
  onCopy: (file: FileRow) => void;
  onRename: (file: FileRow) => void;
  onMove: (file: FileRow) => void;
  onDelete: (file: FileRow) => void;
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Actions for ${file.name}`}
          className={cn("size-7 bg-background/85 shadow-xs backdrop-blur hover:bg-background", className)}
          onClick={(event) => event.stopPropagation()}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onSelect={() => onCopy(file)}>
          <Copy className="size-3.5" />
          Copy URL
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onRename(file)}>
          <Pencil className="size-3.5" />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onMove(file)}>
          <FolderInput className="size-3.5" />
          Move
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => onDelete(file)}>
          <Trash2 className="size-3.5" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ── Page ──────────────────────────────────────────────────────── */

export default function AssetManager() {
  return (
    <AssetBoundary>
      <AssetManagerInner />
    </AssetBoundary>
  );
}

function AssetManagerInner() {
  const [searchParams, setSearchParams] = useSearchParams();
  const folder = normalizeFolder(searchParams.get("folder"));

  const [view, setView] = useState<ViewMode>("grid");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [opError, setOpError] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<FileRow | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [moveTargets, setMoveTargets] = useState<FileRow[] | null>(null);
  const [moveValue, setMoveValue] = useState("");
  const [deleteTargets, setDeleteTargets] = useState<FileRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);

  const rawFiles = useQuery(api.storage.listMyFiles, { limit: 100, folder, includeUrls: true });
  const rawFolders = useQuery(api.storage.listFolders, { parent: folder });
  const rawUsage = useQuery(api.storage.getUsage);

  const generateUploadUrl = useMutation(api.storage.generateUploadUrl);
  const registerFile = useMutation(api.storage.registerFile);
  const getFileUrl = useMutation(api.storage.getFileUrl);
  const renameFile = useMutation(api.storage.renameFile);
  const moveFiles = useMutation(api.storage.moveFiles);
  const deleteFiles = useMutation(api.storage.deleteFiles);

  const files: FileRow[] | undefined =
    rawFiles === undefined ? undefined : Array.isArray(rawFiles) ? (rawFiles as FileRow[]) : [];
  const folders: string[] = Array.isArray(rawFolders) ? (rawFolders as string[]) : [];

  const listedBytes = useMemo(
    () => (files ?? []).reduce((sum, file) => sum + (Number(file.sizeBytes) || 0), 0),
    [files],
  );
  /** Only `undefined` means "still loading"; anything else is a settled answer. */
  const usageLoading = rawUsage === undefined;
  const usage = isObject(rawUsage)
    ? {
        usedBytes: Number(rawUsage.usedBytes) || 0,
        quotaBytes: Number(rawUsage.quotaBytes) || FALLBACK_QUOTA_BYTES,
        fileCount: Number(rawUsage.fileCount) || 0,
      }
    : undefined;
  const usedBytes = usage?.usedBytes ?? listedBytes;
  const quotaBytes = usage?.quotaBytes ?? FALLBACK_QUOTA_BYTES;
  const usedPercent = Math.min(100, Math.round((usedBytes / quotaBytes) * 100));
  const quotaExceeded = usedBytes >= quotaBytes;
  const loading = files === undefined;

  const segments = folder ? folder.split("/") : [];

  /* Selection is pruned whenever the visible folder changes. */
  useEffect(() => {
    setSelected((prev) => {
      const visible = new Set((files ?? []).map((file) => file.fileId));
      const next = new Set([...prev].filter((id) => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [files]);

  const goFolder = (next: string) => {
    const params = new URLSearchParams(searchParams);
    if (next) params.set("folder", next);
    else params.delete("folder");
    setSearchParams(params);
    setSelected(new Set());
  };

  const openPicker = () => {
    if (quotaExceeded) {
      toast.error("Storage is full. Delete files or upgrade your plan.");
      return;
    }
    inputRef.current?.click();
  };

  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    setOpError(null);

    const accepted: { file: File; kind: ReturnType<typeof kindOf> }[] = [];
    for (const file of Array.from(list)) {
      const kind = kindOf(file.type);
      const allowed =
        kind === "image"
          ? ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)
          : kind === "pdf_document"
            ? file.type === "application/pdf"
            : GENERIC_TYPES.includes(file.type);
      if (!allowed) {
        toast.error(`${file.name}: this file type is not supported.`);
        continue;
      }
      const limitMb = kind === "image" ? 8 : 25;
      if (file.size > limitMb * 1024 * 1024) {
        toast.error(`${file.name}: exceeds the ${limitMb} MB limit.`);
        continue;
      }
      accepted.push({ file, kind });
    }
    if (accepted.length === 0) return;

    const incomingBytes = accepted.reduce((sum, item) => sum + item.file.size, 0);
    if (usedBytes + incomingBytes > quotaBytes) {
      const message = "This upload would exceed your storage quota. Delete files or upgrade your plan.";
      setOpError(message);
      toast.error("Storage quota exceeded");
      return;
    }

    setUploading({ done: 0, total: accepted.length });
    let uploaded = 0;
    try {
      for (const [index, item] of accepted.entries()) {
        const uploadUrl = (await generateUploadUrl({})) as unknown;
        if (typeof uploadUrl !== "string" || !/^https?:/.test(uploadUrl)) {
          throw new Error("File uploads are not available in this environment yet.");
        }
        const response = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": item.file.type },
          body: item.file,
        });
        if (!response.ok) throw new Error(`Upload failed for ${item.file.name}.`);
        const body = (await response.json()) as { storageId?: string };
        if (!body.storageId) throw new Error("Storage did not return a file id.");
        await registerFile({
          storageId: body.storageId as Id<"_storage">,
          kind: item.kind,
          originalName: item.file.name,
          folder,
        });
        uploaded += 1;
        setUploading({ done: index + 1, total: accepted.length });
      }
      if (uploaded > 0) toast.success(`Uploaded ${uploaded} file${uploaded === 1 ? "" : "s"}.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "The upload failed.";
      setOpError(uploaded > 0 ? `${message} ${uploaded} file(s) finished before the error.` : message);
      toast.error("Upload failed");
    } finally {
      setUploading(null);
    }
  };

  const handleCopy = async (file: FileRow) => {
    try {
      const url = (await getFileUrl({ fileId: file.fileId as Id<"storageFiles"> })) as unknown;
      if (typeof url !== "string" || !url) throw new Error("No URL returned.");
      await navigator.clipboard.writeText(url);
      toast.success("URL copied to clipboard.");
    } catch {
      toast.error("Couldn't create a link for this file.");
    }
  };

  const handleRename = async () => {
    if (!renameTarget || !renameValue.trim()) return;
    setBusy(true);
    try {
      await renameFile({ fileId: renameTarget.fileId as Id<"storageFiles">, name: renameValue.trim() });
      toast.success("File renamed.");
      setRenameTarget(null);
    } catch (err) {
      setOpError(err instanceof Error ? err.message : "Rename failed.");
      toast.error("Rename failed");
    } finally {
      setBusy(false);
    }
  };

  const handleMove = async () => {
    if (!moveTargets?.length) return;
    setBusy(true);
    try {
      await moveFiles({
        fileIds: moveTargets.map((file) => file.fileId as Id<"storageFiles">),
        folder: normalizeFolder(moveValue),
      });
      toast.success(`Moved ${moveTargets.length} file${moveTargets.length === 1 ? "" : "s"}.`);
      setMoveTargets(null);
      setSelected(new Set());
    } catch (err) {
      setOpError(err instanceof Error ? err.message : "Move failed.");
      toast.error("Move failed");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTargets?.length) return;
    setBusy(true);
    try {
      await deleteFiles({ fileIds: deleteTargets.map((file) => file.fileId as Id<"storageFiles">) });
      toast.success(`Deleted ${deleteTargets.length} file${deleteTargets.length === 1 ? "" : "s"}.`);
      setDeleteTargets(null);
      setSelected(new Set());
    } catch (err) {
      setOpError(err instanceof Error ? err.message : "Delete failed.");
      toast.error("Delete failed");
    } finally {
      setBusy(false);
    }
  };

  const openMove = (targets: FileRow[]) => {
    setMoveTargets(targets);
    setMoveValue(folder);
  };

  const selectedFiles = (files ?? []).filter((file) => selected.has(file.fileId));
  const deleteBytes = deleteTargets?.reduce((sum, file) => sum + file.sizeBytes, 0) ?? 0;

  const dropHandlers = {
    onDragOver: (event: ReactDragEvent<HTMLButtonElement>) => {
      event.preventDefault();
      if (!quotaExceeded) setDragOver(true);
    },
    onDragLeave: (event: ReactDragEvent<HTMLButtonElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOver(false);
    },
    onDrop: (event: ReactDragEvent<HTMLButtonElement>) => {
      event.preventDefault();
      setDragOver(false);
      if (!quotaExceeded) void handleFiles(event.dataTransfer.files);
    },
  };

  const dropzone = (variant: ViewMode) => {
    const disabled = quotaExceeded || Boolean(uploading);
    return (
      <button
        type="button"
        {...dropHandlers}
        onClick={openPicker}
        disabled={disabled}
        aria-label="Upload files by dropping them here"
        className={cn(
          "group flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed text-center transition-[border-color,background-color] duration-200 outline-none focus-visible:ring-2 focus-visible:ring-ring",
          variant === "grid" ? "min-h-[172px] p-4" : "p-4 sm:flex-row sm:gap-3",
          disabled
            ? "cursor-not-allowed border-border bg-surface-2/30 opacity-60"
            : dragOver
              ? "border-primary bg-primary/8"
              : "border-border bg-surface-2/40 hover:border-primary/50 hover:bg-surface-2/70",
        )}
      >
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors",
            dragOver ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground",
          )}
        >
          {uploading ? <Loader2 className="size-4 animate-spin" /> : <CloudUpload className="size-4" />}
        </span>
        <span className={cn("min-w-0", variant === "list" && "sm:text-left")}>
          <span className="block text-xs font-semibold text-foreground">
            {uploading ? `Uploading ${uploading.done} of ${uploading.total}…` : dragOver ? "Drop to upload" : "Drop files here"}
          </span>
          <span className="mt-0.5 block text-[11px] text-muted-foreground">
            {quotaExceeded ? "Storage is full" : folder ? `Uploads land in ${folder}` : "or click to browse · 8 MB images"}
          </span>
        </span>
      </button>
    );
  };

  return (
    <div className="space-y-5">
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        accept={["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf", ...GENERIC_TYPES].join(",")}
        onChange={(event) => {
          void handleFiles(event.target.files);
          event.target.value = "";
        }}
      />

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Button variant="outline" size="icon" asChild aria-label="Back to services">
            <Link to="/services">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div className="min-w-0">
            <p className="section-label text-primary">Library</p>
            <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-foreground">Assets</h1>
          </div>
        </div>
        <Button className="w-full gap-1.5 sm:w-auto" onClick={openPicker} disabled={quotaExceeded || Boolean(uploading)}>
          <Upload className="size-4" />
          Upload
        </Button>
      </div>

      {/* Storage quota */}
      <div className="rounded-2xl border border-border bg-card px-4 py-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <HardDrive className="size-4 text-muted-foreground" />
            <p className="text-xs font-semibold text-foreground">
              {usageLoading ? "Checking storage…" : `${formatBytes(usedBytes)} of ${formatBytes(quotaBytes)} used`}
            </p>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {usageLoading ? "" : `${usedPercent}% · ${usage?.fileCount || (files?.length ?? 0)} files`}
          </p>
        </div>
        {usageLoading ? (
          <Skeleton className="mt-2.5 h-1.5 w-full rounded-full" />
        ) : (
          <Progress value={usedPercent} className="mt-2.5 h-1.5" aria-label="Storage used" />
        )}
        {quotaExceeded && (
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-warning/30 bg-warning/12 px-2.5 py-1.5 text-[11px] leading-4 text-warning">
            <span className="font-medium">Storage is full — uploads are paused.</span>
            <Link to="/billing" className="font-semibold underline underline-offset-2 hover:no-underline">
              Upgrade storage
            </Link>
            <span className="text-warning/80">or delete files to free space.</span>
          </div>
        )}
      </div>

      {/* Action-level errors */}
      <AnimatePresence>
        {opError && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-error/30 bg-error/10 px-3 py-2.5 text-xs text-error"
          >
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <p className="min-w-0 flex-1 break-words">{opError}</p>
            <button
              type="button"
              onClick={() => setOpError(null)}
              className="shrink-0 font-semibold underline-offset-2 hover:underline"
            >
              Dismiss
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toolbar: breadcrumb + view toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Folder path" className="flex min-w-0 flex-wrap items-center gap-1 text-xs">
          <button
            type="button"
            onClick={() => goFolder("")}
            className={cn(
              "inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2 font-medium transition-colors",
              segments.length === 0 ? "bg-surface-2 text-foreground" : "text-muted-foreground hover:bg-accent",
            )}
          >
            <House className="size-3.5" />
            All assets
          </button>
          {segments.map((segment, index) => {
            const path = segments.slice(0, index + 1).join("/");
            const isLast = index === segments.length - 1;
            return (
              <Fragment key={path}>
                <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                <button
                  type="button"
                  onClick={() => goFolder(path)}
                  aria-current={isLast ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-8 max-w-[160px] items-center truncate rounded-lg px-2 font-medium transition-colors",
                    isLast ? "bg-surface-2 text-foreground" : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  {segment}
                </button>
              </Fragment>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          {uploading && (
            <span className="flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-foreground">
              <Loader2 className="size-3 animate-spin" />
              {uploading.done}/{uploading.total}
            </span>
          )}
          <div role="tablist" aria-label="Layout" className="inline-flex items-center gap-1 rounded-xl border border-border bg-surface-2 p-1">
            {(
              [
                { value: "grid", label: "Grid", icon: LayoutGrid },
                { value: "list", label: "List", icon: ListIcon },
              ] as { value: ViewMode; label: string; icon: typeof LayoutGrid }[]
            ).map((option) => {
              const active = view === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-label={`${option.label} view`}
                  onClick={() => setView(option.value)}
                  className={cn(
                    "relative flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="assets-view-toggle"
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
        </div>
      </div>

      {/* Sub-folders */}
      {folders.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {folders.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => goFolder(folder ? `${folder}/${name}` : name)}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-accent"
            >
              <Folder className="size-3.5 text-muted-foreground" />
              <span className="max-w-[180px] truncate">{name}</span>
              <ChevronRight className="size-3 text-muted-foreground" />
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      {loading ? (
        view === "grid" ? (
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="overflow-hidden rounded-xl border border-border bg-card">
                <Skeleton className="aspect-[4/3] w-full rounded-none" />
                <div className="space-y-2 p-3">
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="flex items-center gap-3 p-3">
                <Skeleton className="size-9 rounded-md" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-1/3" />
                  <Skeleton className="h-3 w-1/5" />
                </div>
                <Skeleton className="h-3 w-14" />
              </div>
            ))}
          </div>
        )
      ) : view === "grid" ? (
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          {dropzone("grid")}
          {(files ?? []).map((file, index) => {
            const Icon = fileIcon(file.mimeType);
            const isSelected = selected.has(file.fileId);
            return (
              <motion.div
                key={file.fileId}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22, delay: Math.min(index * 0.02, 0.2), ease: [0.22, 1, 0.36, 1] }}
                className={cn(
                  "group relative overflow-hidden rounded-xl border bg-card transition-[box-shadow,border-color] duration-200",
                  isSelected ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary/40 hover:shadow-md",
                )}
              >
                <div className="relative aspect-[4/3] bg-surface-2">
                  {file.url ? (
                    <img
                      src={file.url}
                      alt={file.name}
                      loading="lazy"
                      className="h-full w-full object-cover"
                      onError={(event) => {
                        event.currentTarget.style.display = "none";
                      }}
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                      <Icon className="size-7" strokeWidth={1.5} />
                    </div>
                  )}
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => toggleSelected(file.fileId)}
                    onClick={(event) => event.stopPropagation()}
                    aria-label={`Select ${file.name}`}
                    className={cn(
                      "absolute top-2 left-2 bg-background/90 shadow-sm transition-opacity duration-150",
                      // Always visible on touch, hover-revealed on pointer devices.
                      isSelected ? "opacity-100" : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100",
                    )}
                  />
                  <AssetMenu
                    file={file}
                    onCopy={handleCopy}
                    onRename={(target) => {
                      setRenameTarget(target);
                      setRenameValue(target.name);
                    }}
                    onMove={(target) => openMove([target])}
                    onDelete={(target) => setDeleteTargets([target])}
                    className="absolute top-1.5 right-1.5"
                  />
                </div>
                <div className="px-2.5 py-2">
                  <p className="truncate text-[13px] font-medium text-foreground" title={file.name}>
                    {file.name}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {formatBytes(file.sizeBytes)} · {shortDate(file.createdAt)}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="border-b border-border p-2">{dropzone("list")}</div>
          {(files ?? []).map((file) => {
            const Icon = fileIcon(file.mimeType);
            const isSelected = selected.has(file.fileId);
            return (
              <div
                key={file.fileId}
                className={cn(
                  "group flex items-center gap-3 border-b border-border px-3 py-2.5 transition-colors last:border-b-0",
                  isSelected ? "bg-primary/5" : "hover:bg-surface-2/60",
                )}
              >
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => toggleSelected(file.fileId)}
                  aria-label={`Select ${file.name}`}
                  className={cn(
                    "transition-opacity duration-150",
                    isSelected ? "opacity-100" : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100",
                  )}
                />
                <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-2 text-muted-foreground">
                  {file.url ? (
                    <img src={file.url} alt={file.name} loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <Icon className="size-4" strokeWidth={1.6} />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground" title={file.name}>
                    {file.name}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatBytes(file.sizeBytes)}
                    {file.folder ? ` · ${file.folder}` : ""}
                  </p>
                </div>
                <span className="hidden shrink-0 text-[11px] text-muted-foreground md:block">
                  {shortDate(file.createdAt)}
                </span>
                <AssetMenu
                  file={file}
                  onCopy={handleCopy}
                  onRename={(target) => {
                    setRenameTarget(target);
                    setRenameValue(target.name);
                  }}
                  onMove={(target) => openMove([target])}
                  onDelete={(target) => setDeleteTargets([target])}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Empty */}
      {!loading && (files ?? []).length === 0 && (
        <Empty className="border border-dashed border-border">
          <EmptyMedia variant="icon">
            <FolderOpen />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>{folder ? "This folder is empty" : "No assets yet"}</EmptyTitle>
            <EmptyDescription>
              {folder
                ? `Nothing has been moved into ${folder} yet. Upload here or move existing files in.`
                : "Upload images, PDFs, spreadsheets or text files and they will be available across every service."}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button className="gap-1.5" onClick={openPicker} disabled={quotaExceeded || Boolean(uploading)}>
              <Upload className="size-4" />
              Upload files
            </Button>
          </EmptyContent>
        </Empty>
      )}

      {/* Bulk actions */}
      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="fixed inset-x-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 mx-auto flex w-[calc(100%-2rem)] max-w-xl items-center gap-1.5 rounded-2xl border border-border bg-card/95 p-2 pl-4 shadow-lg backdrop-blur-xl lg:bottom-6"
            role="region"
            aria-label="Bulk actions"
          >
            <span className="mr-auto text-xs font-semibold text-foreground">
              {selected.size} selected
            </span>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => openMove(selectedFiles)}>
              <FolderInput className="size-3.5" />
              Move
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="gap-1.5"
              onClick={() => setDeleteTargets(selectedFiles)}
            >
              <Trash2 className="size-3.5" />
              Delete
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Clear selection"
              onClick={() => setSelected(new Set())}
            >
              <X className="size-4" />
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Rename */}
      <Dialog open={renameTarget !== null} onOpenChange={(open) => !open && !busy && setRenameTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename file</DialogTitle>
            <DialogDescription>Keep the extension so previews and downloads still work.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="asset-rename">File name</Label>
            <Input
              id="asset-rename"
              value={renameValue}
              maxLength={120}
              onChange={(event) => setRenameValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void handleRename();
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={handleRename} disabled={busy || renameValue.trim().length === 0}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              Save name
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move */}
      <Dialog open={moveTargets !== null} onOpenChange={(open) => !open && !busy && setMoveTargets(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Move {moveTargets?.length === 1 ? moveTargets[0]?.name : `${moveTargets?.length ?? 0} files`}
            </DialogTitle>
            <DialogDescription>Leave the destination blank to move items back to All assets.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="asset-move">Destination folder</Label>
            <Input
              id="asset-move"
              value={moveValue}
              maxLength={180}
              placeholder="e.g. brand/logos"
              onChange={(event) => setMoveValue(event.target.value)}
            />
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {["", folder, ...folders.map((name) => (folder ? `${folder}/${name}` : name)), "renders"]
                .filter((value, index, list) => list.indexOf(value) === index)
                .map((value) => (
                  <button
                    key={value || "root"}
                    type="button"
                    onClick={() => setMoveValue(value)}
                    className={cn(
                      "inline-flex min-h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-medium transition-colors",
                      normalizeFolder(moveValue) === value
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    <Folder className="size-3" />
                    {value || "All assets"}
                  </button>
                ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveTargets(null)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={handleMove} disabled={busy || !moveTargets?.length}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              Move here
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <Dialog open={deleteTargets !== null} onOpenChange={(open) => !open && !busy && setDeleteTargets(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Delete {deleteTargets?.length === 1 ? deleteTargets[0]?.name : `${deleteTargets?.length ?? 0} files`}?
            </DialogTitle>
            <DialogDescription>
              This frees {formatBytes(deleteBytes)} and cannot be undone. Anything already embedded elsewhere will
              lose its file.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTargets(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={busy || !deleteTargets?.length}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
