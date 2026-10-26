import { getRendererSpec } from "../shared/renderers";
import { isWhiteboardRenderer, whiteboardMinSize } from '../shared/whiteboard';
import { randomUUID } from "node:crypto";
import {
  documentSchema, checklistDataSchema, type CanvasDocument, type CanvasOperation, type CanvasCatalog,
  type CanvasBlock, type CanvasGroup, type CanvasLink, type CanvasBundle, type GroupTemplate, type BlockType, LINK_BUNDLE_LIMITS,
} from "../shared/model";
import { CanvasError } from "../shared/errors";
import { isLocalImage } from "../shared/media";
import { bindableFor } from "../shared/bindings";
import { resolveScope } from "../shared/learning";

export const newId = (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "")}`;
export const clone = <T>(value: T): T => structuredClone(value);
export function safeJson(value: unknown, depth = 0): void {
  if (depth > 32) throw new CanvasError("TOO_LARGE", "JSON nesting exceeds 32 levels.");
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (["__proto__", "prototype", "constructor"].includes(key))
        throw new CanvasError("VALIDATION", `Unsafe JSON key: ${key}`);
      safeJson(child, depth + 1);
    }
  }
}

export function validateBlockData(block: CanvasBlock, type: BlockType): void {
  safeJson(block.data);
  const schema = getRendererSpec(type.renderer)?.dataSchema;
  if (isWhiteboardRenderer(type.renderer)) {
    const parsed = schema!.safeParse(block.data);
    if (!parsed.success) throw new CanvasError('VALIDATION', parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '));
  } else schema?.parse(block.data);
  if (type.renderer === "checklist") checklistDataSchema.parse(block.data);
  // Media may also hold an image from the person's computer: a stored reference or a small inline image (shared/media.ts).
  const localImage = type.renderer === "image-ref" && isLocalImage(block.data.url);
  if (["preview-frame", "image-ref"].includes(type.renderer ?? "") && block.data.url !== undefined && block.data.url !== "" && !localImage) {
    try {
      const url = new URL(String(block.data.url));
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
    } catch { throw new CanvasError("VALIDATION", type.renderer === "image-ref" ? "Media URLs must be HTTP or HTTPS without credentials, or an image stored by Lienzo." : "Preview/media URLs must be HTTP or HTTPS without credentials."); }
  }
  for (const property of type.properties) {
    const value = block.data[property.key];
    if (value === undefined) {
      if (property.required) throw new CanvasError("VALIDATION", `Block ${block.id} needs data.${property.key}.`);
    } else if (property.kind !== "json" && typeof value !== (property.kind === "text" ? "string" : property.kind)) {
      throw new CanvasError("VALIDATION", `Block ${block.id} data.${property.key} must be ${property.kind}.`);
    }
  }
  for (const key of Object.keys(block.data)) {
    if (!type.properties.some(property => property.key === key))
      throw new CanvasError("VALIDATION", `Undeclared property data.${key} on type ${type.id}.`);
  }
}

/** Only normalize newly supplied block data, never rewrite unrelated blocks during validation. */
export function normalizeBlock(block: CanvasBlock, type: BlockType): void {
  if (!isWhiteboardRenderer(type.renderer)) return;
  const parsed = getRendererSpec(type.renderer)!.dataSchema.safeParse(block.data);
  if (!parsed.success) throw new CanvasError('VALIDATION', parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '));
  block.data = parsed.data as CanvasBlock['data'];
}
export function validateBlockPresentation(block: CanvasBlock, type?: BlockType): void {
  // Removed pack types retain raw blocks. The wire envelope still applies, but their renderer/minima are unknown.
  if (!type) return;
  const renderer = type?.renderer;
  for (const path of Object.keys(block.bindings ?? {})) if (!bindableFor(path, renderer)) throw new CanvasError('VALIDATION', `Block ${block.id} bindings.${path}: a ${type.name} block (${renderer ?? type.id}) cannot bind ${path}. Every block binds size.width and size.height (not free text), offset.x, offset.y, rotation and opacity; wb-shape also stroke.color, fill.color, stroke.width, corner.radius; wb-text, wb-shape, node and note also text.size and text.template.`);
  if (isWhiteboardRenderer(renderer)) {
    if (!block.position || !Number.isFinite(block.position.x) || !Number.isFinite(block.position.y) || Math.abs(block.position.x) > 100000 || Math.abs(block.position.y) > 100000) throw new CanvasError('VALIDATION', 'Los objetos de pizarra necesitan position finita entre -100000 y 100000.');
    if (renderer === 'wb-text' && block.size) throw new CanvasError('VALIDATION', 'El texto libre usa data.width; no admite block.size.');
    if (renderer === 'wb-draw' && !block.size) throw new CanvasError('VALIDATION', 'El dibujo necesita block.size.');
  }
  if (!block.size) return;
  const spec = getRendererSpec(renderer);
  const min = isWhiteboardRenderer(renderer) ? whiteboardMinSize(renderer, block.data) : { width: Math.max(160, spec?.minSize?.width ?? 160), height: Math.max(104, spec?.minSize?.height ?? 104) };
  if (block.size.width < min.width || block.size.height < min.height) throw new CanvasError('VALIDATION', `El bloque ${block.id} necesita un tamaño mínimo de ${min.width} × ${min.height}.`);
}

export function validateTree(blocks: CanvasBlock[], groups: CanvasGroup[]): void {
  const ids = new Set<string>();
  const parents = new Map<string, string>();
  const entities = [...blocks, ...groups];
  for (const entity of entities) {
    if (ids.has(entity.id)) throw new CanvasError("INVARIANT", `Duplicate entity ID ${entity.id}.`);
    ids.add(entity.id);
  }
  const groupMap = new Map(groups.map(group => [group.id, group]));
  const blockSet = new Set(blocks.map(block => block.id));
  for (const group of groups) {
    for (const [children, expected] of [[group.blockIds, blockSet], [group.groupIds, new Set(groupMap.keys())]] as const) {
      for (const child of children) {
        if (!expected.has(child)) throw new CanvasError("INVARIANT", `Missing group child ${child}.`);
        if (parents.has(child)) throw new CanvasError("INVARIANT", `Entity ${child} has multiple parents or appears twice.`);
        parents.set(child, group.id);
      }
    }
  }
  for (const entity of entities) {
    if ((entity.parentGroupId ?? null) !== (parents.get(entity.id) ?? null))
      throw new CanvasError("INVARIANT", `Parent pointer disagrees with group membership for ${entity.id}.`);
    const visited = new Set([entity.id]);
    let parent = parents.get(entity.id);
    let depth = "groupIds" in entity ? 1 : 0;
    while (parent) {
      if (visited.has(parent)) throw new CanvasError("INVARIANT", "Group cycle detected.");
      visited.add(parent);
      if (++depth > 4) throw new CanvasError("INVARIANT", "Groups cannot nest beyond four levels.");
      parent = parents.get(parent);
    }
  }
}

export function validateDocument(document: CanvasDocument, catalog?: CanvasCatalog): void {
  documentSchema.parse(document);
  safeJson(document);
  validateTree(document.blocks, document.groups);
  validateLinks(document.blocks, document.groups, document.links);
  validateBundles(document);
  validateSheets(document.groups);
  const ids = new Set([...document.blocks, ...document.groups].map(entity => entity.id));
  if (new Set(document.selectedIds).size !== document.selectedIds.length || document.selectedIds.some(id => !ids.has(id)))
    throw new CanvasError("INVARIANT", "Selection must contain unique existing entity IDs.");
  if (catalog) for (const block of document.blocks) {
    const type = catalog.blockTypes.find(type => type.id === block.typeId);
    validateBlockPresentation(block, type);
    if (type) validateBlockData(block, type);
  }
}

/** A Sheet is a top-level group, and its number is unique in the document. */
export function validateSheets(groups: CanvasGroup[]): void {
  const numbers = new Set<number>();
  for (const group of groups) {
    if (!group.sheet) continue;
    if (group.parentGroupId) throw new CanvasError("INVARIANT", `Sheet ${group.id} must stay at the top level; it cannot go inside another group.`);
    if (numbers.has(group.sheet.number)) throw new CanvasError("INVARIANT", `Two Sheets share number ${group.sheet.number}.`);
    numbers.add(group.sheet.number);
  }
}
export function validateLinks(blocks: CanvasBlock[], groups: CanvasGroup[], links: CanvasLink[]): void {
  const endpoints = new Set([...blocks, ...groups].map(entity => entity.id));
  const ids = new Set<string>(), triples = new Set<string>();
  for (const link of links) {
    // IDs share the history/read namespace with entities.
    if (ids.has(link.id) || endpoints.has(link.id)) throw new CanvasError("INVARIANT", `Duplicate link ID ${link.id}.`);
    ids.add(link.id);
    if (!endpoints.has(link.from) || !endpoints.has(link.to)) throw new CanvasError("INVARIANT", `Both endpoints of link ${link.id} must exist.`);
    if (link.from === link.to) throw new CanvasError("INVARIANT", `Link ${link.id} cannot connect an entity to itself.`);
    const triple = JSON.stringify([link.from, link.to, link.kind]);
    if (triples.has(triple)) throw new CanvasError("INVARIANT", `Duplicate link (${link.from}, ${link.to}, ${link.kind}).`);
    triples.add(triple);
  }
}

/**
 * Bundles share the id namespace with entities and links; a link names an existing bundle, a bundle holds at most
 * LINK_BUNDLE_LIMITS.links links and its points stay finite and on the board. A bundle may be empty only inside a
 * transaction: reduce removes it at the end (pruneBundles).
 */
export function validateBundles(document: Pick<CanvasDocument, "blocks" | "groups" | "links" | "bundles">): void {
  const bundles = document.bundles ?? [], L = LINK_BUNDLE_LIMITS;
  if (bundles.length > L.bundles) throw new CanvasError("INVARIANT", `A Lienzo holds at most ${L.bundles} link bundles.`);
  const taken = new Set([...document.blocks, ...document.groups, ...document.links].map(item => item.id)), groups = new Set(document.groups.map(group => group.id)), counts = new Map<string, number>();
  for (const bundle of bundles) {
    if (taken.has(bundle.id)) throw new CanvasError("INVARIANT", `Duplicate bundle ID ${bundle.id}: it is already used by a block, group, link or bundle.`);
    taken.add(bundle.id); counts.set(bundle.id, 0);
    if (bundle.points.length < 2 || bundle.points.length > L.points) throw new CanvasError("VALIDATION", `Bundle ${bundle.id} needs 2 to ${L.points} points.`);
    if (bundle.points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y) || Math.abs(point.x) > L.extent || Math.abs(point.y) > L.extent)) throw new CanvasError("VALIDATION", `Bundle ${bundle.id} points must be finite, between -${L.extent} and ${L.extent}.`);
    if (bundle.parentGroupId && !groups.has(bundle.parentGroupId)) throw new CanvasError("INVARIANT", `Bundle ${bundle.id} names a missing Frame ${bundle.parentGroupId}.`);
  }
  for (const link of document.links) {
    if (link.bundleId === undefined) continue;
    const count = counts.get(link.bundleId);
    if (count === undefined) throw new CanvasError("NOT_FOUND", `Link ${link.id} names bundle ${link.bundleId}, which does not exist. Create it with bundle.create.`);
    if (count + 1 > L.links) throw new CanvasError("VALIDATION", `Bundle ${link.bundleId} holds at most ${L.links} links.`);
    counts.set(link.bundleId, count + 1);
  }
}
/** A bundle without links is gone; a document without bundles carries no bundles field, as before bundles existed. */
export function pruneBundles(document: CanvasDocument): void {
  if (!document.bundles) return;
  const used = new Set(document.links.map(link => link.bundleId).filter(Boolean));
  document.bundles = document.bundles.filter(bundle => used.has(bundle.id));
  if (!document.bundles.length) delete document.bundles;
}
function bundleOf(document: CanvasDocument, id: string): CanvasBundle {
  const found = document.bundles?.find(bundle => bundle.id === id);
  if (!found) throw new CanvasError("NOT_FOUND", `Bundle ${id} does not exist.`);
  return found;
}
/**
 * Copies made in one transaction (entity.duplicate): a bundle all of whose links were copied is copied with them, its
 * points unchanged (the copy is moved afterwards like its cards); a copied link whose bundle was not wholly copied is loose.
 */
function copyBundles(document: CanvasDocument, copied: Map<string, string>, remap: (id: string) => string): void {
  const links = new Map(document.links.map(link => [link.id, link]));
  for (const [source, copy] of copied) {
    const original = links.get(source), made = links.get(copy); if (!original?.bundleId || !made) continue;
    const members = document.links.filter(link => link.bundleId === original.bundleId && !copied.has(link.id) && ![...copied.values()].includes(link.id));
    if (members.length) { delete made.bundleId; continue; }
    const id = remap(original.bundleId), bundle = bundleOf(document, original.bundleId);
    if (!document.bundles!.some(item => item.id === id)) document.bundles!.push({ ...clone(bundle), id, ...(bundle.parentGroupId && copied.has(bundle.parentGroupId) ? { parentGroupId: copied.get(bundle.parentGroupId) } : {}) });
    made.bundleId = id;
  }
}
function removeTouchingLinks(document: CanvasDocument, removed: string[]): void {
  const ids = new Set(removed);
  document.links = document.links.filter(link => !ids.has(link.from) && !ids.has(link.to));
}

export function mergePatch(target: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  safeJson(patch);
  const result = clone(target);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete result[key];
    else if (typeof value === "object" && !Array.isArray(value)) {
      const old = result[key];
      result[key] = mergePatch(old && typeof old === "object" && !Array.isArray(old) ? old as Record<string, unknown> : {}, value as Record<string, unknown>);
    } else result[key] = clone(value);
  }
  return result;
}

/** Complete variant data can replace incompatible defaults or an earlier variant. */
function rendererData(type: BlockType | undefined, merged: CanvasBlock['data'], provided: CanvasBlock['data']): CanvasBlock['data'] {
  const schema = getRendererSpec(type?.renderer)?.dataSchema;
  return schema && !schema.safeParse(merged).success && schema.safeParse(provided).success ? clone(provided) : merged;
}

function entity(document: CanvasDocument, id: string): CanvasBlock | CanvasGroup {
  const found = [...document.blocks, ...document.groups].find(item => item.id === id);
  if (!found) throw new CanvasError("NOT_FOUND", `Entity ${id} does not exist.`);
  return found;
}
function detach(document: CanvasDocument, id: string): void {
  for (const group of document.groups) {
    group.blockIds = group.blockIds.filter(child => child !== id);
    group.groupIds = group.groupIds.filter(child => child !== id);
  }
  entity(document, id).parentGroupId = null;
}
function attach(document: CanvasDocument, id: string, parent: string | null): void {
  const child = entity(document, id);
  detach(document, id);
  if (parent) {
    const group = document.groups.find(group => group.id === parent);
    if (!group) throw new CanvasError("NOT_FOUND", `Parent group ${parent} does not exist.`);
    ("groupIds" in child ? group.groupIds : group.blockIds).push(id);
    child.parentGroupId = parent;
  }
}
export function groupSubtree(document: Pick<CanvasDocument, "groups">, id: string, visited = new Set<string>()): string[] {
  if (visited.has(id)) throw new CanvasError("INVARIANT", "Group cycle or duplicate subtree reference detected.");
  visited.add(id);
  const group = document.groups.find(group => group.id === id);
  if (!group) throw new CanvasError("NOT_FOUND", `Group ${id} does not exist.`);
  return [id, ...group.blockIds, ...group.groupIds.flatMap(child => groupSubtree(document, child, visited))];
}
function synchronizeChildren(document: CanvasDocument, group: CanvasGroup, blockIds: string[], groupIds: string[]): void {
  if (new Set([...blockIds, ...groupIds]).size !== blockIds.length + groupIds.length)
    throw new CanvasError("INVARIANT", "Group membership contains duplicate IDs.");
  for (const id of [...group.blockIds, ...group.groupIds]) entity(document, id).parentGroupId = null;
  group.blockIds = [];
  group.groupIds = [];
  for (const id of blockIds) {
    if (!document.blocks.some(block => block.id === id)) throw new CanvasError("NOT_FOUND", `Block ${id} does not exist.`);
    attach(document, id, group.id);
  }
  for (const id of groupIds) {
    if (!document.groups.some(item => item.id === id)) throw new CanvasError("NOT_FOUND", `Group ${id} does not exist.`);
    attach(document, id, group.id);
  }
}

function insertTemplate(document: CanvasDocument, template: GroupTemplate, prefix: string, catalog: CanvasCatalog): Map<string, string> {
  const remap = (id: string) => `${prefix}.${id}`;
  const copied = new Set([...template.blocks, ...template.groups].map(entity => entity.id));
  const ids = new Map([...copied, ...template.links.map(link => link.id)].map(id => [id, remap(id)]));
  const types = new Map(catalog.blockTypes.map(type => [type.id, type.renderer]));
  for (const block of template.blocks) {
    const cloned = clone(block), spec = getRendererSpec(types.get(block.typeId));
    document.blocks.push({ ...cloned, data: spec?.remapReferences?.(cloned.data, ids) ?? cloned.data,
      id: remap(block.id), parentGroupId: block.parentGroupId ? remap(block.parentGroupId) : null });
  }
  // A copy of a Sheet is an ordinary group: the chapter mark and its number stay with the original.
  for (const { sheet: _sheet, ...group } of template.groups) document.groups.push({ ...clone(group), id: remap(group.id), parentGroupId: group.parentGroupId ? remap(group.parentGroupId) : null, blockIds: group.blockIds.map(remap), groupIds: group.groupIds.map(remap), templateId: template.id });
  // A template brings no bundles: its links arrive loose (entity.duplicate restores whole bundles with copyBundles).
  const links = new Map<string, string>();
  for (const { bundleId: _bundle, ...link } of template.links) if (copied.has(link.from) && copied.has(link.to)) { document.links.push({ ...clone(link), id: remap(link.id), from: remap(link.from), to: remap(link.to) }); links.set(link.id, remap(link.id)); }
  return links;
}

/**
 * Stroke layers (§18.12). An assistant cannot sign a drawing as the learner; a drawing anchored to a card
 * shares that card's group and is removed with it. An anchor that was never in this document stays unresolved.
 */
function settleStrokeLayers(next: CanvasDocument, before: ReadonlyMap<string, CanvasBlock>, operation: CanvasOperation, catalog: CanvasCatalog, actor: 'user' | 'agent' | 'system'): void {
  const renderer = (block: CanvasBlock) => catalog.blockTypes.find(type => type.id === block.typeId)?.renderer;
  if (actor === 'agent' && (operation.type === 'block.create' || operation.type === 'block.update')) {
    const block = next.blocks.find(item => item.id === (operation.type === 'block.create' ? operation.block.id : operation.id));
    if (block && renderer(block) === 'wb-draw') {
      const prior = before.get(block.id), author = prior ? prior.data.author : 'assistant';
      if (author === undefined) delete block.data.author; else block.data.author = author;
    }
  }
  const blocks = new Map(next.blocks.map(block => [block.id, block]));
  for (const block of next.blocks) {
    if (renderer(block) !== 'wb-draw' || typeof block.data.anchor !== 'string') continue;
    const anchor = blocks.get(block.data.anchor);
    if (!anchor) continue;
    if (anchor.id === block.id || isWhiteboardRenderer(renderer(anchor))) throw new CanvasError('VALIDATION', 'Un dibujo solo puede anclarse a una tarjeta, no a otro elemento de pizarra.');
    if ((anchor.parentGroupId ?? null) !== (block.parentGroupId ?? null)) attach(next, block.id, anchor.parentGroupId ?? null);
  }
}
/** Once the whole transaction has run: a card that was here and is gone takes its annotations with it. */
function removeOrphanedStrokeLayers(next: CanvasDocument, known: ReadonlySet<string>, catalog: CanvasCatalog): void {
  const present = new Set(next.blocks.map(block => block.id));
  const orphaned = next.blocks.filter(block => catalog.blockTypes.find(type => type.id === block.typeId)?.renderer === 'wb-draw' && typeof block.data.anchor === 'string' && !present.has(block.data.anchor) && known.has(block.data.anchor)).map(block => block.id);
  if (!orphaned.length) return;
  for (const id of orphaned) detach(next, id);
  next.blocks = next.blocks.filter(block => !orphaned.includes(block.id)); removeTouchingLinks(next, orphaned);
  next.selectedIds = next.selectedIds.filter(id => !orphaned.includes(id));
  validateDocument(next, catalog);
}
export function reduce(document: CanvasDocument, operations: CanvasOperation[], catalog: CanvasCatalog, actor: 'user' | 'agent' | 'system' = 'user'): CanvasDocument {
  const next = clone(document), known = new Set(document.blocks.map(block => block.id));
  for (const operation of operations) {
    const before = new Map(next.blocks.map(block => [block.id, block.id === (operation.type === 'block.update' ? operation.id : '') ? clone(block) : block]));
    switch (operation.type) {
      case "document.update": Object.assign(next, Object.fromEntries(Object.entries(operation).filter(([key]) => key !== "type"))); break;
      case "link.create": next.links.push(clone(operation.link)); break;
      case "link.update": {
        const link = next.links.find(link => link.id === operation.id);
        if (!link) throw new CanvasError("NOT_FOUND", `Link ${operation.id} does not exist.`);
        const { bundleId, ...patch } = clone(operation.patch);
        Object.assign(link, patch);
        if (bundleId === null) delete link.bundleId; else if (bundleId !== undefined) link.bundleId = bundleId;
        break;
      }
      case "bundle.create": {
        if (new Set(operation.linkIds).size !== operation.linkIds.length) throw new CanvasError("VALIDATION", `Bundle ${operation.bundle.id} lists a link twice.`);
        const links = operation.linkIds.map(id => next.links.find(link => link.id === id) ?? (() => { throw new CanvasError("NOT_FOUND", `Link ${id} does not exist.`); })());
        const { parentGroupId, ...bundle } = clone(operation.bundle);
        (next.bundles ??= []).push(parentGroupId ? { ...bundle, parentGroupId } : bundle);
        // A link already in another bundle moves to this one; a bundle it leaves empty is removed with the transaction.
        for (const link of links) link.bundleId = bundle.id;
        break;
      }
      case "bundle.update": {
        const bundle = bundleOf(next, operation.id), { points, parentGroupId } = clone(operation.patch);
        if (points) bundle.points = points;
        if (parentGroupId === null) delete bundle.parentGroupId; else if (parentGroupId !== undefined) bundle.parentGroupId = parentGroupId;
        break;
      }
      case "bundle.delete": {
        bundleOf(next, operation.id);
        next.bundles = next.bundles!.filter(bundle => bundle.id !== operation.id);
        for (const link of next.links) if (link.bundleId === operation.id) delete link.bundleId;
        break;
      }
      case "link.delete": {
        if (!next.links.some(link => link.id === operation.id)) throw new CanvasError("NOT_FOUND", `Link ${operation.id} does not exist.`);
        next.links = next.links.filter(link => link.id !== operation.id);
        break;
      }
      case "block.create": {
        const block = clone(operation.block);
        const type = catalog.blockTypes.find(type => type.id === block.typeId);
        if (!type) throw new CanvasError("UNKNOWN_TYPE", `Unknown block type ${block.typeId}. Read canvas_catalog first.`, { available: catalog.blockTypes.map(type => type.id) });
        block.data = rendererData(type, { ...clone(type.defaults), ...block.data }, block.data);
        if (!block.bindings || !Object.keys(block.bindings).length) delete block.bindings;
        normalizeBlock(block, type);
        next.blocks.push(block);
        attach(next, block.id, block.parentGroupId ?? null);
        break;
      }
      case "block.update": {
        const block = next.blocks.find(item => item.id === operation.id);
        if (!block) throw new CanvasError("NOT_FOUND", `Block ${operation.id} does not exist.`);
        const { data, parentGroupId, ...patch } = operation.patch;
        if (patch.typeId && !catalog.blockTypes.some(type => type.id === patch.typeId)) throw new CanvasError("UNKNOWN_TYPE", `Unknown block type ${patch.typeId}.`);
        Object.assign(block, patch);
        if (patch.bindings !== undefined && (!block.bindings || !Object.keys(block.bindings).length)) delete block.bindings;
        if (data) block.data = rendererData(catalog.blockTypes.find(type => type.id === block.typeId), mergePatch(block.data, data) as CanvasBlock['data'], data);
        const type = catalog.blockTypes.find(type => type.id === block.typeId);
        if (type) normalizeBlock(block, type);
        if (parentGroupId !== undefined) attach(next, block.id, parentGroupId);
        break;
      }
      case "block.delete": {
        if (!next.blocks.some(block => block.id === operation.id)) throw new CanvasError("NOT_FOUND", `Block ${operation.id} does not exist.`);
        detach(next, operation.id);
        next.blocks = next.blocks.filter(block => block.id !== operation.id);
        removeTouchingLinks(next, [operation.id]);
        break;
      }
      case "group.create": {
        const group = clone(operation.group);
        const blocks = [...group.blockIds], groups = [...group.groupIds];
        next.groups.push({ ...group, blockIds: [], groupIds: [] });
        const created = next.groups.at(-1)!;
        attach(next, group.id, group.parentGroupId ?? null);
        synchronizeChildren(next, created, blocks, groups);
        break;
      }
      case "group.update": {
        const group = next.groups.find(group => group.id === operation.id);
        if (!group) throw new CanvasError("NOT_FOUND", `Group ${operation.id} does not exist.`);
        const { blockIds, groupIds, parentGroupId, ...patch } = operation.patch;
        if (blockIds || groupIds) synchronizeChildren(next, group, blockIds ?? [...group.blockIds], groupIds ?? [...group.groupIds]);
        Object.assign(group, patch);
        if (parentGroupId !== undefined) attach(next, group.id, parentGroupId);
        break;
      }
      case "group.delete": {
        const group = next.groups.find(item => item.id === operation.id);
        if (!group) throw new CanvasError("NOT_FOUND", `Group ${operation.id} does not exist.`);
        let removed: string[];
        if (operation.ungroup) {
          const parent = group.parentGroupId ?? null;
          for (const id of [...group.blockIds, ...group.groupIds]) {
            const child = entity(next, id);
            child.position = { x: (child.position?.x ?? 0) + (group.position?.x ?? 0), y: (child.position?.y ?? 0) + (group.position?.y ?? 0) };
            attach(next, id, parent);
          }
          removed = [group.id];
        } else removed = groupSubtree(next, group.id);
        detach(next, group.id);
        next.blocks = next.blocks.filter(block => !removed.includes(block.id));
        next.groups = next.groups.filter(group => !removed.includes(group.id));
        removeTouchingLinks(next, removed);
        // A strand placed in a Frame that is gone keeps its points, now read from the root.
        for (const bundle of next.bundles ?? []) if (bundle.parentGroupId && removed.includes(bundle.parentGroupId)) delete bundle.parentGroupId;
        break;
      }
      case "entity.move": {
        attach(next, operation.id, operation.parentGroupId);
        if (operation.position) entity(next, operation.id).position = clone(operation.position);
        break;
      }
      case "entity.duplicate": {
        const source = entity(next, operation.id);
        if ("groupIds" in source) {
          const subtree = new Set(groupSubtree(next, source.id));
          const template: GroupTemplate = { id: "duplicate", name: source.title, description: source.description, blocks: clone(next.blocks.filter(block => subtree.has(block.id))), groups: clone(next.groups.filter(group => subtree.has(group.id))), links: clone(next.links.filter(link => subtree.has(link.from) && subtree.has(link.to))) };
          template.groups.find(group => group.id === source.id)!.parentGroupId = null;
          const links = insertTemplate(next, template, operation.idPrefix, catalog);
          for (const id of subtree) links.set(id, `${operation.idPrefix}.${id}`);
          copyBundles(next, links, id => `${operation.idPrefix}.${id}`);
          attach(next, `${operation.idPrefix}.${source.id}`, source.parentGroupId ?? null);
        } else {
          const cloned = clone(source), renderer = catalog.blockTypes.find(type => type.id === source.typeId)?.renderer;
          const ids = new Map([[source.id, `${operation.idPrefix}.${source.id}`]]);
          const block = { ...cloned, data: getRendererSpec(renderer)?.remapReferences?.(cloned.data, ids) ?? cloned.data, id: `${operation.idPrefix}.${source.id}` };
          next.blocks.push(block);
          attach(next, block.id, source.parentGroupId ?? null);
        }
        break;
      }
      case "selection.set": next.selectedIds = [...operation.ids]; break;
      case "communication.set": next.communication = clone(operation.communication); break;
    }
    settleStrokeLayers(next, before, operation, catalog, actor);
    const ids = new Set([...next.blocks, ...next.groups].map(entity => entity.id));
    next.selectedIds = next.selectedIds.filter(id => ids.has(id));
    validateDocument(next, catalog);
    for (const block of next.blocks) known.add(block.id);
  }
  removeOrphanedStrokeLayers(next, known, catalog);
  pruneBundles(next);
  checkNewBindings(document, next);
  return next;
}
/**
 * A binding written in this transaction must name a variable its block can see (declared on one of its Frames or on the
 * Lienzo, possibly in the same transaction). A binding left inert by deleting its variable later stays as it is.
 */
function checkNewBindings(before: CanvasDocument, next: CanvasDocument): void {
  const empty = { blocks: {}, scopes: {} };
  for (const block of next.blocks) {
    if (!block.bindings) continue;
    const old = before.blocks.find(b => b.id === block.id)?.bindings ?? {}, scope = resolveScope(next, block.id, empty);
    for (const [path, binding] of Object.entries(block.bindings)) {
      if (old[path]?.variable === binding.variable || Object.hasOwn(scope, binding.variable)) continue;
      throw new CanvasError('VALIDATION', `Block ${block.id} bindings.${path}: no variable ${binding.variable} on its Frames or the Lienzo. Declare it first with document.update or group.update variables (the same transaction works).`);
    }
  }
}

export function effectiveInstructions(document: CanvasDocument, id: string) {
  const target = entity(document, id);
  const levels = [target.communication];
  let parent = target.parentGroupId;
  while (parent) {
    const group = document.groups.find(group => group.id === parent)!;
    levels.push(group.communication);
    parent = group.parentGroupId;
  }
  levels.push(document.communication);
  return levels.filter((level): level is NonNullable<typeof level> => !!level);
}

