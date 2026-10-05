import type { CanvasDocument, CanvasBlock, CanvasGroup, CanvasOperation, DiagramData, DocumentContent, CanvasCatalog, CanvasPack, BlockType } from '../shared/model';
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
  const { title, description, blocks, groups, selectedIds, communication, example } = doc;
  return { title: own ? `${title} · copia` : title, description, blocks, groups, selectedIds, communication, example: own ? false : example };
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
export function layoutDocument(doc: CanvasDocument, heights: Record<string, number> = {}, catalog?: CanvasCatalog | null): Map<string, Rect> {
  const rects = new Map<string, Rect>(), groups = new Map(doc.groups.map(g => [g.id, g])), blocks = new Map(doc.blocks.map(b => [b.id, b]));
  const pad = tokens.size.groupPadding, header = tokens.size.groupHeader;
  const dimensions = (id: string, depth: number, hidden: boolean): Rect => {
    const block = blocks.get(id);
    if (block) {
      const renderer = catalog?.blockTypes.find(t => t.id === block.typeId)?.renderer;
      const wide = renderer === 'diagram' || renderer === 'preview-frame';
      const r = { x: 0, y: 0, width: wide ? tokens.size.blockWidth.wide : tokens.size.blockWidth.standard, height: heights[id] ?? (wide ? 448 : 176), depth, hidden };
      rects.set(id, r); return r;
    }
    const g = groups.get(id)!;
    const children = [...g.blockIds, ...g.groupIds];
    const gp = depth ? tokens.size.groupPaddingNested : pad, gh = depth ? tokens.size.groupHeaderNested : header;
    const mode = g.layout?.mode ?? (children.some(id => (blocks.get(id) ?? groups.get(id))?.position) ? 'free' : 'stack');
    const spacing = g.layout?.gap ?? (mode === 'flow' ? tokens.layout.flow.gap : tokens.layout.stack.gap);
    const descriptionHeight = g.description ? 42 : 0;
    let bottom = gh + gp + descriptionHeight + (children.length ? 0 : 56), stackY = gh + gp + descriptionHeight, flowX = gp, rowH = 0, column = 0;
    let right: number = tokens.size.groupMinWidth;
    const cols = Math.min(4, g.layout?.columns ?? 2);
    const childRects = children.map(id => dimensions(id, depth + 1, hidden || !!g.collapsed));
    const maxWidth = Math.max(tokens.size.blockWidth.standard, ...childRects.map(r => r.width));
    let freeY = Math.max(stackY, ...children.map((id, i) => { const e = blocks.get(id) ?? groups.get(id)!; return e.position ? e.position.y + childRects[i].height + spacing : 0; }));
    children.forEach((child, i) => {
      const r = childRects[i], entity = blocks.get(child) ?? groups.get(child)!;
      if (mode === 'stack') { r.x = gp; r.y = stackY; r.width = maxWidth; stackY += r.height + spacing; }
      else if (mode === 'flow') { r.x = flowX; r.y = stackY; flowX += r.width + spacing; }
      else if (mode === 'grid') {
        const span = r.width > tokens.size.blockWidth.standard ? cols : 1;
        if (column + span > cols) { stackY += rowH + spacing; column = 0; rowH = 0; }
        r.x = gp + column * (tokens.size.blockWidth.standard + spacing); r.y = stackY;
        if (span > 1) r.width = Math.max(r.width, cols * tokens.size.blockWidth.standard + (cols - 1) * spacing);
        rowH = Math.max(rowH, r.height); column += span;
        if (column >= cols) { stackY += rowH + spacing; column = 0; rowH = 0; }
      } else { r.x = entity.position?.x ?? gp; r.y = entity.position?.y ?? freeY; if (!entity.position) freeY += r.height + spacing; }
      bottom = Math.max(bottom, r.y + r.height + gp); right = Math.max(right, r.x + r.width + gp);
    });
    const r = { x: 0, y: 0, width: Math.ceil(right / 8) * 8, height: g.collapsed ? gh : Math.ceil(bottom / 8) * 8, depth, hidden }; rects.set(id, r); return r;
  };
  const roots: Entity[] = [...doc.groups.filter(g => !g.parentGroupId), ...doc.blocks.filter(b => !b.parentGroupId)];
  roots.forEach(e => { const r = dimensions(e.id, 0, false); r.x = e.position?.x ?? 0; r.y = e.position?.y ?? 0; });
  const placed = roots.filter(e => e.position); let shelfY = placed.length ? Math.max(...placed.map(e => rects.get(e.id)!.y + rects.get(e.id)!.height)) + tokens.layout.root.unplacedShelfOffsetY : 0, shelfX = 0, shelfH = 0;
  roots.filter(e => !e.position).forEach(e => { const r = rects.get(e.id)!; if (shelfX && shelfX + r.width > tokens.layout.root.unplacedShelfWidth) { shelfY += shelfH + tokens.layout.root.unplacedShelfGap; shelfX = 0; shelfH = 0; } r.x = shelfX; r.y = shelfY; shelfX += r.width + tokens.layout.root.unplacedShelfGap; shelfH = Math.max(shelfH, r.height); });
  const absolute = (id: string, parent: Point) => { const r = rects.get(id)!; r.x += parent.x; r.y += parent.y; const g = groups.get(id); if (g) [...g.blockIds, ...g.groupIds].forEach(child => absolute(child, r)); };
  roots.forEach(e => absolute(e.id, { x: 0, y: 0 })); return rects;
}
export function moveOperations(doc: CanvasDocument, rects: Map<string, Rect>, ids: string[], delta: Point, target?: string | null): CanvasOperation[] {
  const result: CanvasOperation[] = [];
  const preservedLayouts = new Set<string>();
  const entities = topSelection(doc, ids);
  for (const e of entities) {
    const r = rects.get(e.id); if (!r) continue;
    const parentId = target === undefined ? e.parentGroupId ?? null : target;
    if (parentId === e.id || ancestors(doc, doc.groups.find(g => g.id === parentId) ?? e).some(g => g.id === e.id)) continue;
    const parent = parentId ? rects.get(parentId) : null;
    const g = doc.groups.find(g => g.id === parentId);
    const effectiveMode = g?.layout?.mode ?? (g && [...g.blockIds, ...g.groupIds].some(id => [...doc.blocks, ...doc.groups].find(e => e.id === id)?.position) ? 'free' : 'stack');
    if (target === undefined && g && effectiveMode !== 'free') continue;
    // The reducer retains old coordinates on reparent. Pin the existing stack intent
    // when layout is absent, so a positioned root cannot turn the target into free layout.
    if (target !== undefined && g && !g.layout && effectiveMode === 'stack' && !preservedLayouts.has(g.id)) {
      preservedLayouts.add(g.id); result.push({ type: 'group.update', id: g.id, patch: { layout: { mode: 'stack' } } });
    }
    result.push({ type: 'entity.move', id: e.id, parentGroupId: parentId, ...(g && effectiveMode !== 'free' ? {} : { position: { x: snap(r.x + delta.x - (parent?.x ?? 0)), y: snap(r.y + delta.y - (parent?.y ?? 0)) } }) });
  }
  return result;
}
