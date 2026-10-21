import { getAuthUserId } from "@convex-dev/auth/server";
import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

/*
 * Cloudie storage abstraction.
 *
 * All business logic goes through THIS module — nothing else may read/write
 * file bytes directly. The runtime's blob storage is used purely as a dumb
 * byte store; ownership, privacy, validation and audit live here.
 */

type StorageFileId = Id<"storageFiles">;

// ─── Policy ───────────────────────────────────────────────────────────────────

export const SIZE_LIMITS: Record<string, number> = {
  kyc_document: 10 * 1024 * 1024, // 10 MB
  pdf_document: 25 * 1024 * 1024, // 25 MB
  image: 8 * 1024 * 1024, // 8 MB
  generic: 25 * 1024 * 1024,
};

export const MIME_ALLOWLIST: Record<string, string[]> = {
  kyc_document: ["application/pdf", "image/jpeg", "image/png"],
  pdf_document: ["application/pdf"],
  image: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  generic: [
    "application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif",
    "text/csv", "text/plain", "application/json",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
};

function randomPath(kind: string, userId: string): string {
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(12)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const day = new Date().toISOString().slice(0, 10);
  return `cloudie/${kind}/${userId}/${day}/${rand}`;
}

/** Sanitize a client-supplied filename: strip paths/control chars, cap length. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "file";
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, "").replace(/[^\w.\- ]+/g, "_").trim();
  return (clean || "file").slice(0, 120);
}

/** Free-tier storage allowance shown on the asset manager quota bar. */
export const STORAGE_QUOTA_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB

/** Max virtual-folder depth ("a/b/c"). Root is the empty string. */
const MAX_FOLDER_DEPTH = 6;

/**
 * Sanitize a client-supplied virtual folder path: each segment is cleaned like
 * a filename, `.`/`..` are dropped, depth is capped, and the result is always a
 * relative path ("" means root). Never returns a leading/trailing slash.
 */
export function sanitizeFolder(input: string | undefined): string {
  if (!input) return "";
  const segments = input
    .split(/[/\\]/)
    .map((segment) =>
      segment
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .replace(/[^\w.\- ]+/g, "_")
        .trim(),
    )
    .filter((segment) => segment.length > 0 && segment !== "." && segment !== "..")
    .slice(0, MAX_FOLDER_DEPTH)
    .map((segment) => segment.slice(0, 60));
  return segments.join("/");
}

// ─── Upload flow ──────────────────────────────────────────────────────────────

/** Step 1: client asks for a one-time upload URL (runtime infrastructure). */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Unauthorized");
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Step 2: after the client POSTs the bytes, register them in the Cloudie
 * storage catalog with ownership, MIME/size policy enforcement and audit.
 */
export const registerFile = mutation({
  args: {
    storageId: v.id("_storage"),
    kind: v.union(v.literal("kyc_document"), v.literal("pdf_document"), v.literal("image"), v.literal("generic")),
    originalName: v.string(),
    tenantId: v.optional(v.id("tenantSites")),
    folder: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Unauthorized");

    const meta = await ctx.db.system.get(args.storageId);
    if (!meta) throw new Error("Upload not found — register files only after a successful upload");

    const mime = meta.contentType ?? "application/octet-stream";
    const allowed = MIME_ALLOWLIST[args.kind] ?? [];
    if (!allowed.includes(mime)) {
      await ctx.storage.delete(args.storageId); // reject + clean up
      throw new Error(`MIME type ${mime} is not allowed for ${args.kind} uploads`);
    }
    const limit = SIZE_LIMITS[args.kind] ?? SIZE_LIMITS.generic;
    if (meta.size > limit) {
      await ctx.storage.delete(args.storageId);
      throw new Error(`File exceeds the ${Math.round(limit / 1024 / 1024)} MB limit for ${args.kind} uploads`);
    }

    // Tenant ownership: only the tenant owner may attach files to that tenant
    if (args.tenantId) {
      const tenant = await ctx.db.get(args.tenantId);
      if (!tenant || tenant.ownerId !== userId) {
        await ctx.storage.delete(args.storageId);
        throw new Error("Forbidden — you do not own this workspace");
      }
    }

    const fileId = await ctx.db.insert("storageFiles", {
      storageId: args.storageId,
      ownerId: userId,
      tenantId: args.tenantId,
      kind: args.kind,
      originalName: sanitizeFileName(args.originalName),
      mimeType: mime,
      sizeBytes: meta.size,
      path: randomPath(args.kind, userId),
      folder: sanitizeFolder(args.folder),
      sha256: meta.sha256,
      isDeleted: false,
      createdAt: Date.now(),
    });

    const user = await ctx.db.get(userId);
    await ctx.db.insert("auditLogs", {
      actorId: userId,
      actorEmail: user?.email,
      action: "storage_upload",
      resource: "storageFile",
      resourceId: fileId,
      after: { kind: args.kind, mimeType: mime, sizeBytes: meta.size },
      createdAt: Date.now(),
    });

    return fileId;
  },
});

// ─── Authorized retrieval ─────────────────────────────────────────────────────

/**
 * Checks ownership before issuing a Convex Storage URL to the file owner or an
 * admin. Treat the returned URL as a bearer link: anyone who receives it may be
 * able to open the file, so do not publish or share URLs for sensitive files.
 */
export const getFileUrl = mutation({
  args: { fileId: v.id("storageFiles") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Unauthorized");
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("Unauthorized");

    const file = await ctx.db.get(args.fileId);
    if (!file || file.isDeleted) throw new Error("Not found");

    const isOwner = file.ownerId === userId;
    const isAdmin = user.role === "admin";
    let isTenantMember = false;
    if (file.tenantId) {
      const tenant = await ctx.db.get(file.tenantId);
      isTenantMember = tenant?.ownerId === userId;
    }
    if (!isOwner && !isAdmin && !isTenantMember) {
      await ctx.db.insert("auditLogs", {
        actorId: userId,
        actorEmail: user.email,
        action: "storage_access_denied",
        resource: "storageFile",
        resourceId: args.fileId,
        createdAt: Date.now(),
      });
      throw new Error("Forbidden");
    }

    const url = await ctx.storage.getUrl(file.storageId);
    if (!url) throw new Error("File bytes missing");
    return url;
  },
});

export const listMyFiles = query({
  args: {
    limit: v.optional(v.number()),
    /** Virtual folder to list (""/omitted = root). Rows without a folder count as root. */
    folder: v.optional(v.string()),
    /** Opt-in signed URLs for image rows so grid thumbnails can render. */
    includeUrls: v.optional(v.boolean()),
  },
  returns: v.array(v.object({
    fileId: v.id("storageFiles"),
    name: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    kind: v.union(v.literal("kyc_document"), v.literal("pdf_document"), v.literal("image"), v.literal("generic")),
    createdAt: v.number(),
    folder: v.string(),
    url: v.optional(v.string()),
  })),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 50), 100));
    const folder = sanitizeFolder(args.folder);
    // Folder filtering happens in memory (legacy rows have no folder value), so
    // over-fetch a bounded window before slicing to the caller's limit.
    const rows = await ctx.db
      .query("storageFiles")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .order("desc")
      .take(500);
    const visible = rows.filter(
      (file) => !file.isDeleted && sanitizeFolder(file.folder) === folder,
    );
    const result: {
      fileId: Id<"storageFiles">;
      name: string;
      mimeType: string;
      sizeBytes: number;
      kind: "kyc_document" | "pdf_document" | "image" | "generic";
      createdAt: number;
      folder: string;
      url?: string;
    }[] = [];
    for (const file of visible.slice(0, limit)) {
      const item = {
        fileId: file._id,
        name: file.originalName,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        kind: file.kind,
        createdAt: file.createdAt,
        folder: sanitizeFolder(file.folder),
      };
      if (args.includeUrls && file.mimeType.startsWith("image/")) {
        const url = await ctx.storage.getUrl(file.storageId);
        result.push(url ? { ...item, url } : item);
      } else {
        result.push(item);
      }
    }
    return result;
  },
});

