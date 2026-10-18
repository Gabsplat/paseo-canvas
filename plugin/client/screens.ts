/**
 * The logic behind the screens around the canvas (docs/redesign-2026-10.md, "UI pass"): Lienzos, Settings,
 * Extensions and History. Pure functions, no React and no DOM, so the tests run them directly.
 */
import type { CanvasCatalog, CanvasDocument, CanvasPack, CatalogExtension, documentSummarySchema } from '../shared/model';
import type { z } from 'zod';
import type { Tone } from './color';
import { layoutDocument, minimapFit, type Rect } from './logic';
import { normalizeCombo, resolveShortcuts, type Overrides, type ShortcutDef } from './shortcuts';

export type LienzoSummary = z.infer<typeof documentSummarySchema>;
export type LienzoSort = 'recent' | 'name';

const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Lienzos matching every word of the query (accents and case ignored), in the chosen order. */
export function filterLienzos(list: readonly LienzoSummary[], query: string, sort: LienzoSort): LienzoSummary[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const hits = list.filter(d => { const text = fold(`${d.title} ${d.description}`); return words.every(w => text.includes(w)); });
  const recent = (a: LienzoSummary, b: LienzoSummary) => b.updatedAt.localeCompare(a.updatedAt);
  return [...hits].sort(sort === 'name' ? (a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base', numeric: true }) || recent(a, b) : recent);
}

/** "just now", "12 min ago", "3 h ago", "2 d ago", then the date. */
export function editedAgo(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(iso)) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} h ago`;
  if (minutes < 1440 * 7) return `${Math.floor(minutes / 1440)} d ago`;
  const date = new Date(iso), month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][date.getMonth()];
  return `${date.getDate()} ${month}${date.getFullYear() !== new Date(now).getFullYear() ? ' ' + date.getFullYear() : ''}`;
}
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
/** "Edited 3 h ago · 24 blocks · 3 Sheets". Counts are left out when the server did not send them. */
export function lienzoMeta(d: LienzoSummary, now = Date.now()): string {
  return [`Edited ${editedAgo(d.updatedAt, now)}`, ...(d.blockCount !== undefined ? [plural(d.blockCount, 'block')] : []), ...(d.hojaCount ? [plural(d.hojaCount, 'Sheet')] : [])].join(' · ');
}

/**
 * A live thumbnail: the Lienzo's real layout fitted into a box, like the minimap. Frames are outlines (Sheets a little
 * stronger), cards filled marks in their tone, drawings faint marks, links thin lines between centres. Coordinates are
 * in the thumbnail's pixels.
 */
export type ThumbItem = { id: string; kind: 'marco' | 'hoja' | 'card' | 'drawing'; x: number; y: number; width: number; height: number; tone: Tone };
export type ThumbLink = { id: string; x1: number; y1: number; x2: number; y2: number };
export type Thumbnail = { items: ThumbItem[]; links: ThumbLink[]; empty: boolean };
export function thumbnailModel(doc: CanvasDocument, catalog: CanvasCatalog | null, size: { width: number; height: number }, options: { padding?: number; toneOf?(typeId: string): Tone; rects?: Map<string, Rect> } = {}): Thumbnail {
  const rects = options.rects ?? layoutDocument(doc, {}, catalog);
  const visible = (id: string) => { const r = rects.get(id); return r && !r.hidden ? r : undefined; };
  const boxes = [...doc.groups, ...doc.blocks].map(e => visible(e.id)).filter((r): r is Rect => !!r);
  if (!boxes.length) return { items: [], links: [], empty: true };
  const minX = Math.min(...boxes.map(r => r.x)), minY = Math.min(...boxes.map(r => r.y));
  const maxX = Math.max(...boxes.map(r => r.x + r.width)), maxY = Math.max(...boxes.map(r => r.y + r.height));
  const pad = options.padding ?? 12, inner = { width: Math.max(1, size.width - 2 * pad), height: Math.max(1, size.height - 2 * pad) };
  const fit = minimapFit({ x: minX, y: minY, width: maxX - minX, height: maxY - minY }, inner);
  const k = Math.min(fit.k, 0.35); // A Lienzo with one small card is not blown up to fill the card.
  const ox = pad + (inner.width - (maxX - minX) * k) / 2 - minX * k, oy = pad + (inner.height - (maxY - minY) * k) / 2 - minY * k;
  const place = (r: Rect) => ({ x: r.x * k + ox, y: r.y * k + oy, width: Math.max(2, r.width * k), height: Math.max(2, r.height * k) });
  const rendererOf = (typeId: string) => catalog?.blockTypes.find(t => t.id === typeId)?.renderer ?? '';
  const items: ThumbItem[] = [];
  // Deepest Frames last so nested outlines sit on top of their parents; cards after every Frame.
  for (const g of [...doc.groups].sort((a, b) => (rects.get(a.id)?.depth ?? 0) - (rects.get(b.id)?.depth ?? 0))) { const r = visible(g.id); if (r) items.push({ id: g.id, kind: g.sheet ? 'hoja' : 'marco', ...place(r), tone: 'neutro' }); }
  for (const b of doc.blocks) { const r = visible(b.id); if (!r) continue; const drawing = rendererOf(b.typeId).startsWith('wb-'); items.push({ id: b.id, kind: drawing ? 'drawing' : 'card', ...place(r), tone: drawing ? 'neutro' : options.toneOf?.(b.typeId) ?? 'neutro' }); }
  const at = new Map(items.map(i => [i.id, i]));
  const links = (doc.links ?? []).flatMap(l => { const a = at.get(l.from), b = at.get(l.to); return a && b ? [{ id: l.id, x1: a.x + a.width / 2, y1: a.y + a.height / 2, x2: b.x + b.width / 2, y2: b.y + b.height / 2 }] : []; });
  return { items, links, empty: false };
}

/** History grouped by day, newest first: "Today", "Yesterday", then "Monday 12 October" (with the year when it is not this one). */
export type HistoryEntry = { id: string; revision: number; actor: 'user' | 'agent' | 'system'; agentId?: string; label: string; at: string; changed: string[]; removed: string[]; kind: 'edit' | 'undo' | 'redo' };
export function historyByDay<T extends Pick<HistoryEntry, 'at'>>(entries: readonly T[], now = new Date()): { key: string; label: string; entries: T[] }[] {
  const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = dayKey(now), yesterday = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const days = new Map<string, T[]>();
  for (const entry of [...entries].sort((a, b) => b.at.localeCompare(a.at))) { const key = dayKey(new Date(entry.at)); days.set(key, [...(days.get(key) ?? []), entry]); }
  return [...days].map(([key, list]) => { const date = new Date(list[0].at);
    const label = key === today ? 'Today' : key === yesterday ? 'Yesterday' : date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) }).replace(',', '');
    return { key, label, entries: list }; });
}
/** "14:05": the time of an entry, in the person's clock. */
export const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
/** What the chips of an entry point at: changed things that still exist, the Lienzo itself left out. */
export function entryTargets(entry: Pick<HistoryEntry, 'changed'>, doc: Pick<CanvasDocument, 'blocks' | 'groups' | 'links'>): { id: string; title: string }[] {
  const all = [...doc.groups, ...doc.blocks];
  return entry.changed.flatMap(id => { const found = all.find(e => e.id === id); if (found) return [{ id, title: found.title || 'Untitled' }];
    const link = (doc.links ?? []).find(l => l.id === id); const ends = link && [link.from, link.to].filter(end => all.some(e => e.id === end));
    return link && ends?.length ? [{ id: ends[0], title: link.label || 'Link' }] : []; })
    .filter((t, i, list) => list.findIndex(x => x.id === t.id) === i);
}

/**
 * Recording a shortcut in place. The new keys win; whoever held them loses them and is listed as unassigned with a
 * warning (its own override is dropped so it falls back to its default, which may be the keys it just lost).
 * Escape cancels; modifier-only presses and fixed shortcuts are ignored.
 */
export type Recorded = { overrides: Record<string, string>; displaced?: string } | null;
export function recordShortcut(defs: readonly ShortcutDef[], overrides: Overrides, id: string, combo: string | null): Recorded {
  const def = defs.find(d => d.id === id);
  if (!def || def.fixed || !combo || combo === 'escape') return null;
  const keys = normalizeCombo(combo), before = resolveShortcuts(defs, overrides), owner = before.byCombo.get(keys);
  if (owner === id) return { overrides: { ...overrides } };
  if (owner && defs.find(d => d.id === owner)?.fixed) return null;
  const next: Record<string, string> = { ...overrides };
  if (owner && Object.hasOwn(next, owner)) delete next[owner];
  delete next[id]; next[id] = keys;
  // The new override must be claimed before any other override for the same keys: object order decides.
  const ordered: Record<string, string> = { [id]: keys }; for (const [k, v] of Object.entries(next)) if (k !== id) ordered[k] = v;
  return { overrides: ordered, ...(owner ? { displaced: owner } : {}) };
}
export function resetShortcut(overrides: Overrides, id: string): Record<string, string> { const next = { ...overrides }; delete next[id]; return next; }

/** Reorders a list: the item at `index` moves by `delta`, clamped. */
export function moveItem<T>(list: readonly T[], index: number, delta: number): T[] {
  const to = Math.max(0, Math.min(list.length - 1, index + delta)), next = [...list]; if (index < 0 || index >= list.length || to === index) return next;
  const [item] = next.splice(index, 1); next.splice(to, 0, item); return next;
}

/**
 * Extension files. The pack format stays the container: `{ format: "paseo-canvas-pack", version: 1, id, name,
 * description, blockTypes: [], templates: [], documents: [], extensions }`. Every extension ID is namespaced by the
 * file's ID, as the server requires.
 */
export function extensionFile(extensions: readonly CatalogExtension[], file: { id: string; name: string; description?: string }): CanvasPack {
  const short = (id: string) => id.includes('.') ? id.slice(id.lastIndexOf('.') + 1) : id;
  return { format: 'paseo-canvas-pack', version: 1, id: file.id, name: file.name, description: file.description ?? 'Extensions for Lienzo.', blockTypes: [], templates: [], documents: [],
    extensions: extensions.map(({ source: _source, granted: _granted, ...e }) => ({ ...e, id: `${file.id}.${short(e.id)}`.slice(0, 100) })) };
}
const slug = (text: string) => fold(text).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'extension';
/** One extension as its own file. */
export const exportOne = (extension: CatalogExtension) => extensionFile([extension], { id: slug(extension.name), name: extension.name, description: extension.description || 'An extension for Lienzo.' });
/** Every extension made here (by the person or their agent) in one file, or null when there are none. */
export function exportAllMine(catalog: Pick<CanvasCatalog, 'extensions'> | null): CanvasPack | null {
  const mine = (catalog?.extensions ?? []).filter(e => e.source === 'local');
  return mine.length ? extensionFile(mine, { id: 'my-extensions', name: 'My extensions', description: 'Tools made for Lienzo.' }) : null;
}
export const fileName = (pack: Pick<CanvasPack, 'id'>) => `${pack.id}.lienzo-extensions.json`;
/** Where an installed extension came from, in words. */
export function extensionOrigin(extension: CatalogExtension, catalog: Pick<CanvasCatalog, 'packs'> | null): string {
  if (extension.source === 'local') return 'Made by you or your agent';
  if (extension.source === 'builtin') return 'Comes with Lienzo';
  const pack = catalog?.packs.find(p => p.id === extension.source);
  return `From “${pack?.name ?? extension.source}”`;
}
/** The first, local check of a chosen file. The server validates it again before anything is saved. */
export function readExtensionFile(text: string): { pack: CanvasPack } | { error: string } {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return { error: EXTENSION_MESSAGES.notJson }; }
  if (!value || typeof value !== 'object' || (value as { format?: unknown }).format !== 'paseo-canvas-pack') return { error: EXTENSION_MESSAGES.notFile };
  const pack = value as CanvasPack;
  if (!Array.isArray(pack.extensions) || !pack.extensions.length) return { error: EXTENSION_MESSAGES.empty };
  if ((pack.blockTypes?.length ?? 0) || (pack.templates?.length ?? 0) || (pack.documents?.length ?? 0)) return { error: EXTENSION_MESSAGES.legacy };
  return { pack: { ...pack, blockTypes: [], templates: [], documents: [] } };
}
export const PERMISSION_WORDS: Record<string, string> = { edit: 'Changes the canvas', network: 'Loads from the internet' };

/** The words the Extensions screen shows for a refused file. Server issues are never shown raw. */
export const EXTENSION_MESSAGES = {
  notJson: 'This file is not JSON.', notFile: 'This is not a Lienzo extension file.', empty: 'This file has no extensions.',
  legacy: 'This file carries block types, templates or documents, which Lienzo no longer imports. Only extensions.',
  taken: 'An extension in this file belongs to another file, or to the ones made here.', invalid: 'This is not a valid extension file. Check it with whoever made it.',
  large: 'This file is over 1 MB.',
} as const;
export function issueText(issues: readonly string[]): string {
  const text = issues.join(' ');
  return /extensions only/i.test(text) ? EXTENSION_MESSAGES.legacy : /no extensions/i.test(text) ? EXTENSION_MESSAGES.empty : /already belongs|namespace|nest/i.test(text) ? EXTENSION_MESSAGES.taken : /exceed|1 MiB|too large/i.test(text) ? EXTENSION_MESSAGES.large : EXTENSION_MESSAGES.invalid;
}
/** What the Extensions screen sends: the controller's RPCs and its catalog setter. */
export type ExtensionHost = {
  api: {
    catalog(input: Record<string, never>): Promise<CanvasCatalog>;
    validate(input: { pack: unknown }): Promise<{ valid: boolean; issues: string[] }>;
    import(input: { pack: unknown; expectedRevision: number; replace: boolean; dryRun: boolean }): Promise<{ catalog: CanvasCatalog; diff: ExtensionReview['diff']; committed: boolean }>;
    catalogMutate(input: { expectedRevision: number; action: { type: 'extension.remove'; id: string } | { type: 'pack.remove'; id: string } | { type: 'extension.grant'; id: string; granted: boolean } }): Promise<CanvasCatalog>;
  };
  setCatalog(catalog: CanvasCatalog): void;
};
export type ExtensionReview = { pack: CanvasPack; revision: number; diff: { added: string[]; replaced: string[]; unchanged: string[] }; installed: boolean };
/** Everything the Extensions screen does: review a file (nothing saved), install it, remove, allow. */
export function extensionActions(c: ExtensionHost) {
  const refreshCatalog = async () => { const catalog = await c.api.catalog({}); c.setCatalog(catalog); return catalog; };
  return {
    async review(text: string): Promise<ExtensionReview> {
      const read = readExtensionFile(text); if ('error' in read) throw new Error(read.error);
      const valid = await c.api.validate({ pack: read.pack }); if (!valid.valid) throw new Error(issueText(valid.issues));
      const catalog = await refreshCatalog(), installed = catalog.packs.some(p => p.id === read.pack.id);
      // A dry run never writes; replace: true shows what would change in an installed file.
      const result = await c.api.import({ pack: read.pack, expectedRevision: catalog.revision, replace: true, dryRun: true });
      return { pack: read.pack, revision: catalog.revision, diff: result.diff, installed };
    },
    async install(review: ExtensionReview, replace: boolean) {
      const result = await c.api.import({ pack: review.pack, expectedRevision: review.revision, replace, dryRun: false });
      if (result.committed) c.setCatalog(result.catalog); return result.committed;
    },
    async remove(extension: CatalogExtension) {
      const catalog = await refreshCatalog();
      c.setCatalog(await c.api.catalogMutate({ expectedRevision: catalog.revision, action: extension.source === 'local' ? { type: 'extension.remove', id: extension.id } : { type: 'pack.remove', id: extension.source } }));
    },
    async allow(extension: CatalogExtension) {
      const catalog = await refreshCatalog();
      c.setCatalog(await c.api.catalogMutate({ expectedRevision: catalog.revision, action: { type: 'extension.grant', id: extension.id, granted: true } }));
    },
  };
}
