import type { CanvasDocument, CanvasBlock, CanvasGroup, CanvasLink, CanvasOperation, DiagramData, DocumentContent, CanvasCatalog, CanvasPack, BlockType } from '../shared/model';
import { tokens } from './tokens';
export type Entity = CanvasBlock | CanvasGroup;
export type Point = { x: number; y: number };
export type Rect = Point & { width: number; height: number; depth: number; hidden: boolean };
export function initialCamera(viewportWidth: number, content: Pick<Rect, 'x' | 'y' | 'width'>) {
  const t = tokens.canvas.initialZoom, scale = Math.max(t.min, Math.min(t.max, (viewportWidth - 96) / Math.max(1, content.width)));
  const left = content.width * scale > viewportWidth - 96 ? 48 : (viewportWidth - content.width * scale) / 2;
  return { scale, offset: { x: left - content.x * scale, y: t.topInset - content.y * scale } };
}
export const snap = (v: number) => Math.round(v / tokens.canvas.snap) * tokens.canvas.snap;
let counter = 0;
export const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${(++counter).toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
export function propertyValue(kind: BlockType['properties'][number]['kind'], raw: unknown): CanvasBlock['data'][string] {
  if (kind === 'boolean') { if (typeof raw === 'boolean') return raw; if (raw === 'true') return true; if (raw === 'false') return false; throw new Error('Se esperaba Sí o No.'); }
  if (kind === 'number') { if (raw === '' || typeof raw === 'string' && !raw.trim()) throw new Error('Número no válido'); const n = Number(raw); if (!Number.isFinite(n)) throw new Error('Número no válido'); return n; }
  if (kind === 'json') { try { return typeof raw === 'string' ? JSON.parse(raw) : raw as CanvasBlock['data'][string]; } catch { throw new Error('JSON no válido'); } }
  return String(raw ?? '');
}
export function forkPack(source: CanvasPack, id = newId('pack')): CanvasPack {
  const types = new Map(source.blockTypes.map((t, i) => [t.id, `${id}.type${i}`])), templates = new Map(source.templates.map((t, i) => [t.id, `${id}.template${i}`]));
  const block = (b: CanvasBlock) => ({ ...b, typeId: types.get(b.typeId) ?? b.typeId });
  const group = (g: CanvasGroup) => ({ ...g, templateId: g.templateId ? templates.get(g.templateId) : undefined });
  return { ...source, id, name: `${source.name} · copia portable`, blockTypes: source.blockTypes.map(t => ({ ...t, id: types.get(t.id)! })), templates: source.templates.map(t => ({ ...t, id: templates.get(t.id)!, blocks: t.blocks.map(block), groups: t.groups.map(group) })), documents: source.documents.map(d => ({ ...d, blocks: d.blocks.map(block), groups: d.groups.map(group) })) };
}
export function selectionPack(doc: CanvasDocument, catalog: CanvasCatalog, ids: string[]): CanvasPack {
  const included = new Set(ids);
  const add = (id: string) => { included.add(id); const g = doc.groups.find(g => g.id === id); if (g) [...g.blockIds, ...g.groupIds].forEach(add); };
  ids.forEach(add);
  const content = documentContent(doc);
  content.blocks = doc.blocks.filter(b => included.has(b.id)).map(b => ({ ...b, parentGroupId: b.parentGroupId && included.has(b.parentGroupId) ? b.parentGroupId : null }));
  content.groups = doc.groups.filter(g => included.has(g.id)).map(g => ({ ...g, parentGroupId: g.parentGroupId && included.has(g.parentGroupId) ? g.parentGroupId : null, blockIds: g.blockIds.filter(id => included.has(id)), groupIds: g.groupIds.filter(id => included.has(id)) }));
  content.links = (doc.links ?? []).filter(l => included.has(l.from) && included.has(l.to));
  content.selectedIds = [];
  return forkPack({ format: 'paseo-canvas-pack', version: 1, id: 'selection', name: `Selección de ${doc.title}`, description: doc.description, blockTypes: catalog.blockTypes.filter(t => content.blocks.some(b => b.typeId === t.id)), templates: [], documents: [content] });
}
export function safeUrl(input: unknown): string | null {
  if (typeof input !== 'string' || !/^https?:\/\//i.test(input)) return null;
  try { const u = new URL(input); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? u.href : null; } catch { return null; }
}
export function topSelection(doc: CanvasDocument, ids = doc.selectedIds): Entity[] {
  const all = [...doc.groups, ...doc.blocks];
  return all.filter(e => ids.includes(e.id) && !ancestors(doc, e).some(a => ids.includes(a.id)));
}
export function ancestors(doc: CanvasDocument, entity: Entity): CanvasGroup[] {
  const result: CanvasGroup[] = []; const visited = new Set<string>();
  let parent = entity.parentGroupId;
  while (parent && !visited.has(parent)) {
    visited.add(parent); const g = doc.groups.find(g => g.id === parent); if (!g) break;
    result.push(g); parent = g.parentGroupId;
  }
  return result;
}
export function hasCommunication(value?: CanvasBlock['communication']): value is NonNullable<CanvasBlock['communication']> {
  return !!value && [value.intent, value.audience, value.instructions].some(text => text.trim().length > 0);
}
export function instructionLevels(doc: CanvasDocument, entity?: Entity) {
  return [...(entity ? [entity, ...ancestors(doc, entity)] : []), { id: doc.id, title: doc.title, communication: doc.communication }]
    .filter(e => hasCommunication(e.communication)).map(e => ({ id: e.id, title: e.title, communication: e.communication! }));
}
export function documentContent(doc: CanvasDocument, own = false): DocumentContent {
  const { title, description, blocks, groups, links, layout, selectedIds, communication, example } = doc;
  return { title: own ? `${title} · copia` : title, description, blocks, groups, links: links ?? [], ...(layout ? { layout } : {}), selectedIds, communication, example: own ? false : example };
}
export type Segment = { from: Point; to: Point };
export function diagramLayout(data: DiagramData, innerWidth = 565) {
  const d = tokens.diagram, w = d.node.width, h = d.node.height, back = new Set<string>(), visited = new Set<string>(), visiting = new Set<string>();
  const labeled = data.edges.some(edge => !!edge.label), gapY = labeled ? d.gapYLabeled : d.gapY;
  const visit = (id: string) => {
    visited.add(id); visiting.add(id);
    for (const e of data.edges.filter(e => e.from === id)) {
      if (visiting.has(e.to)) back.add(e.id); else if (!visited.has(e.to)) visit(e.to);
    }
    visiting.delete(id);
  };
  data.nodes.forEach(n => { if (!visited.has(n.id)) visit(n.id); });
  const layers = new Map<string, number>();
  const layer = (id: string): number => {
    if (layers.has(id)) return layers.get(id)!;
    const predecessors = data.edges.filter(e => e.to === id && !back.has(e.id));
    const n = predecessors.length ? 1 + Math.max(...predecessors.map(e => layer(e.from))) : 0; layers.set(id, n); return n;
  };
  data.nodes.forEach(n => layer(n.id));
  const explicit = data.nodes.length > 0 && data.nodes.every(n => n.position);
  const railSpace = d.rail.inset + d.rail.maxLanes * d.rail.laneGap;
  function place(left = 0, right = 0) {
    const rows = new Map<string, number>(), points = new Map<string, Point>();
    if (explicit) {
      const minX = Math.min(...data.nodes.map(n => n.position!.x)), minY = Math.min(...data.nodes.map(n => n.position!.y));
      data.nodes.forEach(n => points.set(n.id, { x: n.position!.x - minX + d.padding + left, y: n.position!.y - minY + d.padding }));
    } else {
      const width = Math.max(w, innerWidth - left - right), cols = Math.min(d.maxColumns.wide, Math.max(1, Math.floor((width + d.gapX) / (w + d.gapX))));
      let row = 0;
      for (let l = 0; l <= Math.max(0, ...layers.values()); l++) {
        const group = data.nodes.filter(n => layers.get(n.id) === l);
        for (let i = 0; i < group.length; i += cols) {
          const nodes = group.slice(i, i + cols);
          nodes.forEach((n, j) => { rows.set(n.id, row); points.set(n.id, { x: left + (width - (nodes.length * w + (nodes.length - 1) * d.gapX)) / 2 + j * (w + d.gapX), y: d.padding + row * (h + gapY) }); }); row++;
        }
      }
    }
    return { rows, points };
  }
  let placed = place();
  const hasLeft = data.edges.some(e => e.from !== e.to && (back.has(e.id) || placed.points.get(e.to)!.y < placed.points.get(e.from)!.y));
  const hasRight = !explicit && data.edges.some(e => !back.has(e.id) && (placed.rows.get(e.to)! - placed.rows.get(e.from)!) > 1);
  placed = place(hasLeft ? railSpace : 0, hasRight ? railSpace : 0);
  const nodes = data.nodes.map(n => ({ ...n, ...placed.points.get(n.id)!, width: w, height: h }));
  const byId = new Map(nodes.map(n => [n.id, n])), left = nodes.length ? Math.min(...nodes.map(n => n.x)) : d.padding, right = Math.max(w, ...nodes.map(n => n.x + w));
  let leftLane = 0, rightLane = 0;
  const edges = data.edges.filter(e => e.from !== e.to).map((e, i) => {
    const a = byId.get(e.from)!, b = byId.get(e.to)!;
    const backwards = back.has(e.id) || b.y < a.y;
    let points: Point[];
    const nextRow = !backwards && (explicit ? b.y >= a.y + h + 16 : placed.rows.get(e.to)! - placed.rows.get(e.from)! === 1);
    if (nextRow) {
      const mid = a.y + h + (labeled ? d.edgeLabel.nextRowOffsets.run : gapY / 2);
      points = [{ x: a.x + w / 2, y: a.y + h }, { x: a.x + w / 2, y: mid }, { x: b.x + w / 2, y: mid }, { x: b.x + w / 2, y: b.y }];
    } else if (!backwards && a.y === b.y) {
      const goesRight = b.x > a.x;
      points = [{ x: a.x + (goesRight ? w : 0), y: a.y + h / 2 }, { x: b.x + (goesRight ? 0 : w), y: b.y + h / 2 }];
    } else {
      const lane = (backwards ? leftLane++ : rightLane++) % d.rail.maxLanes, x = backwards ? left - d.rail.inset - lane * d.rail.laneGap : right + d.rail.inset + lane * d.rail.laneGap;
      points = [{ x: a.x + (backwards ? 0 : w), y: a.y + h / 2 }, { x, y: a.y + h / 2 }, { x, y: b.y + h / 2 }, { x: b.x + (backwards ? 0 : w), y: b.y + h / 2 }];
    }
    const segments = points.slice(1).map((to, j) => ({ from: points[j], to })).filter(s => s.from.x !== s.to.x || s.from.y !== s.to.y);
    const horizontals = segments.filter(s => s.from.y === s.to.y).sort((a, b) => Math.abs(b.to.x - b.from.x) - Math.abs(a.to.x - a.from.x));
    const labelSegment = horizontals[0] ?? segments[0];
    return { ...e, dashed: backwards, segments, end: points.at(-1)!, direction: points.at(-1)!.y > points.at(-2)!.y ? 'down' : points.at(-1)!.y < points.at(-2)!.y ? 'up' : points.at(-1)!.x > points.at(-2)!.x ? 'right' : 'left', labelWidth: nextRow ? d.edgeLabel.maxWidthNextRow : d.edgeLabel.maxWidth, labelPoint: nextRow ? { x: b.x + w / 2, y: a.y + h + d.edgeLabel.nextRowOffsets.labelCenter } : { x: (labelSegment.from.x + labelSegment.to.x) / 2 + (horizontals.length ? 0 : 6), y: (labelSegment.from.y + labelSegment.to.y) / 2 } };
  });
  return { nodes, edges, width: Math.max(innerWidth, right + (hasRight ? railSpace : d.padding)), height: Math.max(96, ...nodes.map(n => n.y + h + d.padding)), list: innerWidth < d.listFallback.whenInnerWidthBelow || nodes.length > d.listFallback.whenNodesAbove };
}
export const descriptionKey = (groupId: string) => `${groupId}#description`;
type Box = Pick<Rect, 'x' | 'y' | 'width' | 'height'>;
// Stored positions carry no size, so whoever wrote them (a person, an agent, a template) could not know how large the
// neighbours would measure. Once real sizes are known, siblings that intersect are pushed apart: the one nearer the
// origin keeps its place and the other moves right or down, whichever is shorter. Siblings that do not touch are never
// moved, and nothing is persisted.
// `anchored` boxes are settled first, so what a person placed by hand displaces what the layout placed, not the reverse.
export function resolveOverlaps(boxes: Box[], gap: number, anchored?: Set<Box>): void {
  const up = (v: number) => Math.ceil(v / tokens.canvas.snap) * tokens.canvas.snap;
  const rank = (box: Box) => anchored && !anchored.has(box) ? 1 : 0;
  const order = boxes.map((box, index) => ({ box, index })).sort((a, b) => rank(a.box) - rank(b.box) || (a.box.x + a.box.y) - (b.box.x + b.box.y) || a.box.y - b.box.y || a.index - b.index);
  const placed: Box[] = [];
  for (const { box } of order) {
    // Each push clears one placed box for good (moves only go right or down), so this ends within placed.length steps.
    for (let step = 0; step <= placed.length; step++) {
      const hit = placed.find(p => box.x < p.x + p.width && p.x < box.x + box.width && box.y < p.y + p.height && p.y < box.y + box.height);
      if (!hit) break;
      const dx = hit.x + hit.width + gap - box.x, dy = hit.y + hit.height + gap - box.y;
      if (dx <= dy) box.x = up(box.x + dx); else box.y = up(box.y + dy);
    }
    placed.push(box);
  }
}
// ---- Graph canvas (docs/architecture.md §13). Everything below is pure: sizes in, rectangles and paths out. ----
export type LinkKind = CanvasLink['kind'];
/** `rows` is the client-only default for a group of groups; it is never persisted. */
export type LayoutMode = NonNullable<CanvasGroup['layout']>['mode'] | 'rows';
export type Direction = 'down' | 'right';
const ROOT = '';
type Edge = { from: string; to: string };
/** Membership, the links lifted to the container whose direct children they join, and each container's effective mode. */
export function graphIndex(doc: CanvasDocument, catalog?: CanvasCatalog | null) {
  const groups = new Map(doc.groups.map(g => [g.id, g])), entities = new Map<string, Entity>([...doc.blocks, ...doc.groups].map(e => [e.id, e]));
  const parent = new Map<string, string>();
  for (const e of entities.values()) parent.set(e.id, e.parentGroupId ?? ROOT);
  for (const g of doc.groups) for (const id of [...g.blockIds, ...g.groupIds]) if (entities.has(id)) parent.set(id, g.id);
  const chain = (id: string): string[] => { const out = [id], seen = new Set(out); let p = parent.get(id); while (p && !seen.has(p)) { out.push(p); seen.add(p); p = parent.get(p); } out.push(ROOT); return out; };
  const edges = new Map<string, Edge[]>();
  for (const link of doc.links ?? []) {
    if (link.from === link.to || !entities.has(link.from) || !entities.has(link.to)) continue;
    const a = chain(link.from), b = chain(link.to), inA = new Map(a.map((id, i) => [id, i]));
    const j = b.findIndex(id => inA.has(id)), i = inA.get(b[j])!;
    if (i === 0 || j === 0) continue; // one endpoint contains the other: nothing to arrange
    const list = edges.get(b[j]) ?? []; list.push({ from: a[i - 1], to: b[j - 1] }); edges.set(b[j], list);
  }
  const mode = (id: string | null): LayoutMode => {
    if (!id) return doc.layout?.mode ?? (edges.has(ROOT) ? 'graph' : 'free');
    const g = groups.get(id); if (!g) return 'stack';
    const children = [...g.blockIds, ...g.groupIds];
    // Prose reads best as a column. Sections and compact node cards read best side by side.
    const spread = children.length > 1 && (g.groupIds.length > 0 || children.every(child => { const e = entities.get(child); return !!e && 'typeId' in e && isNodeBlock(e, catalog); }));
    return g.layout?.mode ?? (edges.has(id) ? 'graph' : children.some(child => entities.get(child)?.position) ? 'free' : spread ? 'rows' : 'stack');
  };
  const direction = (id: string | null): Direction => (id ? groups.get(id)?.layout : doc.layout)?.direction ?? 'down';
  return { groups, entities, parent, chain, edges: (id: string | null) => edges.get(id ?? ROOT) ?? [], mode, direction };
}
export type GraphIndex = ReturnType<typeof graphIndex>;
export const containerMode = (doc: CanvasDocument, id: string | null, catalog?: CanvasCatalog | null) => graphIndex(doc, catalog).mode(id);
/** A container where people place things by hand: dragging stores a position that the layout then respects. */
export const freeform = (mode: LayoutMode) => mode === 'free' || mode === 'graph';
export const isNodeBlock = (block: CanvasBlock, catalog?: CanvasCatalog | null) => (catalog?.blockTypes.find(t => t.id === block.typeId)?.renderer ?? (block.typeId === 'node' ? 'node' : undefined)) === 'node';

type Sized = { id: string; width: number; height: number };
/**
 * Layered ("Sugiyama") placement, top to bottom: cycles are broken on DFS back edges, layers come from the longest
 * path, order inside a layer from barycentre sweeps that keep the best crossing count, and x from averaging towards
 * neighbours. Edges that skip layers reserve a lane, returned as waypoints so connectors go around cards.
 * Deterministic: the only inputs are the order of `nodes`, the order of `edges` and the sizes.
 */
export function layeredLayout(nodes: Sized[], edges: Edge[], options: { direction?: Direction; nodeGap: number; layerGap: number; laneWidth?: number }) {
  const right = options.direction === 'right', lane = options.laneWidth ?? 20;
  const size = new Map(nodes.map(n => [n.id, right ? { w: n.height, h: n.width } : { w: n.width, h: n.height }]));
  const order = new Map(nodes.map((n, i) => [n.id, i])), seen = new Set<string>(), unique: Edge[] = [];
  for (const e of edges) { const key = `${e.from}>${e.to}`; if (e.from === e.to || !order.has(e.from) || !order.has(e.to) || seen.has(key)) continue; seen.add(key); unique.push(e); }
  const out = new Map<string, string[]>(nodes.map(n => [n.id, []]));
  unique.forEach(e => out.get(e.from)!.push(e.to));
  // Iterative DFS: an edge into a node that is still open closes a cycle and is reversed for layering.
  const state = new Map<string, number>(), back = new Set<string>();
  for (const n of nodes) {
    if (state.has(n.id)) continue;
    const stack: { id: string; next: number }[] = [{ id: n.id, next: 0 }]; state.set(n.id, 1);
    while (stack.length) {
      const top = stack[stack.length - 1], targets = out.get(top.id)!;
      if (top.next >= targets.length) { state.set(top.id, 2); stack.pop(); continue; }
      const to = targets[top.next++];
      if (state.get(to) === 1) back.add(`${top.id}>${to}`); else if (!state.has(to)) { state.set(to, 1); stack.push({ id: to, next: 0 }); }
    }
  }
  const dagSeen = new Set<string>(), dag: Edge[] = [];
  for (const e of unique) { const d = back.has(`${e.from}>${e.to}`) ? { from: e.to, to: e.from } : e, key = `${d.from}>${d.to}`; if (!dagSeen.has(key)) { dagSeen.add(key); dag.push(d); } }
  const preds = new Map<string, string[]>(nodes.map(n => [n.id, []])), succs = new Map<string, string[]>(nodes.map(n => [n.id, []]));
  dag.forEach(e => { preds.get(e.to)!.push(e.from); succs.get(e.from)!.push(e.to); });
  const indegree = new Map(nodes.map(n => [n.id, preds.get(n.id)!.length])), queue = nodes.filter(n => !indegree.get(n.id)).map(n => n.id), topo: string[] = [], layer = new Map<string, number>();
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]; topo.push(id); layer.set(id, Math.max(0, ...preds.get(id)!.map(p => layer.get(p)! + 1)));
    for (const to of succs.get(id)!) { indegree.set(to, indegree.get(to)! - 1); if (!indegree.get(to)) queue.push(to); }
  }
  // A source sits right above its nearest target instead of at the very top, which keeps its edges short.
  for (const id of [...topo].reverse()) if (!preds.get(id)!.length && succs.get(id)!.length) layer.set(id, Math.min(...succs.get(id)!.map(s => layer.get(s)!)) - 1);
  const layers: string[][] = []; let dummies = 0;
  const span = dag.reduce((sum, e) => sum + Math.max(0, layer.get(e.to)! - layer.get(e.from)! - 1), 0), useLanes = span <= 400;
  for (const id of topo) (layers[layer.get(id)!] ??= []).push(id);
  for (let l = 0; l < layers.length; l++) (layers[l] ??= []).sort((a, b) => order.get(a)! - order.get(b)!);
  const up = new Map<string, string[]>(), down = new Map<string, string[]>(), chains = new Map<string, string[]>();
  const join = (a: string, b: string) => { (down.get(a) ?? down.set(a, []).get(a)!).push(b); (up.get(b) ?? up.set(b, []).get(b)!).push(a); };
  for (const e of dag) {
    const from = layer.get(e.from)!, to = layer.get(e.to)!;
    if (to - from <= 1 || !useLanes) { join(e.from, e.to); continue; }
    const ids: string[] = []; let previous = e.from;
    for (let l = from + 1; l < to; l++) { const id = `\u0000${dummies++}`; size.set(id, { w: lane, h: 0 }); layer.set(id, l); layers[l].push(id); join(previous, id); ids.push(id); previous = id; }
    join(previous, e.to); chains.set(`${e.from}>${e.to}`, ids);
  }
  const segments = [...down].flatMap(([a, list]) => list.map(b => [a, b] as const));
  const crossings = () => {
    const at = new Map<string, number>(); layers.forEach(ids => ids.forEach((id, i) => at.set(id, i)));
    let total = 0;
    for (let l = 0; l < layers.length - 1; l++) {
      const pairs = layers[l].flatMap(a => (down.get(a) ?? []).map(b => [at.get(a)!, at.get(b)!] as const));
      for (let i = 0; i < pairs.length; i++) for (let j = i + 1; j < pairs.length; j++) if ((pairs[i][0] - pairs[j][0]) * (pairs[i][1] - pairs[j][1]) < 0) total++;
    }
    return total;
  };
  const sweep = (l: number, neighbours: Map<string, string[]>, reference: string[]) => {
    const at = new Map(reference.map((id, i) => [id, i])), current = new Map(layers[l].map((id, i) => [id, i]));
    const weight = (id: string) => { const list = (neighbours.get(id) ?? []).filter(n => at.has(n)); return list.length ? list.reduce((sum, n) => sum + at.get(n)!, 0) / list.length : current.get(id)! * (reference.length / Math.max(1, layers[l].length)); };
    const weights = new Map(layers[l].map(id => [id, weight(id)]));
    layers[l] = [...layers[l]].sort((a, b) => weights.get(a)! - weights.get(b)! || current.get(a)! - current.get(b)!);
  };
  const countable = segments.length <= 600;
  let best = layers.map(ids => [...ids]), bestCrossings = countable ? crossings() : 0;
  for (let round = 0; round < 6 && (bestCrossings > 0 || !countable); round++) {
    for (let l = 1; l < layers.length; l++) sweep(l, up, layers[l - 1]);
    for (let l = layers.length - 2; l >= 0; l--) sweep(l, down, layers[l + 1]);
    if (!countable) { best = layers.map(ids => [...ids]); continue; }
    const now = crossings(); if (now < bestCrossings) { bestCrossings = now; best = layers.map(ids => [...ids]); }
  }
  best.forEach((ids, l) => { layers[l] = ids; });
  // Horizontal placement. Two valid packings (pushed from the left, pulled from the right) average into a valid one.
  const x = new Map<string, number>(), gapAfter = (a: string, b: string) => size.get(a)!.h === 0 && size.get(b)!.h === 0 ? lane / 2 : size.get(a)!.h === 0 || size.get(b)!.h === 0 ? options.nodeGap / 2 : options.nodeGap;
  const widthOf = (ids: string[]) => ids.reduce((sum, id, i) => sum + size.get(id)!.w + (i ? gapAfter(ids[i - 1], id) : 0), 0), widest = Math.max(0, ...layers.map(widthOf));
  layers.forEach(ids => { let cursor = (widest - widthOf(ids)) / 2; ids.forEach((id, i) => { if (i) cursor += gapAfter(ids[i - 1], id); x.set(id, cursor); cursor += size.get(id)!.w; }); });
  const settle = (ids: string[], wanted: number[]) => {
    const left: number[] = [], rightward: number[] = [];
    ids.forEach((id, i) => { left[i] = i ? Math.max(wanted[i], left[i - 1] + size.get(ids[i - 1])!.w + gapAfter(ids[i - 1], id)) : wanted[i]; });
    for (let i = ids.length - 1; i >= 0; i--) rightward[i] = i === ids.length - 1 ? wanted[i] : Math.min(wanted[i], rightward[i + 1] - size.get(ids[i])!.w - gapAfter(ids[i], ids[i + 1]));
    ids.forEach((id, i) => x.set(id, (left[i] + rightward[i]) / 2));
  };
  const centre = (id: string) => x.get(id)! + size.get(id)!.w / 2;
  const pull = (ids: string[], sources: Map<string, string[]>[]) => settle(ids, ids.map(id => { const list = sources.flatMap(s => s.get(id) ?? []); return list.length ? list.reduce((sum, n) => sum + centre(n), 0) / list.length - size.get(id)!.w / 2 : x.get(id)!; }));
  for (let round = 0; round < 4; round++) {
    for (let l = 1; l < layers.length; l++) pull(layers[l], [up]);
    for (let l = layers.length - 2; l >= 0; l--) pull(layers[l], [down]);
  }
  layers.forEach(ids => pull(ids, [up, down]));
  const minX = Math.min(0, ...[...x.values()]);
  layers.forEach(ids => { let floor = -Infinity; ids.forEach((id, i) => { const value = Math.max(Math.round(x.get(id)! - minX), i ? floor + gapAfter(ids[i - 1], id) : -Infinity); x.set(id, value); floor = value + size.get(id)!.w; }); });
  const tops: number[] = [], heights = layers.map(ids => Math.max(0, ...ids.map(id => size.get(id)!.h)));
  heights.forEach((h, l) => { tops[l] = l ? tops[l - 1] + heights[l - 1] + options.layerGap : 0; });
  const flip = (p: Point): Point => right ? { x: p.y, y: p.x } : p;
  const points = new Map<string, Point>(nodes.map(n => [n.id, flip({ x: x.get(n.id)!, y: tops[layer.get(n.id)!] })]));
  // Waypoints run in the direction of the stored edge; a lane crosses its layer band in a straight line.
  const lanes = new Map<string, Point[]>();
  for (const [key, ids] of chains) {
    const path = ids.flatMap(id => { const cx = x.get(id)! + lane / 2, l = layer.get(id)!; return [flip({ x: cx, y: tops[l] }), flip({ x: cx, y: tops[l] + heights[l] })]; });
    const [from, to] = key.split('>');
    if (seen.has(key)) lanes.set(key, path);
    if (seen.has(`${to}>${from}`)) lanes.set(`${to}>${from}`, [...path].reverse());
  }
  const across = Math.max(0, ...[...x].map(([id, value]) => value + size.get(id)!.w)), along = tops.length ? tops[tops.length - 1] + heights[heights.length - 1] : 0;
  return { points, lanes, layers: new Map(nodes.map(n => [n.id, layer.get(n.id)!])), width: right ? along : across, height: right ? across : along };
}
function packRows(rects: Box[], x: number, y: number, wrap: number, gap: number): void {
  let cx = x, rowHeight = 0;
  for (const r of rects) { if (cx > x && cx + r.width > x + wrap) { cx = x; y += rowHeight + gap; rowHeight = 0; } r.x = cx; r.y = y; cx += r.width + gap; rowHeight = Math.max(rowHeight, r.height); }
}
export type CanvasLayout = { rects: Map<string, Rect>; lanes: Map<string, Point[]>; index: GraphIndex };
/** `viewportWidth` only decides where rows wrap; without it the layout is the same on every screen. */
export function layoutCanvas(doc: CanvasDocument, heights: Record<string, number> = {}, catalog?: CanvasCatalog | null, viewportWidth?: number): CanvasLayout {
  const index = graphIndex(doc, catalog), { groups } = index, blocks = new Map(doc.blocks.map(b => [b.id, b]));
  const rects = new Map<string, Rect>(), lanes = new Map<string, Point[]>(), localLanes = new Map<string, Map<string, Point[]>>();
  const pad = tokens.size.groupPadding, header = tokens.size.groupHeader, G = tokens.graph;
  const rootWrap = viewportWidth ? Math.max(G.wrap.min, (viewportWidth - G.wrap.viewportInset) / tokens.canvas.initialZoom.min) : G.wrap.fallback;
  // Places the children of one container in its own coordinates. `clamp` keeps stored positions inside a group frame.
  const arrange = (container: string | null, children: string[], childRects: Rect[], origin: Point, wrap: number, clamp: boolean) => {
    const mode = index.mode(container), layout = container ? groups.get(container)!.layout : doc.layout, entity = (id: string) => index.entities.get(id)!;
    const hasGroups = children.some(id => groups.has(id)), packGap = layout?.gap ?? (container ? tokens.layout.rows.gap : tokens.layout.rows.gapRoot);
    const spacing = layout?.gap ?? (mode === 'flow' ? tokens.layout.flow.gap : hasGroups && !container ? tokens.canvas.groupGap : tokens.layout.stack.gap);
    const place = (r: Rect, p: Point) => { r.x = clamp ? Math.max(origin.x, p.x) : p.x; r.y = clamp ? Math.max(origin.y, p.y) : p.y; };
    const positionedRects = () => children.map((id, i) => entity(id).position ? childRects[i] : null).filter((r): r is Rect => !!r);
    if (mode === 'stack') {
      const maxWidth = Math.max(container ? tokens.size.blockWidth.standard : 0, ...childRects.map(r => r.width)); let y = origin.y;
      childRects.forEach(r => { r.x = origin.x; r.y = y; r.width = maxWidth; y += r.height + spacing; });
    } else if (mode === 'flow') { let x = origin.x; childRects.forEach(r => { r.x = x; r.y = origin.y; x += r.width + spacing; }); }
    else if (mode === 'rows') packRows(childRects, origin.x, origin.y, wrap, packGap);
    else if (mode === 'grid') {
      const cols = Math.min(tokens.layout.grid.columnsMax, layout?.columns ?? tokens.layout.grid.columns), cell = Math.max(tokens.size.blockWidth.standard, ...childRects.filter(r => r.width <= tokens.size.blockWidth.standard || hasGroups).map(r => r.width));
      let y = origin.y, rowH = 0, column = 0;
      childRects.forEach(r => {
        const span = r.width > cell ? cols : 1;
        if (column + span > cols) { y += rowH + spacing; column = 0; rowH = 0; }
        r.x = origin.x + column * (cell + spacing); r.y = y;
        if (span > 1) r.width = Math.max(r.width, cols * cell + (cols - 1) * spacing);
        rowH = Math.max(rowH, r.height); column += span;
        if (column >= cols) { y += rowH + spacing; column = 0; rowH = 0; }
      });
    } else if (mode === 'graph') {
      const edges = index.edges(container), linked = new Set(edges.flatMap(e => [e.from, e.to]));
      const nodes = children.map((id, i) => ({ id, width: childRects[i].width, height: childRects[i].height })).filter(n => linked.has(n.id));
      const graph = layeredLayout(nodes, edges, { direction: index.direction(container), nodeGap: layout?.gap ?? (hasGroups ? G.gap.nodeGroups : G.gap.node), layerGap: hasGroups ? G.gap.layerGroups : G.gap.layer, laneWidth: G.gap.lane });
      const moved = new Set<string>();
      children.forEach((id, i) => { const p = graph.points.get(id); if (!p) return; if (entity(id).position) { moved.add(id); place(childRects[i], entity(id).position!); } else { childRects[i].x = origin.x + p.x; childRects[i].y = origin.y + p.y; } });
      const loose = children.map((id, i) => linked.has(id) ? null : childRects[i]).filter((r): r is Rect => !!r), looseIds = children.filter(id => !linked.has(id));
      const below = origin.y + (nodes.length ? graph.height + G.gap.unlinkedOffset : 0);
      packRows(loose.filter((_, i) => !entity(looseIds[i]).position), origin.x, below, Math.max(wrap, graph.width), packGap);
      loose.forEach((r, i) => { const p = entity(looseIds[i]).position; if (p) { moved.add(looseIds[i]); place(r, p); } });
      if (moved.size) resolveOverlaps(childRects, spacing, new Set<Box>(children.map((id, i) => moved.has(id) ? childRects[i] : null).filter((r): r is Rect => !!r)));
      // A lane is only true while both ends are where the layout put them.
      const kept = new Map<string, Point[]>();
      for (const [key, path] of graph.lanes) { const [from, to] = key.split('>'); if (!moved.has(from) && !moved.has(to)) kept.set(key, path.map(p => ({ x: origin.x + p.x, y: origin.y + p.y }))); }
      localLanes.set(container ?? ROOT, kept);
    } else {
      // free: stored positions first, pushed apart once real sizes are known; the rest goes below them.
      children.forEach((id, i) => { const p = entity(id).position; if (p) place(childRects[i], p); });
      const positioned = positionedRects(), rest = childRects.filter(r => !positioned.includes(r));
      resolveOverlaps(positioned, container ? spacing : tokens.canvas.groupGap);
      if (container) { let y = Math.max(origin.y, ...positioned.map(r => r.y + r.height + spacing)); rest.forEach(r => { r.x = origin.x; r.y = y; y += r.height + spacing; }); }
      else packRows(rest, origin.x, positioned.length ? Math.max(...positioned.map(r => r.y + r.height)) + tokens.layout.root.unplacedShelfOffsetY : origin.y, wrap, tokens.layout.root.unplacedShelfGap);
    }
  };
  const dimensions = (id: string, depth: number, hidden: boolean, wrap: number): Rect => {
    const block = blocks.get(id);
    if (block) {
      const renderer = catalog?.blockTypes.find(t => t.id === block.typeId)?.renderer, node = isNodeBlock(block, catalog), wide = renderer === 'diagram' || renderer === 'preview-frame';
      const r = { x: 0, y: 0, width: node ? G.node.width : wide ? tokens.size.blockWidth.wide : tokens.size.blockWidth.standard, height: heights[id] ?? (node ? G.node.estimatedHeight : wide ? 448 : 176), depth, hidden };
      rects.set(id, r); return r;
    }
    const g = groups.get(id)!, children = [...g.blockIds, ...g.groupIds].filter(child => index.entities.has(child));
    const gp = depth ? tokens.size.groupPaddingNested : pad, gh = depth ? tokens.size.groupHeaderNested : header;
    const t = tokens.size.groupDescription, descriptionHeight = g.description ? (heights[descriptionKey(id)] ?? t.maxHeight) + t.gap : 0;
    const top = gh + gp + descriptionHeight, inner = Math.max(tokens.size.blockWidth.standard, wrap - 2 * gp);
    const childRects = children.map(child => dimensions(child, depth + 1, hidden || !!g.collapsed, inner));
    arrange(id, children, childRects, { x: gp, y: top }, inner, true);
    let bottom = top + (children.length ? 0 : tokens.size.groupEmpty + gp), right: number = tokens.size.groupMinWidth;
    childRects.forEach(r => { bottom = Math.max(bottom, r.y + r.height + gp); right = Math.max(right, r.x + r.width + gp); });
    for (const path of localLanes.get(id)?.values() ?? []) for (const p of path) right = Math.max(right, p.x + gp);
    const r = { x: 0, y: 0, width: Math.ceil(right / 8) * 8, height: g.collapsed ? gh : Math.ceil(bottom / 8) * 8, depth, hidden }; rects.set(id, r); return r;
  };
  const roots: Entity[] = [...doc.groups.filter(g => !g.parentGroupId), ...doc.blocks.filter(b => !b.parentGroupId)];
  arrange(null, roots.map(e => e.id), roots.map(e => dimensions(e.id, 0, false, rootWrap)), { x: 0, y: 0 }, rootWrap, false);
  const absolute = (id: string, parent: Point) => {
    const r = rects.get(id)!; r.x += parent.x; r.y += parent.y;
    for (const [key, path] of localLanes.get(id) ?? []) lanes.set(key, path.map(p => ({ x: p.x + r.x, y: p.y + r.y })));
    const g = groups.get(id); if (g) [...g.blockIds, ...g.groupIds].forEach(child => { if (rects.has(child)) absolute(child, r); });
  };
  for (const [key, path] of localLanes.get(ROOT) ?? []) lanes.set(key, path);
  roots.forEach(e => absolute(e.id, { x: 0, y: 0 }));
  return { rects, lanes, index };
}
export const layoutDocument = (doc: CanvasDocument, heights: Record<string, number> = {}, catalog?: CanvasCatalog | null, viewportWidth?: number): Map<string, Rect> => layoutCanvas(doc, heights, catalog, viewportWidth).rects;

