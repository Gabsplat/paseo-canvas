import { z } from "zod";
import { blockTypeSchema, documentContentSchema, extensionSchema, idSchema, type DocumentContent } from "./model";
import { commentThreadSchema, COMMENT_LIMITS } from "./comments";
import { runtimeJsonSchema, runtimeStateSchema } from "./learning";
import { MEDIA_LIMITS, MEDIA_TYPES, parseMediaRef, type MediaExtension } from "./media";

/**
 * A `.lienzo` file: one Lienzo to share (docs/mcp.md, "Lienzo files"). UTF-8 JSON holding the document as it is now
 * (no history, revision, connection or selection), the images it shows (by their SHA-256, base64), the custom block
 * types it uses and the extensions that keep state on it. Comments and what people did with interactive blocks travel
 * only when the person ticks them. Importing always makes a new Lienzo; it never overwrites one.
 * Every level is strict: a field this version does not know is refused, not ignored.
 */
export const LIENZO_FILE = { format: "lienzo", version: 1, extension: ".lienzo", mime: "application/vnd.lienzo+json", maxBytes: 50 * 1024 * 1024 } as const;
export const LIENZO_ACCEPT = ".lienzo,application/vnd.lienzo+json";
const MEDIA_KEY = /^[a-f0-9]{64}\.(png|jpg|webp|gif|svg)$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export const lienzoMediaSchema = z.object({
  type: z.enum(Object.values(MEDIA_TYPES) as [string, ...string[]]),
  data: z.string().max(Math.ceil(MEDIA_LIMITS.bytes * 4 / 3) + 4, `Images can be up to ${MEDIA_LIMITS.bytes / 1024 / 1024} MB.`).regex(BASE64, "Image data is not base64."),
}).strict();
/** Where an extension came from on the computer that exported it: an extension file (pack) or made there (absent). */
export const lienzoExtensionSchema = extensionSchema.extend({
  pack: z.object({ id: idSchema, name: z.string().min(1).max(200), description: z.string().max(2000).default("") }).strict().optional(),
}).strict();
export const lienzoRuntimeSchema = runtimeStateSchema.extend({
  // lienzo.storage of the extensions that keep state on this Lienzo, by extension id.
  extensionStorage: z.record(idSchema, runtimeJsonSchema).optional(),
}).strict();
export const lienzoFileSchema = z.object({
  format: z.literal(LIENZO_FILE.format), version: z.literal(LIENZO_FILE.version), exportedAt: z.iso.datetime(),
  app: z.object({ name: z.string().min(1).max(80), version: z.string().min(1).max(80) }).strict(),
  document: documentContentSchema,
  comments: z.array(commentThreadSchema).max(COMMENT_LIMITS.threads).optional(),
  runtime: lienzoRuntimeSchema.optional(),
  media: z.record(z.string().regex(MEDIA_KEY, "Image names are their SHA-256 and extension."), lienzoMediaSchema).default({}),
  catalog: z.object({ blockTypes: z.array(blockTypeSchema).max(100).default([]), extensions: z.array(lienzoExtensionSchema).max(64).default([]) }).strict().default({ blockTypes: [], extensions: [] }),
}).strict();
export type LienzoFile = z.infer<typeof lienzoFileSchema>;
export type LienzoExtension = z.infer<typeof lienzoExtensionSchema>;

