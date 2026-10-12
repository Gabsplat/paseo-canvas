import type { AgentEvent, CanvasDocument } from '../shared/model';
import type { Tone } from './color';

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
export const LENS_LABEL: Record<LensId, string> = { none: 'No Lente', author: 'Who changed it', age: 'How fresh', talk: 'Talked about', agent: 'What the agent has seen' };
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
    author: [['user', 'You', 'acento'], ['agent', 'Agent', 'violeta'], ['quiet', 'No recent changes', 'neutro']],
    age: [['fresh', 'Just changed', 'riesgo'], ['recent', 'Recent', 'aviso'], ['settled', 'Settled', 'turquesa'], ['quiet', 'Still', 'neutro']],
    talk: [['open', 'Waiting for an answer', 'aviso'], ['failed', 'Not delivered', 'riesgo'], ['acked', 'Answered', 'exito'], ['never', 'Never discussed', 'neutro']],
    agent: [['current', 'Up to date', 'exito'], ['behind', 'You changed it since', 'aviso'], ['unknown', 'No record', 'neutro']],
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
/**
 * What the agent holds of each block, as far as the stored record shows. It is up to date with a block it
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
