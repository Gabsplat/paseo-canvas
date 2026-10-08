import type { Edge, Thing } from './shared';

export type Cell = { key: string; ids: string[]; title: string; areaIndex: number; depth: number; load: number };
export type StratificationModel = { layers: Cell[][]; loose: Thing[]; above: Map<string, Set<string>>; below: Map<string, Set<string>> };
/**
 * The document as ground. A thing rests on what it needs (`depends`: from rests on to) and on what came before it
 * (`flow`: to rests on from); mentions hold nothing up. Things that hold each other up in a circle are one stratum.
 * Depth is the longest way down to something that rests on nothing, so bedrock is depth 0. Load is how many other
 * things would fall if this one went. Things with no such relation lie loose on the surface.
 */
export function strataModel(all: readonly Thing[], links: readonly Edge[]): StratificationModel {
  const order = new Map(all.map((t, i) => [t.id, i])), on = new Map<string, Set<string>>(), touched = new Set<string>();
  for (const l of links) {
    if (l.kind === 'reference' || !order.has(l.from) || !order.has(l.to) || l.from === l.to) continue;
    const [upper, lower] = l.kind === 'depends' ? [l.from, l.to] : [l.to, l.from];
    (on.get(upper) ?? on.set(upper, new Set()).get(upper)!).add(lower); touched.add(upper); touched.add(lower);
  }
  const inPlay = all.filter(t => touched.has(t.id)), loose = all.filter(t => !touched.has(t.id));
  // Tarjan, iteratively: strongly connected components of "rests on".
  const index = new Map<string, number>(), low = new Map<string, number>(), stack: string[] = [], onStack = new Set<string>(), comp = new Map<string, number>(); let counter = 0, comps = 0;
  for (const root of inPlay) {
    if (index.has(root.id)) continue;
    const work: { id: string; next: string[]; i: number }[] = [{ id: root.id, next: [...(on.get(root.id) ?? [])], i: 0 }];
    index.set(root.id, counter); low.set(root.id, counter++); stack.push(root.id); onStack.add(root.id);
    while (work.length) {
      const frame = work[work.length - 1];
      if (frame.i < frame.next.length) {
        const to = frame.next[frame.i++];
        if (!index.has(to)) { index.set(to, counter); low.set(to, counter++); stack.push(to); onStack.add(to); work.push({ id: to, next: [...(on.get(to) ?? [])], i: 0 }); }
        else if (onStack.has(to)) low.set(frame.id, Math.min(low.get(frame.id)!, index.get(to)!));
      } else {
        work.pop(); if (work.length) { const parent = work[work.length - 1]; low.set(parent.id, Math.min(low.get(parent.id)!, low.get(frame.id)!)); }
        if (low.get(frame.id) === index.get(frame.id)) { let id: string; do { id = stack.pop()!; onStack.delete(id); comp.set(id, comps); } while (id !== frame.id); comps++; }
      }
    }
  }
  const members: string[][] = Array.from({ length: comps }, () => []); for (const t of inPlay) members[comp.get(t.id)!].push(t.id);
  const restsOn: Set<number>[] = Array.from({ length: comps }, () => new Set<number>());
  for (const [upper, lowers] of on) for (const lower of lowers) if (comp.get(upper) !== comp.get(lower)) restsOn[comp.get(upper)!].add(comp.get(lower)!);
  const depth: number[] = new Array(comps).fill(-1), under: Set<number>[] = Array.from({ length: comps }, () => new Set<number>());
  // Tarjan emits a component only after everything it rests on, so components are already in bottom-up order.
  for (let k = 0; k < comps; k++) { let d = 0; for (const lower of restsOn[k]) { d = Math.max(d, depth[lower] + 1); under[k].add(lower); for (const deeper of under[lower]) under[k].add(deeper); } depth[k] = d; }
  const over: Set<number>[] = Array.from({ length: comps }, () => new Set<number>()); for (let k = 0; k < comps; k++) for (const lower of under[k]) over[lower].add(k);
  const idsOf = (set: Set<number>) => new Set([...set].flatMap(k => members[k])), by = new Map(all.map(t => [t.id, t]));
  const above = new Map<string, Set<string>>(), below = new Map<string, Set<string>>(), layers: Cell[][] = [];
  for (let k = 0; k < comps; k++) {
    const up = idsOf(over[k]), down = idsOf(under[k]), first = by.get(members[k][0])!;
    for (const id of members[k]) { above.set(id, up); below.set(id, down); }
    (layers[depth[k]] ??= []).push({ key: members[k][0], ids: members[k], title: first.title + (members[k].length > 1 ? ` +${members[k].length - 1}` : ''), areaIndex: first.areaIndex, depth: depth[k], load: up.size });
  }
  for (let d = 0; d < layers.length; d++) (layers[d] ??= []).sort((a, b) => b.load - a.load || order.get(a.ids[0])! - order.get(b.ids[0])!);
  return { layers, loose, above, below };
}
