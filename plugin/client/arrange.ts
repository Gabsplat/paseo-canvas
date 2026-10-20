/**
 * Power commands on a selection, pure (docs/design.md §42): align and distribute, flip, the axis a Shift-drag keeps,
 * the arrow-key nudge and its burst. Panel.tsx and Canvas.tsx turn the results into one transaction each.
 */
import type { CanvasCatalog, CanvasDocument, CanvasOperation } from '../shared/model';
import { movable, moveOperations, topSelection, type Point, type Rect } from './logic';

export type AlignKind = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
export type DistributeKind = 'horizontal' | 'vertical';
export type FlipAxis = 'horizontal' | 'vertical';
type Box = { id: string; x: number; y: number; width: number; height: number };
/** Arrange commands for ⌘K and the selection bar: shortcut id, title, icon. */
export const ARRANGE_COMMANDS = [['arrange.alignLeft', 'Align left', 'AlignStartVertical'], ['arrange.alignCenter', 'Align centres horizontally', 'AlignCenterVertical'], ['arrange.alignRight', 'Align right', 'AlignEndVertical'],
  ['arrange.alignTop', 'Align top', 'AlignStartHorizontal'], ['arrange.alignMiddle', 'Align middles vertically', 'AlignCenterHorizontal'], ['arrange.alignBottom', 'Align bottom', 'AlignEndHorizontal'],
  ['arrange.distributeH', 'Distribute horizontally', 'AlignHorizontalDistributeCenter'], ['arrange.distributeV', 'Distribute vertically', 'AlignVerticalDistributeCenter'],
  ['arrange.flipH', 'Flip horizontally', 'FlipHorizontal2'], ['arrange.flipV', 'Flip vertically', 'FlipVertical2']] as const;


/** Shift held while dragging: only the larger of the two components survives (ties stay horizontal). */
export function axisLock(delta: Point): Point { return Math.abs(delta.x) >= Math.abs(delta.y) ? { x: delta.x, y: 0 } : { x: 0, y: delta.y }; }

/** How far each box moves so their left/centre/right or top/middle/bottom edges meet. Boxes already there are left out. */
export function alignDeltas(boxes: readonly Box[], kind: AlignKind): Map<string, Point> {
  const out = new Map<string, Point>(); if (boxes.length < 2) return out;
  const left = Math.min(...boxes.map(b => b.x)), right = Math.max(...boxes.map(b => b.x + b.width)), top = Math.min(...boxes.map(b => b.y)), bottom = Math.max(...boxes.map(b => b.y + b.height));
  for (const b of boxes) {
    const d = kind === 'left' ? { x: left - b.x, y: 0 } : kind === 'right' ? { x: right - b.x - b.width, y: 0 } : kind === 'center' ? { x: (left + right) / 2 - b.x - b.width / 2, y: 0 }
      : kind === 'top' ? { x: 0, y: top - b.y } : kind === 'bottom' ? { x: 0, y: bottom - b.y - b.height } : { x: 0, y: (top + bottom) / 2 - b.y - b.height / 2 };
    const rounded = { x: Math.round(d.x), y: Math.round(d.y) };
    if (rounded.x || rounded.y) out.set(b.id, rounded);
  }
  return out;
}
/** Equal gaps between three or more boxes, in the order they stand; the first and the last stay where they are. */
export function distributeDeltas(boxes: readonly Box[], kind: DistributeKind): Map<string, Point> {
  const out = new Map<string, Point>(); if (boxes.length < 3) return out;
  const h = kind === 'horizontal', start = (b: Box) => h ? b.x : b.y, size = (b: Box) => h ? b.width : b.height;
  const sorted = [...boxes].sort((a, b) => start(a) + size(a) / 2 - start(b) - size(b) / 2 || a.id.localeCompare(b.id));
  const first = sorted[0], last = sorted.at(-1)!, span = start(last) + size(last) - start(first), gap = (span - sorted.reduce((sum, b) => sum + size(b), 0)) / (sorted.length - 1);
  let at = start(first);
  for (const b of sorted) { const move = Math.round(at - start(b)); if (move) out.set(b.id, h ? { x: move, y: 0 } : { x: 0, y: move }); at += size(b) + gap; }
  return out;
}
/** The boxes of the outermost selected entities that are on the canvas and free to move (a locked Frame is left out). */
export function selectionBoxes(doc: CanvasDocument, rects: ReadonlyMap<string, Rect>, ids: readonly string[]): Box[] {
  return topSelection(doc, movable(doc, ids)).map(e => ({ e, r: rects.get(e.id) })).filter(({ r }) => r && !r.hidden).map(({ e, r }) => ({ id: e.id, x: r!.x, y: r!.y, width: r!.width, height: r!.height }));
}
/** One transaction that moves each entity by its own delta, with no grid: what align, distribute and flip write. */
export function arrangeOperations(doc: CanvasDocument, rects: Map<string, Rect>, deltas: ReadonlyMap<string, Point>, catalog?: CanvasCatalog | null): CanvasOperation[] {
  return deltas.size ? moveOperations(doc, rects, [...deltas.keys()], { x: 0, y: 0 }, undefined, { catalog, grid: false, deltas }) : [];
}

