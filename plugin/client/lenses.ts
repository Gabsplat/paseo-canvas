import type { CanvasDocument } from '../shared/model';
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
export const LENSES = ['none', 'author', 'age', 'agent'] as const;
export type LensId = typeof LENSES[number];
export const LENS_LABEL: Record<LensId, string> = { none: 'No Lente', author: 'Who changed it', age: 'How fresh', agent: 'The agent’s version' };
export type LensKey = { key: string; label: string; tone: Tone; count: number };
/**
 * A lens keeps every card where it is and tints it by one variable the canvas does not show: who last changed
 * it, how long it has been left alone, or whether the person changed it after the agent last did.
 */
export function lensMarks(lens: LensId, doc: Pick<CanvasDocument, 'blocks' | 'revision'>, changes: readonly Change[]): { marks: Map<string, string>; legend: LensKey[] } {
  const marks = new Map<string, string>(); if (lens === 'none') return { marks, legend: [] };
  const lives = biographies(changes);
  const keys: Record<Exclude<LensId, 'none'>, [string, string, Tone][]> = {
    author: [['user', 'You', 'acento'], ['agent', 'Agent', 'violeta'], ['quiet', 'No recent changes', 'neutro']],
    age: [['fresh', 'Just changed', 'riesgo'], ['recent', 'Recent', 'aviso'], ['settled', 'Settled', 'turquesa'], ['quiet', 'Still', 'neutro']],
    agent: [['current', 'As the agent left it', 'exito'], ['behind', 'You changed it since', 'aviso'], ['unknown', 'Not touched by the agent', 'neutro']],
  };
  const held = lens === 'agent' ? agentView(doc, changes) : null;
  for (const block of doc.blocks) {
    const life = lives.get(block.id);
    if (held) { marks.set(block.id, held.get(block.id) ?? 'unknown'); continue; }
    if (lens === 'author') marks.set(block.id, life ? life.lastActor : 'quiet');
    else { const idle = life ? doc.revision - life.last : Infinity; marks.set(block.id, idle <= 2 ? 'fresh' : idle <= 10 ? 'recent' : Number.isFinite(idle) ? 'settled' : 'quiet'); }
  }
  const counts = new Map<string, number>(); marks.forEach(key => counts.set(key, (counts.get(key) ?? 0) + 1));
  return { marks, legend: keys[lens].map(([key, label, tone]) => ({ key, label, tone, count: counts.get(key) ?? 0 })) };
}
/**
 * Where each block stands against the agent's last edit of it, as far as the stored history shows. The canvas never
 * tells the agent anything, so the record is the edits themselves: a block the agent changed last is as it left it,
 * a block the person changed after the agent's last edit is ahead of it, and a block the agent never edited in the
 * retained history is not claimed either way.
 */
export function agentView(doc: Pick<CanvasDocument, 'blocks'>, changes: readonly Change[]): Map<string, 'current' | 'behind' | 'unknown'> {
  const last = new Map<string, { agent: number; any: number }>();
  for (const c of [...changes].sort((a, b) => a.revision - b.revision)) for (const id of c.changed) {
    const entry = last.get(id) ?? { agent: -1, any: -1 }; entry.any = c.revision; if (c.actor === 'agent') entry.agent = c.revision; last.set(id, entry);
  }
  return new Map(doc.blocks.map(b => { const entry = last.get(b.id);
    if (!entry || entry.agent < 0) return [b.id, 'unknown'] as const;
    return [b.id, entry.any > entry.agent ? 'behind' : 'current'] as const; }));
}