/**
 * Distinct child folders directly under `parent`, derived from the owner's
 * files. Drives folder chips and the move dialog without a folders table.
 */
export const listFolders = query({
  args: { parent: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const parent = sanitizeFolder(args.parent);
    const rows = await ctx.db
      .query("storageFiles")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .order("desc")
      .take(1000);
    const names = new Set<string>();
    for (const file of rows) {
      if (file.isDeleted) continue;
      const folder = sanitizeFolder(file.folder);
      if (!folder) continue;
      if (parent && !(folder === parent || folder.startsWith(parent + "/"))) continue;
      const rest = parent ? folder.slice(parent.length + 1) : folder;
      const first = rest.split("/")[0];
      if (first) names.add(first);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  },
});

/**
 * Storage quota usage for the header quota bar. Capped at the owner's 1000
 * most recent files — beyond that the bar reads as full-ish rather than
 * scanning an unbounded table on every reactive tick.
 */
export const getUsage = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { usedBytes: 0, quotaBytes: STORAGE_QUOTA_BYTES, fileCount: 0 };
    const rows = await ctx.db
      .query("storageFiles")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .order("desc")
      .take(1000);
    let usedBytes = 0;
    let fileCount = 0;
    for (const file of rows) {
      if (file.isDeleted) continue;
      usedBytes += file.sizeBytes;
      fileCount += 1;
    }
    return { usedBytes, quotaBytes: STORAGE_QUOTA_BYTES, fileCount };
  },
});

