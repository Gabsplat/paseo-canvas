import type { CanvasDocument } from './model';

/** What a person can still follow on one canvas. Past these, the report asks the author to restructure. */
export const LEGIBILITY_LIMITS = { crossAreaLinks: 12, areaNodes: 9, nodeLinks: 6, labelledLinks: 16 } as const;
export type Legibility = { links: number; crossAreaLinks: number; warnings: string[] };
type Content = Pick<CanvasDocument, 'blocks' | 'groups' | 'links'>;

/**
 * A bounded, deterministic reading of how followable a document is, returned to agents after they write.
 * It never blocks a transaction: it names the specific problem and the restructuring that removes it.
 */
export function legibility(document: Content): Legibility {
  const L = LEGIBILITY_LIMITS, links = document.links ?? [], parent = new Map<string, string | null>(), title = new Map<string, string>();
  for (const group of document.groups) { title.set(group.id, group.title); if (!parent.has(group.id)) parent.set(group.id, null); group.groupIds.forEach(id => parent.set(id, group.id)); group.blockIds.forEach(id => parent.set(id, group.id)); }
  for (const block of document.blocks) { title.set(block.id, block.title); if (!parent.has(block.id)) parent.set(block.id, block.parentGroupId ?? null); }
  const name = (id: string) => `"${(title.get(id) || id).slice(0, 40)}"`;
  // The area a link end belongs to: the group itself for a group end, the containing group for a block end.
  const groups = new Set(document.groups.map(g => g.id)), area = (id: string) => groups.has(id) ? id : parent.get(id) ?? null;
  const cross = links.filter(l => !groups.has(l.from) && !groups.has(l.to) && area(l.from) !== area(l.to)), warnings: string[] = [];
  if (cross.length > L.crossAreaLinks) {
    const pairs = new Map<string, number>(); for (const l of cross) { const key = [area(l.from) ?? '', area(l.to) ?? ''].sort().join('\u0000'); pairs.set(key, (pairs.get(key) ?? 0) + 1); }
    const [worst, count] = [...pairs].sort((a, b) => b[1] - a[1])[0], [a, b] = worst.split('\u0000');
    warnings.push(`${cross.length} links join blocks in different areas; beyond ${L.crossAreaLinks} the canvas is a tangle nobody can follow. Link the areas themselves: from/to accept group IDs, so one group-to-group link replaces many (${count} run between ${a ? name(a) : 'the root'} and ${b ? name(b) : 'the root'}). Keep block-to-block links inside one area, or split the document into one canvas per question.`);
  }
  const crowded = document.groups.map(g => ({ g, n: g.blockIds.length + g.groupIds.length })).filter(x => x.n > L.areaNodes).sort((a, b) => b.n - a.n)[0];
  if (crowded) warnings.push(`Area ${name(crowded.g.id)} holds ${crowded.n} items; keep areas to ${L.areaNodes} or fewer by splitting it or moving detail into a node's details.`);
  const degree = new Map<string, number>(); for (const l of links) for (const id of [l.from, l.to]) degree.set(id, (degree.get(id) ?? 0) + 1);
  const hub = [...degree].filter(([id, n]) => !groups.has(id) && n > L.nodeLinks).sort((a, b) => b[1] - a[1])[0];
  if (hub) warnings.push(`Node ${name(hub[0])} has ${hub[1]} links. A hub drawn as ${hub[1]} separate lines hides everything behind it: link its area once, or state the shared relation in its summary.`);
  const labelled = links.filter(l => l.label?.trim()).length;
  if (labelled > L.labelledLinks) warnings.push(`${labelled} links carry labels. Label only links whose meaning is not obvious from their two ends; use kind (flow, depends, reference) for the rest.`);
  // "from" is drawn before "to". Numbered areas that are linked high-to-low end up displayed last-to-first.
  const order = (id: string | null) => { const match = id ? /\d+/.exec(title.get(id) ?? '') : null; return match ? Number(match[0]) : null; };
  let forward = 0, backward = 0;
  for (const l of links) { const a = order(area(l.from)), b = order(area(l.to)); if (a === null || b === null || a === b) continue; if (a < b) forward++; else backward++; }
  if (backward > forward && backward >= 3) warnings.push(`Area numbering runs against the links: ${backward} links go from a higher-numbered area to a lower one, so the canvas shows the last area first and the start at the end. The "from" end is always drawn before the "to" end (above it, or to its left). Link in reading order, from where the reader starts to where they finish, or renumber the areas.`);
  return { links: links.length, crossAreaLinks: cross.length, warnings };
}