export type Side = 'top' | 'bottom' | 'left' | 'right';
const normals: Record<Side, Point> = { top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
/** Parallel links between the same two visible frames, drawn as one connector. */
export type LinkRoute = {
  key: string; links: CanvasLink[]; from: string; to: string; kind: LinkKind; tone?: CanvasLink['tone']; label: string; count: number;
  d: string; elbow: Segment[]; start: Point; end: Point; endSide: Side; labelPoint: Point; badgePoint: Point;
};
const cubicAt = (p: Point, c1: Point, c2: Point, q: Point, t: number): Point => { const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t; return { x: a * p.x + b * c1.x + c * c2.x + d * q.x, y: a * p.y + b * c1.y + c * c2.y + d * q.y }; };
const fixed = (n: number) => String(Math.round(n * 10) / 10);
/** The frame a link end is drawn on: the entity itself, or the outermost collapsed group that hides it. */
export function visibleEnd(index: GraphIndex, id: string): string {
  const chain = index.chain(id);
  for (let i = chain.length - 2; i > 0; i--) if (index.groups.get(chain[i])?.collapsed) return chain[i];
  return id;
}
export function linkRoutes(doc: CanvasDocument, layout: CanvasLayout, shift?: (id: string) => Point | undefined): LinkRoute[] {
  const { index, rects } = layout, L = tokens.graph.link, bundles = new Map<string, CanvasLink[]>();
  for (const link of doc.links ?? []) {
    if (!rects.has(link.from) || !rects.has(link.to)) continue;
    const from = visibleEnd(index, link.from), to = visibleEnd(index, link.to);
    if (from === to || index.chain(from).includes(to) || index.chain(to).includes(from)) continue;
    const key = `${from}>${to}`; (bundles.get(key) ?? bundles.set(key, []).get(key)!).push(link);
  }
  const box = (id: string): Box => { const r = rects.get(id)!, delta = shift?.(id); return delta ? { ...r, x: r.x + delta.x, y: r.y + delta.y } : r; };
  type Draft = { key: string; links: CanvasLink[]; from: string; to: string; a: Box; b: Box; sides: [Side, Side]; lane?: Point[]; vertical: boolean };
  const drafts: Draft[] = [];
  for (const [key, links] of bundles) {
    const [from, to] = key.split('>'), a = box(from), b = box(to), steady = !shift?.(from) && !shift?.(to);
    const container = index.parent.get(from) === index.parent.get(to) ? index.parent.get(from)! : undefined;
    const hint = container !== undefined && index.mode(container || null) === 'graph' ? index.direction(container || null) : undefined;
    const lane = steady && hint ? layout.lanes.get(key) : undefined;
    const vGap = Math.max(b.y - a.y - a.height, a.y - b.y - b.height), hGap = Math.max(b.x - a.x - a.width, a.x - b.x - b.width);
    const dx = b.x + b.width / 2 - a.x - a.width / 2, dy = b.y + b.height / 2 - a.y - a.height / 2;
    const vertical = lane ? hint === 'down' : hint === 'down' && vGap >= L.sideGap ? true : hint === 'right' && hGap >= L.sideGap ? false : vGap >= L.sideGap && (hGap < L.sideGap || vGap >= hGap) ? true : hGap >= L.sideGap ? false : Math.abs(dy) >= Math.abs(dx);
    const sides: [Side, Side] = vertical ? dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom'] : dx >= 0 ? ['right', 'left'] : ['left', 'right'];
    drafts.push({ key, links, from, to, a, b, sides, lane, vertical });
  }
  // Connectors sharing a side fan out along it, ordered by where they come from, so they do not cross at the frame.
  const ports = new Map<string, { draft: Draft; end: 0 | 1; sort: number }[]>();
  for (const draft of drafts) ([0, 1] as const).forEach(end => {
    const id = end ? draft.to : draft.from, other = end ? draft.a : draft.b, near = end ? draft.lane?.at(-1) : draft.lane?.[0];
    const sort = draft.vertical ? near?.x ?? other.x + other.width / 2 : near?.y ?? other.y + other.height / 2, key = `${id}|${draft.sides[end]}`;
    (ports.get(key) ?? ports.set(key, []).get(key)!).push({ draft, end, sort });
  });
  const anchors = new Map<string, Point>();
  for (const list of ports.values()) {
    list.sort((p, q) => p.sort - q.sort || (p.draft.key < q.draft.key ? -1 : p.draft.key > q.draft.key ? 1 : p.end - q.end));
    list.forEach(({ draft, end }, i) => {
      const r = end ? draft.b : draft.a, side = draft.sides[end], length = side === 'top' || side === 'bottom' ? r.width : r.height;
      const offset = (i - (list.length - 1) / 2) * Math.min(L.port.spacing, length * L.port.span / list.length);
      anchors.set(`${draft.key}|${end}`, side === 'top' ? { x: r.x + r.width / 2 + offset, y: r.y } : side === 'bottom' ? { x: r.x + r.width / 2 + offset, y: r.y + r.height } : side === 'left' ? { x: r.x, y: r.y + r.height / 2 + offset } : { x: r.x + r.width, y: r.y + r.height / 2 + offset });
    });
  }
  return drafts.map(({ key, links, from, to, sides, lane, vertical }) => {
    const start = anchors.get(`${key}|0`)!, end = anchors.get(`${key}|1`)!, points = [start, ...(lane ?? []), end];
    const forward = (p: Point, q: Point): Point => vertical ? { x: 0, y: q.y >= p.y ? 1 : -1 } : { x: q.x >= p.x ? 1 : -1, y: 0 };
    const tangent = points.map((p, i) => i === 0 ? normals[sides[0]] : i === points.length - 1 ? { x: -normals[sides[1]].x, y: -normals[sides[1]].y } : forward(points[i - 1], points[i + 1]));
    const curves = points.slice(1).map((q, i) => {
      const p = points[i], reach = Math.max(L.curve.min, Math.min(L.curve.max, Math.abs(vertical ? q.y - p.y : q.x - p.x) / 2));
      return { p, c1: { x: p.x + tangent[i].x * reach, y: p.y + tangent[i].y * reach }, c2: { x: q.x - tangent[i + 1].x * reach, y: q.y - tangent[i + 1].y * reach }, q };
    });
    const d = `M${fixed(start.x)} ${fixed(start.y)}` + curves.map(c => ` C${fixed(c.c1.x)} ${fixed(c.c1.y)} ${fixed(c.c2.x)} ${fixed(c.c2.y)} ${fixed(c.q.x)} ${fixed(c.q.y)}`).join('');
    const elbow = points.slice(1).flatMap((q, i) => { const p = points[i], mid = vertical ? { a: { x: p.x, y: (p.y + q.y) / 2 }, b: { x: q.x, y: (p.y + q.y) / 2 } } : { a: { x: (p.x + q.x) / 2, y: p.y }, b: { x: (p.x + q.x) / 2, y: q.y } }; return [{ from: p, to: mid.a }, { from: mid.a, to: mid.b }, { from: mid.b, to: q }]; }).filter(s => s.from.x !== s.to.x || s.from.y !== s.to.y);
    const middle = curves[Math.floor((curves.length - 1) / 2)], first = curves[0];
    const label = links.map(l => l.label?.trim()).filter(Boolean).join(' · ');
    // Along a sideways connector the label rides above the line, so a long label never hides a short link.
    const at = cubicAt(middle.p, middle.c1, middle.c2, middle.q, .5), labelPoint = vertical ? at : { x: at.x, y: at.y - L.label.lift };
    return { key, links, from, to, kind: links[0].kind, tone: links[0].tone, label, count: links.length, d, elbow, start, end, endSide: sides[1], labelPoint, badgePoint: cubicAt(first.p, first.c1, first.c2, first.q, label ? .24 : .5) };
  });
}
/** What stays lit when something is in focus. `null` means nothing to emphasise, so nothing is dimmed either. */
export function linkFocus(routes: LinkRoute[], ids: string[], linkId?: string | null): { lit: Set<string>; routes: Set<string>; links: Set<string> } | null {
  const chosen = new Set(ids), lit = new Set<string>(ids), keys = new Set<string>(), links = new Set<string>();
  for (const route of routes) {
    const touching = linkId ? route.links.filter(l => l.id === linkId) : route.links.filter(l => chosen.has(l.from) || chosen.has(l.to) || chosen.has(route.from) || chosen.has(route.to));
    if (!touching.length) continue;
    keys.add(route.key); lit.add(route.from); lit.add(route.to);
    touching.forEach(l => { links.add(l.id); lit.add(l.from); lit.add(l.to); });
  }
  return keys.size ? { lit, routes: keys, links } : null;
}
/** Links of one entity as readable rows, for the outline and the inspector where there is no canvas to draw on. */
export function connectionsOf(doc: CanvasDocument, id: string) {
  const title = (other: string) => { const e = [...doc.blocks, ...doc.groups].find(e => e.id === other); return e?.title || other; };
  return (doc.links ?? []).filter(l => l.from === id || l.to === id).map(link => ({ link, outgoing: link.from === id, otherId: link.from === id ? link.to : link.from, title: title(link.from === id ? link.to : link.from) }));
}
/** Operations for a new link, or the existing link when that exact connection is already there. */
export function connectOperations(doc: CanvasDocument, from: string, to: string, kind: LinkKind = 'flow'): { existing?: CanvasLink; operations: CanvasOperation[]; id?: string } {
  if (from === to) return { operations: [] };
  const existing = (doc.links ?? []).find(l => l.from === from && l.to === to && l.kind === kind); if (existing) return { existing, operations: [] };
  const id = newId('link'); return { id, operations: [{ type: 'link.create', link: { id, from, to, kind } }] };
}
export function moveOperations(doc: CanvasDocument, rects: Map<string, Rect>, ids: string[], delta: Point, target?: string | null): CanvasOperation[] {
  const result: CanvasOperation[] = [], index = graphIndex(doc);
  const preservedLayouts = new Set<string>();
  const entities = topSelection(doc, ids);
  for (const e of entities) {
    const r = rects.get(e.id); if (!r) continue;
    const parentId = target === undefined ? e.parentGroupId ?? null : target;
    if (parentId === e.id || ancestors(doc, doc.groups.find(g => g.id === parentId) ?? e).some(g => g.id === e.id)) continue;
    const parent = parentId ? rects.get(parentId) : null;
    const g = doc.groups.find(g => g.id === parentId);
    const effectiveMode = index.mode(parentId), placed = freeform(effectiveMode);
    if (target === undefined && !placed) continue;
    // The reducer retains old coordinates on reparent. Pin the existing stack intent
    // when layout is absent, so a positioned root cannot turn the target into free layout.
    if (target !== undefined && g && !g.layout && !placed && !preservedLayouts.has(g.id)) {
      preservedLayouts.add(g.id); result.push({ type: 'group.update', id: g.id, patch: { layout: { mode: 'stack' } } });
    }
    result.push({ type: 'entity.move', id: e.id, parentGroupId: parentId, ...(!placed ? {} : { position: { x: snap(r.x + delta.x - (parent?.x ?? 0)), y: snap(r.y + delta.y - (parent?.y ?? 0)) } }) });
  }
  return result;
}
