import { createHash } from "node:crypto";
import { z } from "zod";
import { actionScripts } from "../shared/actions";
import { packSchema, blockTypeSchema, templateSchema, extensionListSchema, idSchema, type CanvasExtension, type CatalogExtension, type CanvasPack, type CanvasCatalog, type BlockType } from "../shared/model";
import { builtinTypes } from "../shared/builtins";
import { isRetiredRenderer } from "../shared/renderers";
import { CanvasError } from "../shared/errors";
import { safeJson, validateBlockData, normalizeBlock } from "./reducer";

export const catalogStorageSchema = z.object({
  revision: z.number().int().nonnegative(),
  localTypes: z.array(blockTypeSchema), localTemplates: z.array(templateSchema), packs: z.array(packSchema),
  // Absent in state written before extensions existed.
  localExtensions: extensionListSchema(1000).default([]), grants: z.array(idSchema).default([]),
  // Absent in state written before Discover compared code: those files get theirs computed when listed.
  packHashes: z.record(idSchema, z.string()).default({}),
}).strict();
export type CatalogStorage = z.infer<typeof catalogStorageSchema>;
/**
 * What the panel and the agent see. Stored packs are the extension files the person imported; packs written before
 * the UI pass may still carry block types (kept, so their blocks render), templates and documents (kept in storage,
 * never listed: templates and examples left the app).
 */
export function catalogView(storage: CatalogStorage): CanvasCatalog {
  const types = new Map(builtinTypes.map(type => [type.id, structuredClone(type)]));
  for (const pack of storage.packs) for (const type of pack.blockTypes) types.set(type.id, structuredClone(type));
  for (const type of storage.localTypes) types.set(type.id, structuredClone(type));
  // A stored type whose renderer was retired stays in storage and in its pack, but is not a usable type:
  // it cannot be inserted, and blocks that carry its ID are kept as blocks of an unknown type.
  for (const [id, type] of types) if (isRetiredRenderer(type.renderer)) types.delete(id);
  const extensions = new Map<string, CatalogExtension>(), grants = new Set(storage.grants);
  for (const pack of storage.packs) for (const e of pack.extensions) extensions.set(e.id, { ...structuredClone(e), source: pack.id, granted: grants.has(e.id) });
  for (const e of storage.localExtensions) extensions.set(e.id, { ...structuredClone(e), source: "local", granted: true });
  const packHashes = Object.fromEntries(storage.packs.map(pack => [pack.id, Object.hasOwn(storage.packHashes, pack.id) ? storage.packHashes[pack.id] : extensionsHash(pack.extensions)]));
  return { revision: storage.revision, blockTypes: [...types.values()], packs: structuredClone(storage.packs), extensions: [...extensions.values()], packHashes };
}
/** JSON with every object's keys in order, so the same content always gives the same text. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
/**
 * The content hash of a file's extensions: SHA-256 of their canonical JSON, after validation filled the defaults.
 * marketplace/scripts/build-index.mjs computes the same for each catalog entry (contentHash), so Discover sees any
 * change, code included, whatever the file's formatting.
 */
