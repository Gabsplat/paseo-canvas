import type { AgentEvent, CanvasDocument } from '../shared/model';
import type { Tone } from './color';
import { agentView } from './view-models';

/** One stored change, as the history RPC returns it. The server keeps the most recent ones, not the whole life. */
export type Change = { revision: number; actor: 'user' | 'agent' | 'system'; label: string; at: string; changed: readonly string[]; removed: readonly string[]; kind: 'edit' | 'undo' | 'redo' };
export type Biography = { first: number; last: number; lastActor: 'user' | 'agent'; edits: number; byUser: number; byAgent: number };
const who = (change: Change): 'user' | 'agent' => change.actor === 'agent' ? 'agent' : 'user';
/** What the stored history says about each entity it touched. An entity absent from the map was quiet throughout. */
export function biographies(changes: readonly Change[]): Map<string, Biography> {
  const out = new Map<string, Biography>();
  for (const change of [...changes].sort((a, b) => a.revision - b.revision)) for (const id of change.changed) {
    const actor = who(change), b = out.get(id);
    if (!b) out.set(id, { first: change.revision, last: change.revision, lastActor: actor, edits: 1, byUser: actor === 'user' ? 1 : 0, byAgent: actor === 'agent' ? 1 : 0 });
    else { b.last = change.revision; b.lastActor = actor; b.edits++; if (actor === 'user') b.byUser++; else b.byAgent++; }
  }
  return out;
}
export const LENSES = ['none', 'author', 'age', 'talk', 'agent'] as const;
export type LensId = typeof LENSES[number];
export const LENS_LABEL: Record<LensId, string> = { none: 'Sin lente', author: 'Autoría', age: 'Antigüedad', talk: 'Conversación', agent: 'Lo que ve el asistente' };
export type LensKey = { key: string; label: string; tone: Tone; count: number };
type Events = readonly Pick<AgentEvent, 'status' | 'action' | 'revision'>[];
/**
 * A lens keeps every card where it is and tints it by one variable the canvas does not show: who last changed
 * it, how long it has been left alone, or whether it was ever taken up with the assistant.
 */
export function lensMarks(lens: LensId, doc: Pick<CanvasDocument, 'blocks' | 'revision'>, changes: readonly Change[], events: Events): { marks: Map<string, string>; legend: LensKey[] } {
  const marks = new Map<string, string>(); if (lens === 'none') return { marks, legend: [] };
  const lives = biographies(changes);
  const keys: Record<Exclude<LensId, 'none'>, [string, string, Tone][]> = {
    author: [['user', 'Tú', 'acento'], ['agent', 'Asistente', 'violeta'], ['quiet', 'Sin cambios recientes', 'neutro']],
    age: [['fresh', 'Recién cambiado', 'riesgo'], ['recent', 'Reciente', 'aviso'], ['settled', 'Asentado', 'turquesa'], ['quiet', 'Quieto', 'neutro']],
    talk: [['open', 'Pendiente de respuesta', 'aviso'], ['failed', 'No se entregó', 'riesgo'], ['acked', 'Atendido', 'exito'], ['never', 'Nunca conversado', 'neutro']],
    agent: [['current', 'Al día', 'exito'], ['behind', 'Lo cambiaste después', 'aviso'], ['unknown', 'Sin registro', 'neutro']],
  };
  const state = new Map<string, string>();
  if (lens === 'talk') for (const event of events) for (const id of event.action.targetIds ?? []) {
    const now = event.status === 'acked' ? 'acked' : event.status === 'failed' ? 'failed' : 'open', before = state.get(id);
    // The worst outstanding state wins: something still waiting matters more than something already answered.
    if (!before || now === 'open' || now === 'failed' && before === 'acked') state.set(id, now);
  }
  const held = lens === 'agent' ? agentView(doc, changes, events) : null;
  for (const block of doc.blocks) {
    const life = lives.get(block.id);
    if (held) { marks.set(block.id, held.get(block.id) ?? 'unknown'); continue; }
    if (lens === 'author') marks.set(block.id, life ? life.lastActor : 'quiet');
    else if (lens === 'age') { const idle = life ? doc.revision - life.last : Infinity; marks.set(block.id, idle <= 2 ? 'fresh' : idle <= 10 ? 'recent' : Number.isFinite(idle) ? 'settled' : 'quiet'); }
    else marks.set(block.id, state.get(block.id) ?? 'never');
  }
  const counts = new Map<string, number>(); marks.forEach(key => counts.set(key, (counts.get(key) ?? 0) + 1));
  return { marks, legend: keys[lens].map(([key, label, tone]) => ({ key, label, tone, count: counts.get(key) ?? 0 })) };
}