export const getMetadata = query({
  args: { fileId: v.id("storageFiles") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    const file = await ctx.db.get(args.fileId);
    if (!file || file.isDeleted) return null;
    if (file.ownerId !== userId && user?.role !== "admin") return null;
    return {
      fileId: file._id,
      kind: file.kind,
      name: file.originalName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      path: file.path,
      createdAt: file.createdAt,
      ownerId: file.ownerId,
      tenantId: file.tenantId ?? null,
    };
  },
});

export const exists = query({
  args: { fileId: v.id("storageFiles") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return false;
    const user = await ctx.db.get(userId);
    const file = await ctx.db.get(args.fileId);
    return !!file && !file.isDeleted && (file.ownerId === userId || user?.role === "admin");
  },
});

/** Secure deletion: owner or admin. Soft-deletes the catalog row and removes bytes. */
export const deleteFile = mutation({
  args: { fileId: v.id("storageFiles") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Unauthorized");
    const user = await ctx.db.get(userId);
    const file = await ctx.db.get(args.fileId);
    if (!file || file.isDeleted) throw new Error("Not found");
    if (file.ownerId !== userId && user?.role !== "admin") throw new Error("Forbidden");

    await ctx.db.patch(args.fileId, { isDeleted: true, deletedAt: Date.now() });
    await ctx.storage.delete(file.storageId);

    await ctx.db.insert("auditLogs", {
      actorId: userId,
      actorEmail: user?.email,
      action: "storage_delete",
      resource: "storageFile",
      resourceId: args.fileId,
      before: { name: file.originalName, sizeBytes: file.sizeBytes },
      createdAt: Date.now(),
    });
    return { success: true };
  },
});

// ─── Asset manager operations ──────────────────────────────────────────────────────

/** Rename an asset (owner or admin). Name is sanitized like an upload. */
export const renameFile = mutation({
  args: { fileId: v.id("storageFiles"), name: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Unauthorized");
    const user = await ctx.db.get(userId);
    const file = await ctx.db.get(args.fileId);
    if (!file || file.isDeleted) throw new Error("Not found");
    if (file.ownerId !== userId && user?.role !== "admin") throw new Error("Forbidden");

    const clean = sanitizeFileName(args.name);
    await ctx.db.patch(args.fileId, { originalName: clean });
    await ctx.db.insert("auditLogs", {
      actorId: userId,
      actorEmail: user?.email,
      action: "storage_rename",
      resource: "storageFile",
      resourceId: args.fileId,
      before: { name: file.originalName },
      after: { name: clean },
      createdAt: Date.now(),
    });
    return { name: clean };
  },
});

