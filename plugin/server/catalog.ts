import { z } from "zod";
import { packSchema, blockTypeSchema, templateSchema, type CanvasPack, type CanvasCatalog, type BlockType, type GroupTemplate } from "../shared/model";
import { builtinPacks, builtinTemplates, builtinTypes } from "../shared/builtins";
import { CanvasError } from "../shared/errors";
import { safeJson, validateTree, validateLinks, validateBlockData, validateDocument } from "./reducer";

export const catalogStorageSchema = z.object({
  revision: z.number().int().nonnegative(),
  localTypes: z.array(blockTypeSchema), localTemplates: z.array(templateSchema), packs: z.array(packSchema),
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
  return { revision: storage.revision, blockTypes: [...types.values()], templates: [...templates.values()], packs: structuredClone([...builtinPacks, ...storage.packs]) };
}
export function validateType(type: BlockType): void {
  safeJson(type);
  if (new Set(type.properties.map(property => property.key)).size !== type.properties.length)
    throw new CanvasError("VALIDATION", `Type ${type.id} has duplicate property keys.`);
  // Defaults may omit required fields supplied during block creation.
  validateBlockData({ id: "validation", title: "", typeId: type.id, data: type.defaults }, { ...type, properties: type.properties.map(property => ({ ...property, required: false })) });
}
export function validateTemplate(template: GroupTemplate, catalog: CanvasCatalog): void {
  safeJson(template);
  validateTree(template.blocks, template.groups);
  validateLinks(template.blocks, template.groups, template.links);
  for (const block of template.blocks) {
    const type = catalog.blockTypes.find(type => type.id === block.typeId);
    if (!type) throw new CanvasError("UNKNOWN_TYPE", `Template ${template.id} needs missing type ${block.typeId}.`);
    validateBlockData(block, type);
  }
}
export function parsePack(input: unknown, catalog: CanvasCatalog): CanvasPack {
  if (Buffer.byteLength(JSON.stringify(input) ?? "") > 1024 * 1024)
    throw new CanvasError("TOO_LARGE", "A pack cannot exceed 1 MiB.");
  const pack = packSchema.parse(input);
  safeJson(pack);
  if (pack.blockTypes.length + pack.templates.length + pack.documents.length > 200)
    throw new CanvasError("TOO_LARGE", "A pack cannot exceed 200 entries.");
  if (builtinPacks.some(builtin => builtin.id === pack.id)) throw new CanvasError("VALIDATION", "Shipped example pack IDs are reserved.");
  const unique = (ids: string[]) => { if (new Set(ids).size !== ids.length) throw new CanvasError("VALIDATION", "Pack contains duplicate catalog IDs."); };
  unique(pack.blockTypes.map(type => type.id)); unique(pack.templates.map(template => template.id));
  for (const entry of [...pack.blockTypes, ...pack.templates]) {
    if (!entry.id.startsWith(`${pack.id}.`)) throw new CanvasError("VALIDATION", `Pack entries must use the ${pack.id}. namespace.`);
  }
  const existingPack = catalog.packs.find(item => item.id === pack.id);
  const ownedTypes = new Set(existingPack?.blockTypes.map(type => type.id) ?? []);
  const ownedTemplates = new Set(existingPack?.templates.map(template => template.id) ?? []);
  for (const type of pack.blockTypes) if (catalog.blockTypes.some(item => item.id === type.id) && !ownedTypes.has(type.id)) throw new CanvasError("VALIDATION", `Type ${type.id} already belongs to the local catalog or another pack.`);
  for (const template of pack.templates) if (catalog.templates.some(item => item.id === template.id) && !ownedTemplates.has(template.id)) throw new CanvasError("VALIDATION", `Template ${template.id} already belongs to the local catalog or another pack.`);
  for (const other of catalog.packs) if (other.id !== pack.id && (other.id.startsWith(`${pack.id}.`) || pack.id.startsWith(`${other.id}.`))) throw new CanvasError("VALIDATION", "Pack namespaces cannot nest or overlap.");
  pack.blockTypes.forEach(validateType);
  const types = new Map(catalog.blockTypes.map(type => [type.id, type]));
  for (const type of pack.blockTypes) types.set(type.id, type);
  const prospective = { ...catalog, blockTypes: [...types.values()] };
  for (const template of pack.templates) validateTemplate(template, prospective);
  for (const content of pack.documents) {
    for (const block of content.blocks) if (!prospective.blockTypes.some(type => type.id === block.typeId)) throw new CanvasError("UNKNOWN_TYPE", `Pack document needs missing type ${block.typeId}.`);
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
  const before = new Map((old ? [...old.blockTypes, ...old.templates] : []).map(entry => [entry.id, entry]));
  const diff = { added: [] as string[], replaced: [] as string[], unchanged: [] as string[] };
  for (const entry of [...next.blockTypes, ...next.templates]) {
    const previous = before.get(entry.id);
    (previous === undefined ? diff.added : JSON.stringify(previous) === JSON.stringify(entry) ? diff.unchanged : diff.replaced).push(entry.id);
  }
  return diff;
}