// ---- Rings: the stored history of a document seen all at once ---------------------------------------------------
export type RingMark = { id: string; ring: number; revision: number; actor: 'user' | 'agent'; undone: boolean };
export type RingSpoke = { id: string; title: string; a0: number; a1: number; sector: string };
export type RingSector = { id: string; title: string; a0: number; a1: number };
export type RingBarb = { id: string; state: 'open' | 'failed' | 'acked' };
export type RingModel = { rings: number; first: number; last: number; spokes: RingSpoke[]; sectors: RingSector[]; marks: RingMark[]; barbs: RingBarb[]; unplaced: number };
/**
 * Angle is identity and radius is time. Every block owns a bearing, ordered so that an area is a sector; every
 * stored change is ink on the bearings it touched, at the ring of its revision, in its author's colour. An undo
 * is kept as a mark of its own, never erased. Blank bearing means the block was left alone. Changes to things
 * that no longer exist, or that are not blocks, have no bearing and are only counted.
 */
export function ringModel(doc: Pick<CanvasDocument, 'blocks' | 'groups'>, changes: readonly Change[], events: Events): RingModel {
  const groups = new Map(doc.groups.map(g => [g.id, g])), nested = new Set(doc.groups.flatMap(g => g.groupIds)), titles = new Map(doc.blocks.map(b => [b.id, b.title]));
  const order: { id: string; sector: string }[] = [], sectors: { id: string; title: string; from: number; to: number }[] = [];
  const walk = (groupId: string, sector: string) => { const g = groups.get(groupId); if (!g) return; g.blockIds.forEach(id => { if (titles.has(id)) order.push({ id, sector }); }); g.groupIds.forEach(id => walk(id, sector)); };
  for (const g of doc.groups) if (!nested.has(g.id)) { const from = order.length; walk(g.id, g.id); if (order.length > from) sectors.push({ id: g.id, title: g.title, from, to: order.length }); }
  const placed = new Set(order.map(o => o.id)), loose = doc.blocks.filter(b => !placed.has(b.id));
  if (loose.length) { const from = order.length; loose.forEach(b => order.push({ id: b.id, sector: '' })); sectors.push({ id: '', title: 'Sin área', from, to: order.length }); }
  const n = Math.max(1, order.length), step = Math.PI * 2 / n, gap = Math.min(step * .12, .02), start = -Math.PI / 2;
  const spokes = order.map((o, i): RingSpoke => ({ id: o.id, title: titles.get(o.id) ?? '', a0: start + i * step + gap, a1: start + (i + 1) * step - gap, sector: o.sector }));
  const sorted = [...changes].sort((a, b) => a.revision - b.revision), marks: RingMark[] = []; let unplaced = 0;
  sorted.forEach((change, ring) => { for (const id of change.changed) { if (titles.has(id)) marks.push({ id, ring, revision: change.revision, actor: who(change), undone: change.kind === 'undo' }); else unplaced++; } unplaced += change.removed.length; });
  const state = new Map<string, RingBarb['state']>();
  for (const event of events) for (const id of event.action.targetIds ?? []) { if (!titles.has(id)) continue; const now = event.status === 'acked' ? 'acked' : event.status === 'failed' ? 'failed' : 'open', before = state.get(id); if (!before || now === 'open' || now === 'failed' && before === 'acked') state.set(id, now); }
  return { rings: sorted.length, first: sorted[0]?.revision ?? 0, last: sorted.at(-1)?.revision ?? 0, spokes, marks, unplaced,
    sectors: sectors.map(s => ({ id: s.id, title: s.title, a0: start + s.from * step, a1: start + s.to * step })), barbs: [...state].map(([id, value]) => ({ id, state: value })) };
}
const at = (cx: number, cy: number, r: number, a: number) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
/** SVG path of an arc at radius r between two angles (radians, clockwise on screen). */
export const arcPath = (cx: number, cy: number, r: number, a0: number, a1: number) => `M${at(cx, cy, r, a0)}A${r.toFixed(2)} ${r.toFixed(2)} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${at(cx, cy, r, a1)}`;
/** SVG path of the ring slice between two radii and two angles: what one block owns of the figure. */
export const wedgePath = (cx: number, cy: number, r0: number, r1: number, a0: number, a1: number) => { const big = a1 - a0 > Math.PI ? 1 : 0; return `M${at(cx, cy, r0, a0)}L${at(cx, cy, r1, a0)}A${r1.toFixed(2)} ${r1.toFixed(2)} 0 ${big} 1 ${at(cx, cy, r1, a1)}L${at(cx, cy, r0, a1)}A${r0.toFixed(2)} ${r0.toFixed(2)} 0 ${big} 0 ${at(cx, cy, r0, a0)}Z`; };
