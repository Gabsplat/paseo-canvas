/**
 * Copy, cut, paste and duplicate, pure (docs/design.md §42). A copy is a small JSON document (`Clip`) with the copied
 * blocks, Frames and the links among them. It lives in this client (`lastClip`) and on the system clipboard as text
 * that starts with a marker, so it pastes into another Lienzo, another window or the desktop app. Pasting builds one
 * transaction of creates with fresh ids; nothing of the source Lienzo is referenced.
 */
import { z } from 'zod';
import { blockSchema, groupSchema, linkSchema, type CanvasBlock, type CanvasCatalog, type CanvasDocument, type CanvasGroup, type CanvasLink, type CanvasOperation } from '../shared/model';
import { getRendererSpec } from '../shared/renderers';
import { newId, topSelection, type Point, type Rect } from './logic';

export const CLIP_FORMAT = 'lienzo-clipboard';
export type ClipTop = { id: string; x: number; y: number; width: number; height: number; parentGroupId: string | null };
export type Clip = { format: typeof CLIP_FORMAT; version: 1; blocks: CanvasBlock[]; groups: CanvasGroup[]; links: CanvasLink[]; tops: ClipTop[] };
const clipSchema = z.object({
  format: z.literal(CLIP_FORMAT), version: z.literal(1),
  blocks: z.array(blockSchema).max(1000), groups: z.array(groupSchema).max(200), links: z.array(linkSchema).max(2000),
  tops: z.array(z.object({ id: z.string(), x: z.number().finite(), y: z.number().finite(), width: z.number().finite(), height: z.number().finite(), parentGroupId: z.string().nullable() })).min(1).max(1200),
});
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const renderer = (catalog: CanvasCatalog | null | undefined, typeId: string) => catalog?.blockTypes.find(t => t.id === typeId)?.renderer;

/** What a copy of these entities holds: the outermost selected ones, everything inside their Frames, and the links among all of it. */
export function copyClip(doc: CanvasDocument, rects: ReadonlyMap<string, Rect>, ids: readonly string[]): Clip | null {
  const tops = topSelection(doc, [...ids]).filter(e => { const r = rects.get(e.id); return r && !r.hidden; });
  if (!tops.length) return null;
  const blocks = new Map(doc.blocks.map(b => [b.id, b])), groups = new Map(doc.groups.map(g => [g.id, g])), seen = new Set<string>();
  const add = (id: string) => { if (seen.has(id)) return; seen.add(id); const g = groups.get(id); if (g) [...g.groupIds, ...g.blockIds].forEach(add); };
  tops.forEach(e => add(e.id));
  return {
    format: CLIP_FORMAT, version: 1,
    blocks: doc.blocks.filter(b => seen.has(b.id)).map(clone), groups: doc.groups.filter(g => seen.has(g.id)).map(g => { const { sheet: _sheet, ...rest } = clone(g); return rest; }),
    links: doc.links.filter(l => seen.has(l.from) && seen.has(l.to)).map(clone),
    tops: tops.map(e => { const r = rects.get(e.id)!; return { id: e.id, x: r.x, y: r.y, width: r.width, height: r.height, parentGroupId: (blocks.get(e.id) ?? groups.get(e.id))?.parentGroupId ?? null }; }),
  };
}
/** The text put on the system clipboard. */
export const clipText = (clip: Clip) => JSON.stringify(clip);
/** A copy read back from the clipboard, or null when the text is anything else. */
export function parseClip(text: string | null | undefined): Clip | null {
  if (!text || !text.trimStart().startsWith('{') || !text.includes(CLIP_FORMAT)) return null;
  try { const parsed = clipSchema.safeParse(JSON.parse(text)); return parsed.success ? parsed.data as Clip : null; } catch { return null; }
}
/** The box around a copy's outermost entities, in the coordinates they were copied from. */
export function clipBounds(clip: Clip): { x: number; y: number; width: number; height: number } {
  const x = Math.min(...clip.tops.map(t => t.x)), y = Math.min(...clip.tops.map(t => t.y));
  return { x, y, width: Math.max(...clip.tops.map(t => t.x + t.width)) - x, height: Math.max(...clip.tops.map(t => t.y + t.height)) - y };
}

export type Placement = { parentGroupId: string | null; position: Point };
export type PasteOptions = {
  catalog?: CanvasCatalog | null;
  /** Where each outermost entity goes: its container and its position inside it. */
  place(top: ClipTop): Placement;
  /** Bindings stay only where their variables are sure to exist: the same Lienzo and container (duplicate). */
  keepBindings?: boolean;
  /** Fresh ids; tests pass a counter. */
  idFor?(kind: 'block' | 'group' | 'link', old: string): string;
};
/**
 * One transaction that creates a copy: Frames first, each followed by what it holds in order, then the links. Every id
 * is new and every reference inside the copy (a link's ends, a drawing's card, a file tree's entries) follows it.
 * A block of a type this catalog lacks is left out with its links; `skipped` counts them.
 */
