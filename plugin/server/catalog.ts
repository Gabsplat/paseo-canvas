import { z } from "zod";
import { packSchema, blockTypeSchema, templateSchema, extensionSchema, idSchema, type CanvasExtension, type CatalogExtension, type CanvasPack, type CanvasCatalog, type BlockType, type GroupTemplate } from "../shared/model";
import { builtinPacks, builtinTemplates, builtinTypes } from "../shared/builtins";
import { isRetiredRenderer } from "../shared/renderers";
import { CanvasError } from "../shared/errors";
import { safeJson, validateTree, validateLinks, validateBlockData, validateDocument, normalizeBlock, validateBlockPresentation } from "./reducer";

export const catalogStorageSchema = z.object({
  revision: z.number().int().nonnegative(),
  localTypes: z.array(blockTypeSchema), localTemplates: z.array(templateSchema), packs: z.array(packSchema),
  // Absent in state written before extensions existed.
  localExtensions: z.array(extensionSchema).default([]), grants: z.array(idSchema).default([]),
}).strict();
export type CatalogStorage = z.infer<typeof catalogStorageSchema>;
export function catalogView(storage: CatalogStorage): CanvasCatalog {
  const types = new Map(builtinTypes.map(type => [type.id, structuredClone(type)]));
  const templates = new Map(builtinTemplates.map(template => [template.id, structuredClone(template)]));
  for (const pack of storage.packs) {
    for (const type of pack.blockTypes) types.set(type.id, structuredClone(type));
    for (const template of pack.templates) templates.set(template.id, structuredClone(template));
  }
  for (const type of storage.localTypes) types.set(type.id, structuredClone(type));
  for (const template of storage.localTemplates) templates.set(template.id, structuredClone(template));
  // A stored type whose renderer was retired stays in storage and in its pack, but is not a usable type:
  // it cannot be inserted, and blocks that carry its ID are kept as blocks of an unknown type.
  for (const [id, type] of types) if (isRetiredRenderer(type.renderer)) types.delete(id);
  const extensions = new Map<string, CatalogExtension>(), grants = new Set(storage.grants);
  for (const pack of builtinPacks) for (const e of pack.extensions) extensions.set(e.id, { ...structuredClone(e), source: "builtin", granted: true });
  for (const pack of storage.packs) for (const e of pack.extensions) extensions.set(e.id, { ...structuredClone(e), source: pack.id, granted: grants.has(e.id) });
  for (const e of storage.localExtensions) extensions.set(e.id, { ...structuredClone(e), source: "local", granted: true });
  return { revision: storage.revision, blockTypes: [...types.values()], templates: [...templates.values()], packs: structuredClone([...builtinPacks, ...storage.packs]), extensions: [...extensions.values()] };
}
/** A local extension may replace only a local one; shipped and pack extensions are replaced through their pack. */
export function validateExtension(extension: CanvasExtension, catalog: CanvasCatalog): void {
  safeJson(extension);
  if (new Set(extension.permissions).size !== extension.permissions.length) throw new CanvasError("VALIDATION", `Extension ${extension.id} repeats a permission.`);
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
export function validateTemplate(template: GroupTemplate, catalog: CanvasCatalog): void {
  safeJson(template);
  validateTree(template.blocks, template.groups);
  validateLinks(template.blocks, template.groups, template.links);
  for (const block of template.blocks) {
    const type = catalog.blockTypes.find(type => type.id === block.typeId);
    if (!type) throw new CanvasError("UNKNOWN_TYPE", `Template ${template.id} needs missing type ${block.typeId}.`);
    normalizeBlock(block, type);
    validateBlockPresentation(block, type);
    validateBlockData(block, type);
  }
}
export function parsePack(input: unknown, catalog: CanvasCatalog): CanvasPack {
  if (Buffer.byteLength(JSON.stringify(input) ?? "") > 1024 * 1024)
    throw new CanvasError("TOO_LARGE", "A pack cannot exceed 1 MiB.");
  const pack = packSchema.parse(input);
  safeJson(pack);
  if (pack.blockTypes.length + pack.templates.length + pack.documents.length + pack.extensions.length > 200)
    throw new CanvasError("TOO_LARGE", "A pack cannot exceed 200 entries.");
  if (builtinPacks.some(builtin => builtin.id === pack.id)) throw new CanvasError("VALIDATION", "Shipped example pack IDs are reserved.");
  const unique = (ids: string[]) => { if (new Set(ids).size !== ids.length) throw new CanvasError("VALIDATION", "Pack contains duplicate catalog IDs."); };
  unique(pack.blockTypes.map(type => type.id)); unique(pack.templates.map(template => template.id)); unique(pack.extensions.map(extension => extension.id));
  for (const entry of [...pack.blockTypes, ...pack.templates, ...pack.extensions]) {
    if (!entry.id.startsWith(`${pack.id}.`)) throw new CanvasError("VALIDATION", `Pack entries must use the ${pack.id}. namespace.`);
  }
  const existingPack = catalog.packs.find(item => item.id === pack.id);
  const ownedTypes = new Set(existingPack?.blockTypes.map(type => type.id) ?? []);
  const ownedTemplates = new Set(existingPack?.templates.map(template => template.id) ?? []);
  for (const type of pack.blockTypes) if (catalog.blockTypes.some(item => item.id === type.id) && !ownedTypes.has(type.id)) throw new CanvasError("VALIDATION", `Type ${type.id} already belongs to the local catalog or another pack.`);
  for (const template of pack.templates) if (catalog.templates.some(item => item.id === template.id) && !ownedTemplates.has(template.id)) throw new CanvasError("VALIDATION", `Template ${template.id} already belongs to the local catalog or another pack.`);
  for (const extension of pack.extensions) {
    if (new Set(extension.permissions).size !== extension.permissions.length) throw new CanvasError("VALIDATION", `Extension ${extension.id} repeats a permission.`);
    const held = catalog.extensions.find(item => item.id === extension.id);
    if (held && held.source !== pack.id) throw new CanvasError("VALIDATION", `Extension ${extension.id} already belongs to the local catalog or another pack.`);
  }
  for (const other of catalog.packs) if (other.id !== pack.id && (other.id.startsWith(`${pack.id}.`) || pack.id.startsWith(`${other.id}.`))) throw new CanvasError("VALIDATION", "Pack namespaces cannot nest or overlap.");
  pack.blockTypes.forEach(validateType);
  const types = new Map(catalog.blockTypes.map(type => [type.id, type]));
  for (const type of pack.blockTypes) types.set(type.id, type);
  const prospective = { ...catalog, blockTypes: [...types.values()] };
  for (const template of pack.templates) validateTemplate(template, prospective);
  for (const content of pack.documents) {
    for (const block of content.blocks) if (!prospective.blockTypes.some(type => type.id === block.typeId)) throw new CanvasError("UNKNOWN_TYPE", `Pack document needs missing type ${block.typeId}.`);
    for (const block of content.blocks) normalizeBlock(block, prospective.blockTypes.find(type => type.id === block.typeId)!);
    validateDocument({ ...content, id: "validation", workspaceId: "validation", revision: 0, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }, prospective);
  }
  return pack;
}
export function packIssues(input: unknown, catalog: CanvasCatalog): { valid: boolean; issues: string[] } {
  try { parsePack(input, catalog); return { valid: true, issues: [] }; }
  catch (error) {
    return { valid: false, issues: error instanceof z.ZodError ? error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`) : [error instanceof Error ? error.message : "Invalid pack"] };
  }
}
export function packDiff(old: CanvasPack | undefined, next: CanvasPack) {
  const before = new Map((old ? [...old.blockTypes, ...old.templates, ...old.extensions] : []).map(entry => [entry.id, entry]));
  const diff = { added: [] as string[], replaced: [] as string[], unchanged: [] as string[] };
  for (const entry of [...next.blockTypes, ...next.templates, ...next.extensions]) {
    const previous = before.get(entry.id);
    (previous === undefined ? diff.added : JSON.stringify(previous) === JSON.stringify(entry) ? diff.unchanged : diff.replaced).push(entry.id);
  }
  return diff;
}