export function extensionsHash(extensions: readonly CanvasExtension[]): string {
  return createHash("sha256").update(canonicalJson(extensions)).digest("hex");
}
/** Declared actions need the script that registers them. */
function checkActions(extension: CanvasExtension): void {
  if (extension.actions?.length && !actionScripts(extension.html).length)
    throw new CanvasError("VALIDATION", `Extension ${extension.id} declares actions, but its page has no <script data-lienzo="actions"> that registers them with lienzo.action.`);
}
/** A local extension may replace only a local one; shipped and pack extensions are replaced through their pack. */
export function validateExtension(extension: CanvasExtension, catalog: CanvasCatalog): void {
  safeJson(extension);
  if (new Set(extension.permissions).size !== extension.permissions.length) throw new CanvasError("VALIDATION", `Extension ${extension.id} repeats a permission.`);
  checkActions(extension);
  const existing = catalog.extensions.find(item => item.id === extension.id);
  if (existing && existing.source !== "local") throw new CanvasError("VALIDATION", "Local extensions cannot replace a shipped or pack extension.");
  if (catalog.packs.some(pack => extension.id.startsWith(`${pack.id}.`))) throw new CanvasError("VALIDATION", `Extension ID ${extension.id} is inside a pack namespace.`);
}
export function validateType(type: BlockType): void {
  safeJson(type);
  if (new Set(type.properties.map(property => property.key)).size !== type.properties.length)
    throw new CanvasError("VALIDATION", `Type ${type.id} has duplicate property keys.`);
  // Defaults may omit required fields supplied during block creation.
  const defaults = { id: "validation", title: "", typeId: type.id, data: type.defaults };
  normalizeBlock(defaults, type);
  validateBlockData(defaults, { ...type, properties: type.properties.map(property => ({ ...property, required: false })) });
  type.defaults = defaults.data;
}
/**
 * An extension file: the pack format, carrying only extensions. Files that bring block types, templates or documents
 * are refused; those left the app (stored packs that carry them still load).
 */
export function parsePack(input: unknown, catalog: CanvasCatalog): CanvasPack {
  if (Buffer.byteLength(JSON.stringify(input) ?? "") > 1024 * 1024)
    throw new CanvasError("TOO_LARGE", "An extension file cannot exceed 1 MiB.");
  const pack = packSchema.parse(input);
  safeJson(pack);
  if (pack.blockTypes.length || pack.templates.length || pack.documents.length)
    throw new CanvasError("VALIDATION", "An extension file carries extensions only. Block types, templates and documents are no longer imported.");
  if (!pack.extensions.length) throw new CanvasError("VALIDATION", "This file has no extensions.");
  if (pack.extensions.length > 50) throw new CanvasError("TOO_LARGE", "An extension file cannot exceed 50 extensions.");
  if (new Set(pack.extensions.map(extension => extension.id)).size !== pack.extensions.length) throw new CanvasError("VALIDATION", "The file repeats an extension ID.");
  for (const extension of pack.extensions) {
    if (!extension.id.startsWith(`${pack.id}.`)) throw new CanvasError("VALIDATION", `Extensions in a file must use the ${pack.id}. namespace.`);
    if (new Set(extension.permissions).size !== extension.permissions.length) throw new CanvasError("VALIDATION", `Extension ${extension.id} repeats a permission.`);
    checkActions(extension);
    const held = catalog.extensions.find(item => item.id === extension.id);
    if (held && held.source !== pack.id) throw new CanvasError("VALIDATION", `Extension ${extension.id} already belongs to the local catalog or another file.`);
  }
  for (const other of catalog.packs) if (other.id !== pack.id && (other.id.startsWith(`${pack.id}.`) || pack.id.startsWith(`${other.id}.`))) throw new CanvasError("VALIDATION", "Extension file namespaces cannot nest or overlap.");
  return pack;
}
export function packIssues(input: unknown, catalog: CanvasCatalog): { valid: boolean; issues: string[] } {
  try { parsePack(input, catalog); return { valid: true, issues: [] }; }
  catch (error) {
    return { valid: false, issues: error instanceof z.ZodError ? error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`) : [error instanceof Error ? error.message : "Invalid pack"] };
  }
}
export function packDiff(old: CanvasPack | undefined, next: CanvasPack) {
  const before = new Map((old?.extensions ?? []).map(entry => [entry.id, entry]));
  const diff = { added: [] as string[], replaced: [] as string[], unchanged: [] as string[] };
  for (const entry of next.extensions) {
    const previous = before.get(entry.id);
    (previous === undefined ? diff.added : JSON.stringify(previous) === JSON.stringify(entry) ? diff.unchanged : diff.replaced).push(entry.id);
  }
  return diff;
}