/** What the review shows before anything is saved, and what an import reports. */
export const lienzoItemStatusSchema = z.enum(["new", "installed", "conflict"]);
export const lienzoReviewSchema = z.object({
  title: z.string(), importTitle: z.string(), description: z.string(), exportedAt: z.string(),
  app: z.object({ name: z.string(), version: z.string() }),
  blocks: z.number().int(), frames: z.number().int(), sheets: z.number().int(), links: z.number().int(),
  images: z.object({ count: z.number().int(), bytes: z.number().int(), missing: z.number().int() }),
  // null: the file was exported without them.
  comments: z.number().int().nullable(), runtime: z.boolean(),
  blockTypes: z.array(z.object({ id: z.string(), name: z.string(), status: lienzoItemStatusSchema })),
  extensions: z.array(z.object({ id: z.string(), name: z.string(), description: z.string(), icon: z.string().optional(), permissions: z.array(z.string()), status: lienzoItemStatusSchema })),
  warnings: z.array(z.string()),
  // The incoming content, for the review's thumbnail (dry run only).
  preview: documentContentSchema.optional(),
  bytes: z.number().int(),
});
export type LienzoReview = z.infer<typeof lienzoReviewSchema>;

/** Every `lienzo-media:` reference in a value: an image block's address, wherever a string holds exactly one. */
export function mediaRefsIn(value: unknown, found = new Set<string>()): Set<string> {
  if (typeof value === "string") { if (parseMediaRef(value)) found.add(value); }
  else if (Array.isArray(value)) for (const item of value) mediaRefsIn(item, found);
  else if (value && typeof value === "object") for (const item of Object.values(value)) mediaRefsIn(item, found);
  return found;
}
/** The same value with references swapped (an SVG cleaned again on import may get a new name). */
export function replaceMediaRefs<T>(value: T, map: ReadonlyMap<string, string>): T {
  if (typeof value === "string") return (map.get(value) ?? value) as T;
  if (Array.isArray(value)) return value.map(item => replaceMediaRefs(item, map)) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceMediaRefs(item, map)])) as T;
  return value;
}
export const mediaKeyOf = (ref: string) => { const parsed = parseMediaRef(ref); return parsed ? `${parsed.hash}.${parsed.extension}` : null; };
export const mediaExtensionOf = (key: string) => key.slice(key.lastIndexOf(".") + 1) as MediaExtension;

/** A file name for a title: what a file system accepts everywhere, the title's own words otherwise. */
export function lienzoFileName(title: string): string {
  const clean = title.normalize("NFC").replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").replace(/^[\s.]+|[\s.]+$/g, "").slice(0, 120).trim();
  return `${clean || "Lienzo"}${LIENZO_FILE.extension}`;
}
/** " (imported)", then " (imported 2)"… until no Lienzo of the workspace has that title. */
export function importedTitle(title: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(title)) return title;
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? " (imported)" : ` (imported ${n})`, next = title.slice(0, 300 - suffix.length) + suffix;
    if (!used.has(next)) return next;
  }
}
/** Counts for the export dialog, from the open document. */
export function lienzoCounts(document: Pick<DocumentContent, "blocks" | "groups" | "links">) {
  return { blocks: document.blocks.length, frames: document.groups.filter(g => !g.sheet).length, sheets: document.groups.filter(g => g.sheet).length, links: document.links.length, images: mediaRefsIn(document.blocks).size };
}
/** The file's JSON, checked before anything else so a wrong file says what it is plainly. */
export function readLienzoText(text: string): unknown {
  let value: unknown;
  try { value = JSON.parse(text.replace(/^﻿/, "")); } catch { throw Object.assign(new Error("This file is not a Lienzo file: it is not valid JSON."), { code: "VALIDATION" }); }
  if (!value || typeof value !== "object" || Array.isArray(value) || (value as { format?: unknown }).format !== LIENZO_FILE.format) throw Object.assign(new Error("This file is not a Lienzo file."), { code: "VALIDATION" });
  const version = (value as { version?: unknown }).version;
  if (typeof version === "number" && version > LIENZO_FILE.version) throw Object.assign(new Error(`This file was made by a newer Lienzo (file version ${version}). Update Lienzo to open it.`), { code: "VALIDATION" });
  if (version !== LIENZO_FILE.version) throw Object.assign(new Error("This Lienzo file has no version this Lienzo can read."), { code: "VALIDATION" });
  return value;
}
export const formatBytes = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