export function pasteOperations(clip: Clip, options: PasteOptions): { operations: CanvasOperation[]; tops: string[]; skipped: number } {
  const idFor = options.idFor ?? ((kind: string) => newId(kind === 'group' ? 'group' : kind === 'link' ? 'link' : 'block'));
  const known = (b: CanvasBlock) => !options.catalog || options.catalog.blockTypes.some(t => t.id === b.typeId);
  const blocks = new Map(clip.blocks.map(b => [b.id, b])), groups = new Map(clip.groups.map(g => [g.id, g])), ids = new Map<string, string>();
  for (const b of clip.blocks) if (known(b)) ids.set(b.id, idFor('block', b.id));
  for (const g of clip.groups) ids.set(g.id, idFor('group', g.id));
  const declared = (blockId: string) => { const names = new Set<string>(); let parent = blocks.get(blockId)?.parentGroupId; while (parent && groups.has(parent)) { for (const v of groups.get(parent)!.variables ?? []) names.add(v.name); parent = groups.get(parent)!.parentGroupId; } return names; };
  const operations: CanvasOperation[] = [], tops: string[] = [], topIds = new Set(clip.tops.map(t => t.id));
  const blockOp = (b: CanvasBlock, parentGroupId: string | null, position: Point | undefined) => {
    const data = clone(b.data), spec = getRendererSpec(renderer(options.catalog, b.typeId) ?? b.typeId), anchor = typeof data.anchor === 'string' ? data.anchor : undefined;
    let next = spec?.remapReferences?.(data, ids) ?? data;
    if (anchor && !ids.has(anchor)) { const { anchor: _anchor, ...rest } = next as Record<string, unknown>; next = rest as CanvasBlock['data']; }
    const { bindings, ...rest } = clone(b), names = options.keepBindings ? null : declared(b.id);
    const kept = bindings ? Object.fromEntries(Object.entries(bindings).filter(([, binding]) => !names || names.has(binding.variable))) : undefined;
    const block: CanvasBlock = { ...rest, id: ids.get(b.id)!, data: next, parentGroupId, ...(kept && Object.keys(kept).length ? { bindings: kept } : {}) };
    if (position) block.position = position; else delete block.position;
    operations.push({ type: 'block.create', block });
  };
  const groupOp = (g: CanvasGroup, parentGroupId: string | null, position: Point | undefined) => {
    const { blockIds, groupIds, ...rest } = clone(g), group: CanvasGroup = { ...rest, id: ids.get(g.id)!, parentGroupId, blockIds: [], groupIds: [] };
    if (position) group.position = position; else delete group.position;
    operations.push({ type: 'group.create', group });
    for (const id of groupIds) { const child = groups.get(id); if (child && !topIds.has(id)) groupOp(child, group.id, child.position); }
    for (const id of blockIds) { const child = blocks.get(id); if (child && ids.has(id) && !topIds.has(id)) blockOp(child, group.id, child.position); }
  };
  for (const top of clip.tops) {
    const g = groups.get(top.id), b = blocks.get(top.id); if (!g && !(b && ids.has(b.id))) continue;
    // A drawing copied with its card stays where it was on the card; copied alone, it becomes a free drawing.
    const anchor = b && typeof b.data.anchor === 'string' && ids.has(b.data.anchor) ? blocks.get(b.data.anchor) : undefined;
    const place = anchor ? null : options.place(top);
    if (g) groupOp(g, place!.parentGroupId, place!.position);
    else blockOp(b!, place ? place.parentGroupId : null, place ? place.position : b!.position);
    tops.push(ids.get(top.id)!);
  }
  // A drawing that follows a card shares the card's container; the reducer settles it, so its op names any parent.
  for (const link of clip.links) if (ids.has(link.from) && ids.has(link.to)) operations.push({ type: 'link.create', link: { ...clone(link), id: idFor('link', link.id), from: ids.get(link.from)!, to: ids.get(link.to)! } });
  return { operations, tops, skipped: clip.blocks.length - clip.blocks.filter(known).length };
}

/** Each outermost entity at its copied place shifted by `offset`, in a container of its own choosing (`parentOf`). */
export function placeAt(rects: ReadonlyMap<string, Rect>, offset: Point, parentOf: (top: ClipTop) => string | null): (top: ClipTop) => Placement {
  return top => { const parentGroupId = parentOf(top), origin = parentGroupId ? rects.get(parentGroupId) : null;
    return { parentGroupId, position: { x: Math.round(top.x + offset.x - (origin?.x ?? 0)), y: Math.round(top.y + offset.y - (origin?.y ?? 0)) } }; };
}
/** Duplicate in place (⌘D) and Alt-drag: the copies in the same containers, `offset` away, with their links. */
export function duplicateOperations(doc: CanvasDocument, rects: ReadonlyMap<string, Rect>, ids: readonly string[], offset: Point, options: { catalog?: CanvasCatalog | null; parentOf?(top: ClipTop): string | null; idFor?: PasteOptions['idFor'] } = {}) {
  const clip = copyClip(doc, rects, ids); if (!clip) return null;
  const same = !options.parentOf;
  return pasteOperations(clip, { catalog: options.catalog, idFor: options.idFor, keepBindings: same, place: placeAt(rects, offset, options.parentOf ?? (top => top.parentGroupId)) });
}

/** The last copy made in this client: pasted when the system clipboard cannot be read. */
let lastClip: Clip | null = null;
export const rememberClip = (clip: Clip | null) => { lastClip = clip; };
export const rememberedClip = () => lastClip;
