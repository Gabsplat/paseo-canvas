import { randomUUID } from "node:crypto";
import {
  documentSchema, diagramDataSchema, checklistDataSchema, type CanvasDocument, type CanvasOperation, type CanvasCatalog,
  type CanvasBlock, type CanvasGroup, type CanvasLink, type GroupTemplate, type BlockType,
} from "../shared/model";
import { CanvasError } from "../shared/errors";

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
  if (type.renderer === "diagram") diagramDataSchema.parse(block.data);
  if (type.renderer === "checklist") checklistDataSchema.parse(block.data);
  if (["preview-frame", "image-ref"].includes(type.renderer ?? "") && block.data.url !== undefined && block.data.url !== "") {
    try {
      const url = new URL(String(block.data.url));
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
    } catch { throw new CanvasError("VALIDATION", "Preview/media URLs must be HTTP or HTTPS without credentials."); }
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
  const ids = new Set([...document.blocks, ...document.groups].map(entity => entity.id));
  if (new Set(document.selectedIds).size !== document.selectedIds.length || document.selectedIds.some(id => !ids.has(id)))
    throw new CanvasError("INVARIANT", "Selection must contain unique existing entity IDs.");
  if (catalog) for (const block of document.blocks) {
    const type = catalog.blockTypes.find(type => type.id === block.typeId);
    if (type) validateBlockData(block, type);
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

function insertTemplate(document: CanvasDocument, template: GroupTemplate, prefix: string): void {
  const remap = (id: string) => `${prefix}.${id}`;
  const copied = new Set([...template.blocks, ...template.groups].map(entity => entity.id));
  for (const block of template.blocks) document.blocks.push({ ...clone(block), id: remap(block.id), parentGroupId: block.parentGroupId ? remap(block.parentGroupId) : null });
  for (const group of template.groups) document.groups.push({ ...clone(group), id: remap(group.id), parentGroupId: group.parentGroupId ? remap(group.parentGroupId) : null, blockIds: group.blockIds.map(remap), groupIds: group.groupIds.map(remap), templateId: template.id });
  for (const link of template.links) if (copied.has(link.from) && copied.has(link.to)) document.links.push({ ...clone(link), id: remap(link.id), from: remap(link.from), to: remap(link.to) });
}

export function reduce(document: CanvasDocument, operations: CanvasOperation[], catalog: CanvasCatalog): CanvasDocument {
  const next = clone(document);
  for (const operation of operations) {
    switch (operation.type) {
      case "document.update": Object.assign(next, Object.fromEntries(Object.entries(operation).filter(([key]) => key !== "type"))); break;
      case "link.create": next.links.push(clone(operation.link)); break;
      case "link.update": {
        const link = next.links.find(link => link.id === operation.id);
        if (!link) throw new CanvasError("NOT_FOUND", `Link ${operation.id} does not exist.`);
        Object.assign(link, clone(operation.patch));
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
        block.data = { ...clone(type.defaults), ...block.data };
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
        if (data) block.data = mergePatch(block.data, data) as CanvasBlock["data"];
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
          insertTemplate(next, template, operation.idPrefix);
          attach(next, `${operation.idPrefix}.${source.id}`, source.parentGroupId ?? null);
        } else {
          const block = { ...clone(source), id: `${operation.idPrefix}.${source.id}` };
          next.blocks.push(block);
          attach(next, block.id, source.parentGroupId ?? null);
        }
        break;
      }
      case "selection.set": next.selectedIds = [...operation.ids]; break;
      case "communication.set": next.communication = clone(operation.communication); break;
      case "template.insert": {
        const template = catalog.templates.find(template => template.id === operation.templateId);
        if (!template) throw new CanvasError("NOT_FOUND", `Template ${operation.templateId} does not exist.`);
        for (const block of template.blocks) if (!catalog.blockTypes.some(type => type.id === block.typeId))
          throw new CanvasError("UNKNOWN_TYPE", `Template needs missing type ${block.typeId}.`);
        insertTemplate(next, template, operation.idPrefix);
        break;
      }
    }
    const ids = new Set([...next.blocks, ...next.groups].map(entity => entity.id));
    next.selectedIds = next.selectedIds.filter(id => ids.has(id));
    validateDocument(next, catalog);
  }
  return next;
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

export function exportGroup(document: CanvasDocument, groupId: string, templateId: string, name: string): GroupTemplate {
  const ids = new Set(groupSubtree(document, groupId));
  const groups = clone(document.groups.filter(group => ids.has(group.id)));
  const root = groups.find(group => group.id === groupId)!;
  root.parentGroupId = null;
  return { id: templateId, name, description: root.description, blocks: clone(document.blocks.filter(block => ids.has(block.id))), groups, links: clone(document.links.filter(link => ids.has(link.from) && ids.has(link.to))) };
}
