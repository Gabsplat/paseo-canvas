import type { CanvasCatalog, CanvasDocument, CanvasLink } from '../../shared/model';
import { isDark, withAlpha } from '../color';
import { layoutCanvas } from '../logic';
import type { CanvasController } from '../useCanvas';
import type { useUI } from '../ui';

/** What every world receives: the live document through the controller, and a way back to the canvas on one thing. */
export type WorldProps = { controller: CanvasController; onOpen(id: string): void };
type Doc = Pick<CanvasDocument, 'blocks' | 'groups' | 'links'>;
/** A block, or an area that is itself the end of a link. `area` is its top-level area; `areaIndex` orders areas, -1 = none. */
export type Thing = { id: string; title: string; summary: string; area: string; areaIndex: number; group: boolean };
export type Edge = { id: string; from: string; to: string; kind: CanvasLink['kind']; label: string };

/** Everything a world can show, in reading order: area by area with nested areas in place, loose blocks, then linked areas. */
export function things(doc: Doc): Thing[] {
  const groups = new Map(doc.groups.map(g => [g.id, g])), blocks = new Map(doc.blocks.map(b => [b.id, b])), nested = new Set(doc.groups.flatMap(g => g.groupIds)), out: Thing[] = [], seen = new Set<string>();
  const text = (b: { data: Record<string, unknown> }) => String(b.data.summary ?? b.data.text ?? '');
  const tops = doc.groups.filter(g => !nested.has(g.id)), top = new Map<string, number>();
  const walk = (id: string, index: number) => { const g = groups.get(id); if (!g) return; top.set(id, index); for (const b of g.blockIds) { const block = blocks.get(b); if (block && !seen.has(b)) { seen.add(b); out.push({ id: b, title: block.title || 'Sin título', summary: text(block), area: tops[index].title || 'Área', areaIndex: index, group: false }); } } g.groupIds.forEach(child => walk(child, index)); };
  tops.forEach((g, i) => walk(g.id, i));
  for (const b of doc.blocks) if (!seen.has(b.id)) out.push({ id: b.id, title: b.title || 'Sin título', summary: text(b), area: '', areaIndex: -1, group: false });
  const ends = new Set((doc.links ?? []).flatMap(l => [l.from, l.to]));
  for (const g of doc.groups) if (ends.has(g.id)) out.push({ id: g.id, title: g.title || 'Área', summary: g.description ?? '', area: tops[top.get(g.id) ?? 0]?.title ?? '', areaIndex: top.get(g.id) ?? -1, group: true });
  return out;
}
/** Links whose two ends are both things. `from` flows to / needs / mentions `to`. */
export function edges(doc: Doc, known: readonly Thing[] = things(doc)): Edge[] {
  const ids = new Set(known.map(t => t.id));
  return (doc.links ?? []).filter(l => ids.has(l.from) && ids.has(l.to) && l.from !== l.to).map(l => ({ id: l.id, from: l.from, to: l.to, kind: l.kind, label: l.label ?? '' }));
}
/** Undirected neighbours of every thing, with the link that joins them. */
export function adjacency(all: readonly Edge[]): Map<string, { id: string; edge: Edge; out: boolean }[]> {
  const map = new Map<string, { id: string; edge: Edge; out: boolean }[]>(), add = (a: string, b: string, edge: Edge, out: boolean) => { (map.get(a) ?? map.set(a, []).get(a)!).push({ id: b, edge, out }); };
  for (const e of all) { add(e.from, e.to, e, true); add(e.to, e.from, e, false); }
  return map;
}
/** How many links away each reachable thing is from `start`, ignoring direction. Unreachable things are absent. */
export function hops(start: string, all: readonly Edge[]): Map<string, number> {
  const near = adjacency(all), out = new Map([[start, 0]]), queue = [start];
  for (let i = 0; i < queue.length; i++) for (const n of near.get(queue[i]) ?? []) if (!out.has(n.id)) { out.set(n.id, out.get(queue[i])! + 1); queue.push(n.id); }
  return out;
}
/** A number in [0, 1) fixed by a string: the only "randomness" a world may use, so a document always looks the same. */
export function seeded(text: string, salt = 0): number {
  let h = 2166136261 ^ salt; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15; return (h >>> 0) / 4294967296;
}
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Emil Kowalski's ease-out: fast to respond, gentle to land. t in [0, 1]. */
export const easeOut = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
/** Where each thing sits on the canvas (centre and size), from the same layout the canvas uses. */
export function placed(doc: CanvasDocument, catalog?: CanvasCatalog | null): Map<string, { x: number; y: number; width: number; height: number }> {
  const out = new Map<string, { x: number; y: number; width: number; height: number }>();
  for (const [id, r] of layoutCanvas(doc, {}, catalog).rects) if (!r.hidden) out.set(id, { x: r.x + r.width / 2, y: r.y + r.height / 2, width: r.width, height: r.height });
  return out;
}
/** The colours a world may use. Nothing else: form has to do the work. */
export type Palette = { dark: boolean; paper: string; surface: string; ink: string; muted: string; border: string; accent: string; flow: string; needs: string; mentions: string; ok: string; wait: string; areas: string[]; a(color: string, alpha: number): string };
export function palette(u: ReturnType<typeof useUI>): Palette {
  return { dark: isDark(u.c.surface0), paper: u.c.surface0, surface: u.c.surface1, ink: u.c.foreground, muted: u.c.foregroundMuted, border: u.c.border, accent: u.c.accent,
    flow: u.tone('acento'), needs: u.tone('violeta'), mentions: u.tone('turquesa'), ok: u.tone('exito'), wait: u.tone('aviso'),
    areas: [u.tone('acento'), u.tone('turquesa'), u.tone('violeta'), u.tone('exito'), u.tone('aviso')], a: withAlpha };
}
export const kindColor = (p: Palette, kind: Edge['kind']) => kind === 'depends' ? p.needs : kind === 'reference' ? p.mentions : p.flow;
export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
/** Text cut to a width with an ellipsis, measured with the context's current font. */
export function fit(ctx: { measureText(text: string): { width: number } }, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text; let lo = 0, hi = text.length;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ctx.measureText(text.slice(0, mid) + '…').width <= max) lo = mid; else hi = mid - 1; }
  return lo ? text.slice(0, lo).trimEnd() + '…' : '';
}