/** Move up to 100 files into a virtual folder in a single batched mutation. */
export const moveFiles = mutation({
  args: {
    fileIds: v.array(v.id("storageFiles")),
    folder: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Unauthorized");
    if (args.fileIds.length === 0) throw new Error("No files selected");
    if (args.fileIds.length > 100) throw new Error("Move up to 100 files at a time");
    const user = await ctx.db.get(userId);

    const folder = sanitizeFolder(args.folder);
    let moved = 0;
    for (const fileId of args.fileIds) {
      const file = await ctx.db.get(fileId);
      if (!file || file.isDeleted) continue;
      if (file.ownerId !== userId && user?.role !== "admin") throw new Error("Forbidden");
      await ctx.db.patch(fileId, { folder });
      moved += 1;
    }
    if (moved > 0) {
      await ctx.db.insert("auditLogs", {
        actorId: userId,
        actorEmail: user?.email,
        action: "storage_move",
        resource: "storageFile",
        resourceId: args.fileIds[0],
        after: { folder, count: moved },
        createdAt: Date.now(),
      });
    }
    return { moved };
  },
});

/** Delete up to 100 files per call: soft-delete the row, then drop the bytes. */
export const deleteFiles = mutation({
  args: { fileIds: v.array(v.id("storageFiles")) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Unauthorized");
    if (args.fileIds.length === 0) throw new Error("No files selected");
    if (args.fileIds.length > 100) throw new Error("Delete up to 100 files at a time");
    const user = await ctx.db.get(userId);

    // Validate every ID first so a forbidden row aborts the whole batch.
    const files = [];
    for (const fileId of args.fileIds) {
      const file = await ctx.db.get(fileId);
      if (!file || file.isDeleted) continue;
      if (file.ownerId !== userId && user?.role !== "admin") throw new Error("Forbidden");
      files.push(file);
    }

    let freedBytes = 0;
    for (const file of files) {
      await ctx.db.patch(file._id, { isDeleted: true, deletedAt: Date.now() });
      await ctx.storage.delete(file.storageId);
      freedBytes += file.sizeBytes;
    }
    if (files.length > 0) {
      await ctx.db.insert("auditLogs", {
        actorId: userId,
        actorEmail: user?.email,
        action: "storage_delete",
        resource: "storageFile",
        resourceId: args.fileIds[0],
        after: { count: files.length, freedBytes },
        createdAt: Date.now(),
      });
    }
    return { deleted: files.length, freedBytes };
  },
});

// ─── Internal helpers for engines (documents/image studio) ───────────────────

/** Register bytes that were stored server-side by a trusted engine. */
export const registerEngineFile = internalMutation({
  args: {
    storageId: v.id("_storage"),
    ownerId: v.id("users"),
    tenantId: v.optional(v.id("tenantSites")),
    kind: v.union(v.literal("kyc_document"), v.literal("pdf_document"), v.literal("image"), v.literal("generic")),
    originalName: v.string(),
    mimeType: v.string(),
  },
  handler: async (ctx, args) => {
    const meta = await ctx.db.system.get(args.storageId);
    if (!meta) throw new Error("Engine storage missing");
    const fileId = await ctx.db.insert("storageFiles", {
      storageId: args.storageId,
      ownerId: args.ownerId,
      tenantId: args.tenantId,
      kind: args.kind,
      originalName: sanitizeFileName(args.originalName),
      mimeType: args.mimeType,
      sizeBytes: meta.size,
      path: randomPath(args.kind, args.ownerId),
      sha256: meta.sha256,
      isDeleted: false,
      createdAt: Date.now(),
    });
    return fileId;
  },
});

/** Internal signed-URL read used by engines after their own authorization. */
export const engineFileUrl = internalMutation({
  args: { fileId: v.id("storageFiles") },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.fileId);
    if (!file || file.isDeleted) return null;
    return await ctx.storage.getUrl(file.storageId);
  },
});

export type StorageFileIdType = StorageFileId;
