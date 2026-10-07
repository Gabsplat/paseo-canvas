import type { AgentEvent, CanvasDocument, CanvasLink } from '../shared/model';
import type { Change } from './lenses';

type Doc = Pick<CanvasDocument, 'blocks' | 'groups' | 'links'>;
export type Entity = { id: string; title: string; area: string; group: boolean };
/** Blocks in reading order (area by area, nested areas in place), then any area that is itself the end of a link. */
export function entityOrder(doc: Doc): Entity[] {
  const groups = new Map(doc.groups.map(g => [g.id, g])), blocks = new Map(doc.blocks.map(b => [b.id, b])), nested = new Set(doc.groups.flatMap(g => g.groupIds)), out: Entity[] = [], seen = new Set<string>();
  const walk = (id: string, area: string) => { const g = groups.get(id); if (!g) return; for (const b of g.blockIds) if (blocks.has(b) && !seen.has(b)) { seen.add(b); out.push({ id: b, title: blocks.get(b)!.title || 'Sin título', area, group: false }); } g.groupIds.forEach(child => walk(child, area)); };
  for (const g of doc.groups) if (!nested.has(g.id)) walk(g.id, g.title || 'Área');
  for (const b of doc.blocks) if (!seen.has(b.id)) out.push({ id: b.id, title: b.title || 'Sin título', area: '', group: false });
  const ends = new Set((doc.links ?? []).flatMap(l => [l.from, l.to]));
  for (const g of doc.groups) if (ends.has(g.id)) out.push({ id: g.id, title: g.title || 'Área', area: 'Áreas', group: true });
  return out;
}
export type Neighbour = { id: string; title: string; label: string; linkId: string };
export type Focus = { needs: Neighbour[]; neededBy: Neighbour[]; before: Neighbour[]; after: Neighbour[]; mentions: Neighbour[] };
/**
 * One thing in the middle and its world around it by the kind of each link: what it needs, what needs it, what
 * comes before and after in a flow, and what it merely mentions or is mentioned by. `from` needs `to`; `from` flows to `to`.
 */
export function focusOf(doc: Doc, id: string): Focus {
  const title = new Map([...doc.blocks, ...doc.groups].map(e => [e.id, e.title || 'Sin título'])), out: Focus = { needs: [], neededBy: [], before: [], after: [], mentions: [] };
  for (const link of doc.links ?? []) {
    if (link.from !== id && link.to !== id) continue; const outgoing = link.from === id, other = outgoing ? link.to : link.from; if (!title.has(other)) continue;
    const n = { id: other, title: title.get(other)!, label: link.label ?? '', linkId: link.id };
    if (link.kind === 'depends') (outgoing ? out.needs : out.neededBy).push(n); else if (link.kind === 'reference') out.mentions.push(n); else (outgoing ? out.after : out.before).push(n);
  }
  return out;
}
export type Reading = { key: string; kind: 'flow' | 'depends'; steps: { id: string; via: string }[] };
/**
 * Readings are the paths the links already spell out: every way to walk the flow from a start to an end, and every
 * chain of needs from a thing down to what it finally rests on. The same cards, read along a different line.
 * Bounded: at most `limit` readings per kind, cycles cut where they close.
 */