const FLIP_FROM = { horizontal: { nw: 'ne', ne: 'nw', sw: 'se', se: 'sw' }, vertical: { nw: 'sw', sw: 'nw', ne: 'se', se: 'ne' } } as const;
/**
 * Flip: drawings mirror their strokes and lines swap their ends; with several things selected, their places mirror
 * inside the selection too. Cards, text and symmetric shapes keep their own look. Empty when nothing would change.
 */
export function flipOperations(doc: CanvasDocument, rects: Map<string, Rect>, ids: readonly string[], axis: FlipAxis, catalog?: CanvasCatalog | null): CanvasOperation[] {
  const h = axis === 'horizontal', renderer = (typeId: string) => catalog?.blockTypes.find(t => t.id === typeId)?.renderer ?? typeId, operations: CanvasOperation[] = [];
  for (const block of doc.blocks.filter(b => ids.includes(b.id))) {
    const kind = renderer(block.typeId), data = block.data as Record<string, unknown>;
    if (kind === 'wb-draw' && Array.isArray(data.strokes) && data.extent && typeof data.extent === 'object') {
      const extent = data.extent as { width: number; height: number };
      const strokes = (data.strokes as { points: number[] }[]).map(stroke => ({ ...stroke, points: stroke.points.map((v, i) => (i % 2 === 0) === h ? Math.max(0, (h ? extent.width : extent.height) - v) : v) }));
      operations.push({ type: 'block.update', id: block.id, patch: { data: { strokes } as never } });
    } else if (kind === 'wb-shape' && data.shape === 'line') {
      operations.push({ type: 'block.update', id: block.id, patch: { data: { from: FLIP_FROM[axis][(data.from as keyof typeof FLIP_FROM.horizontal) ?? 'nw'] } } });
    }
  }
  const boxes = selectionBoxes(doc, rects, ids);
  if (boxes.length > 1) {
    const low = Math.min(...boxes.map(b => h ? b.x : b.y)), high = Math.max(...boxes.map(b => h ? b.x + b.width : b.y + b.height)), deltas = new Map<string, Point>();
    for (const b of boxes) { const move = Math.round(low + high - (h ? b.x + b.width : b.y + b.height) - (h ? b.x : b.y)); if (move) deltas.set(b.id, h ? { x: move, y: 0 } : { x: 0, y: move }); }
    operations.push(...arrangeOperations(doc, rects, deltas, catalog));
  }
  return operations;
}

/** Arrow keys: 1 canvas unit, 10 with Shift. */
export function nudgeDelta(key: string, shift: boolean): Point | null {
  const d = shift ? 10 : 1;
  return key === 'ArrowLeft' ? { x: -d, y: 0 } : key === 'ArrowRight' ? { x: d, y: 0 } : key === 'ArrowUp' ? { x: 0, y: -d } : key === 'ArrowDown' ? { x: 0, y: d } : null;
}
type Timers = { set(run: () => void, ms: number): unknown; clear(handle: unknown): void };
/**
 * A burst of nudges is one undo entry: each press adds to a running total that is shown at once and written when the
 * keys rest for `wait` ms, when the selection changes, or when something else flushes it first.
 */
export function nudgeBurst(commit: (ids: string[], delta: Point) => void, wait = 450, timers: Timers = { set: (run, ms) => setTimeout(run, ms), clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) }) {
  let ids: string[] = [], total: Point = { x: 0, y: 0 }, timer: unknown = null;
  const flush = () => { if (timer !== null) timers.clear(timer); timer = null; const out = ids, delta = total; ids = []; total = { x: 0, y: 0 }; if ((delta.x || delta.y) && out.length) commit(out, delta); };
  return {
    /** Adds a press; returns the running total for the preview. */
    add(next: readonly string[], delta: Point): Point {
      if (ids.length && ids.join('|') !== next.join('|')) flush();
      ids = [...next]; total = { x: total.x + delta.x, y: total.y + delta.y };
      if (timer !== null) timers.clear(timer); timer = timers.set(flush, wait); return total;
    },
    flush, pending: () => ids.length > 0,
  };
}