export function readings(doc: Doc, limit = 12, maxSteps = 40): Reading[] {
  const known = new Set([...doc.blocks, ...doc.groups].map(e => e.id)), out: Reading[] = [];
  for (const kind of ['flow', 'depends'] as const) {
    const links = (doc.links ?? []).filter(l => l.kind === kind && known.has(l.from) && known.has(l.to)), next = new Map<string, CanvasLink[]>(), incoming = new Set<string>();
    for (const l of links) { (next.get(l.from) ?? next.set(l.from, []).get(l.from)!).push(l); incoming.add(l.to); }
    const starts = [...next.keys()].filter(id => !incoming.has(id)), roots = starts.length ? starts : [...next.keys()].slice(0, 1); let made = 0;
    const walk = (path: { id: string; via: string }[], on: Set<string>) => {
      if (made >= limit) return; const here = path.at(-1)!.id, onward = (next.get(here) ?? []).filter(l => !on.has(l.to));
      if (!onward.length || path.length >= maxSteps) { if (path.length > 1) { out.push({ key: `${kind}:${path.map(s => s.id).join('>')}`, kind, steps: path }); made++; } return; }
      for (const l of onward) { on.add(l.to); walk([...path, { id: l.to, via: l.label ?? '' }], on); on.delete(l.to); }
    };
    for (const root of roots) walk([{ id: root, via: '' }], new Set([root]));
  }
  return out;
}
export type MatrixCell = { row: number; col: number; kind: CanvasLink['kind']; label: string; linkId: string };
/** Every link as a cell at (from, to) over the reading order, so coupling shows as distance from the diagonal. */
export function matrixOf(doc: Doc): { order: Entity[]; cells: MatrixCell[]; areas: { title: string; from: number; to: number }[] } {
  const order = entityOrder(doc), index = new Map(order.map((e, i) => [e.id, i])), areas: { title: string; from: number; to: number }[] = [];
  order.forEach((e, i) => { const last = areas.at(-1); if (last && last.title === e.area) last.to = i + 1; else areas.push({ title: e.area, from: i, to: i + 1 }); });
  const cells = (doc.links ?? []).flatMap((l): MatrixCell[] => index.has(l.from) && index.has(l.to) ? [{ row: index.get(l.from)!, col: index.get(l.to)!, kind: l.kind, label: l.label ?? '', linkId: l.id }] : []);
  return { order, cells, areas };
}
export type StreamItem = { key: string; at: string; who: 'user' | 'agent'; what: 'change' | 'undo' | 'redo' | 'request'; label: string; revision?: number; ids: string[]; state?: AgentEvent['status'] };
/** History and requests as one river, newest first, with what is still waiting pulled out ahead of it. */
export function streamOf(doc: Pick<CanvasDocument, 'blocks' | 'groups'>, changes: readonly Change[], events: readonly Pick<AgentEvent, 'id' | 'createdAt' | 'status' | 'action' | 'revision'>[]): { waiting: StreamItem[]; items: StreamItem[] } {
  const known = new Set([...doc.blocks, ...doc.groups].map(e => e.id));
  const items: StreamItem[] = [
    ...changes.map((c): StreamItem => ({ key: `r${c.revision}`, at: c.at, who: c.actor === 'agent' ? 'agent' : 'user', what: c.kind === 'edit' ? 'change' : c.kind, label: c.label || 'Cambio', revision: c.revision, ids: c.changed.filter(id => known.has(id)) })),
    ...events.map((e): StreamItem => ({ key: `e${e.id}`, at: e.createdAt, who: 'user', what: 'request', label: e.action.label || e.action.kind, revision: e.revision, ids: (e.action.targetIds ?? []).filter(id => known.has(id)), state: e.status })),
  ].sort((a, b) => a.at < b.at ? 1 : a.at > b.at ? -1 : (b.revision ?? 0) - (a.revision ?? 0));
  return { waiting: items.filter(item => item.what === 'request' && item.state !== 'acked'), items };
}
/**
 * What the assistant holds of each block, as far as the stored record shows. It is up to date with a block it
 * changed last, or whose current state it acknowledged in a request. It is behind on a block the person changed
 * afterwards. Where the record says nothing, nothing is claimed.
 */
export function agentView(doc: Pick<CanvasDocument, 'blocks'>, changes: readonly Change[], events: readonly Pick<AgentEvent, 'status' | 'action' | 'revision'>[]): Map<string, 'current' | 'behind' | 'unknown'> {
  const last = new Map<string, { revision: number; agent: boolean }>(), acked = new Map<string, number>();
  for (const c of [...changes].sort((a, b) => a.revision - b.revision)) for (const id of c.changed) last.set(id, { revision: c.revision, agent: c.actor === 'agent' });
  for (const e of events) if (e.status === 'acked') for (const id of e.action.targetIds ?? []) acked.set(id, Math.max(acked.get(id) ?? -1, e.revision));
  return new Map(doc.blocks.map(b => { const change = last.get(b.id), seen = acked.get(b.id);
    if (change?.agent) return [b.id, 'current'] as const; if (change) return [b.id, seen !== undefined && seen >= change.revision ? 'current' : 'behind'] as const;
    return [b.id, seen !== undefined ? 'current' : 'unknown'] as const; }));
}
