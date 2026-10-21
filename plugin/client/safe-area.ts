import { createContext, useContext, useEffect, useRef } from 'react';

/**
 * What Lienzo's own UI covers on the canvas, in one place (lienzo.ui.safeArea, and every fit that frames things clear
 * of the UI). Each island reports its own box from layout (useSafeRect), so nothing here repeats token math: when an
 * island moves, grows or goes, the free zone follows. Boxes are page pixels; the area is told relative to the canvas.
 */
type Box = { x: number; y: number; width: number; height: number };
export type SafeKind = 'document' | 'actions' | 'toolbar' | 'zoom' | 'minimap' | 'lens' | 'panel' | 'pill' | 'popover' | 'comments' | 'restore' | 'topbar' | 'banner';
export type SafeRect = Box & { kind: SafeKind };
/** Insets from each canvas edge (what touches it), the covered boxes, and the largest free rectangle. */
export type SafeArea = { top: number; right: number; bottom: number; left: number; rects: SafeRect[]; freeRect: Box };
type Entry = { kind: SafeKind; rect: Box; owner?: string };

const round = (n: number) => Math.round(n);
const clip = (r: Box, size: { width: number; height: number }): Box | null => {
  const x = Math.max(0, r.x), y = Math.max(0, r.y), right = Math.min(size.width, r.x + r.width), bottom = Math.min(size.height, r.y + r.height);
  return right - x >= 1 && bottom - y >= 1 ? { x, y, width: right - x, height: bottom - y } : null;
};
/**
 * The largest axis-aligned rectangle of the canvas that no box covers. Candidate edges are the canvas' and the boxes'
 * own; with the dozen islands Lienzo has this is instant. Ties keep the first found (top-left first).
 */
export function freeRect(size: { width: number; height: number }, rects: readonly Box[]): Box {
  const xs = [...new Set([0, size.width, ...rects.flatMap(r => [r.x, r.x + r.width])])].filter(x => x >= 0 && x <= size.width).sort((a, b) => a - b);
  const ys = [...new Set([0, size.height, ...rects.flatMap(r => [r.y, r.y + r.height])])].filter(y => y >= 0 && y <= size.height).sort((a, b) => a - b);
  const hits = (a: Box) => rects.some(r => r.x < a.x + a.width && r.x + r.width > a.x && r.y < a.y + a.height && r.y + r.height > a.y);
  let best: Box = { x: 0, y: 0, width: 0, height: 0 };
  for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) {
    const w = xs[j] - xs[i]; if (w * size.height <= best.width * best.height) continue;
    for (let k = 0; k < ys.length; k++) for (let l = ys.length - 1; l > k; l--) {
      const h = ys[l] - ys[k]; if (w * h <= best.width * best.height) break;
      const box = { x: xs[i], y: ys[k], width: w, height: h }; if (!hits(box)) { best = box; break; }
    }
  }
  return best;
}
/**
 * The safe area of a canvas of `size` from covered boxes already in canvas pixels. Each box counts toward the inset of
 * the edge it is nearest to (a toolbar at the bottom, a panel on the right), so the insets say how far to stay from
 * each edge to clear everything that hugs it.
 */
export function safeAreaOf(size: { width: number; height: number }, covered: readonly SafeRect[]): SafeArea {
  const rects = covered.flatMap(r => { const c = clip(r, size); return c ? [{ kind: r.kind, x: round(c.x), y: round(c.y), width: round(c.width), height: round(c.height) }] : []; });
  const inset = { top: 0, right: 0, bottom: 0, left: 0 };
  for (const r of rects) {
    const d = { top: r.y, left: r.x, bottom: size.height - (r.y + r.height), right: size.width - (r.x + r.width) };
    const edge = (Object.keys(d) as (keyof typeof d)[]).reduce((a, b) => d[b] < d[a] ? b : a);
    inset[edge] = Math.max(inset[edge], round(edge === 'top' ? r.y + r.height : edge === 'left' ? r.x + r.width : edge === 'bottom' ? size.height - r.y : size.width - r.x));
  }
  return { ...inset, rects, freeRect: freeRect(size, rects) };
}
export const EMPTY_SAFE_AREA = (size: { width: number; height: number }): SafeArea => ({ top: 0, right: 0, bottom: 0, left: 0, rects: [], freeRect: { x: 0, y: 0, width: Math.max(0, round(size.width)), height: Math.max(0, round(size.height)) } });

/** Every island's box and the canvas', by key. Measurers are kept so a layout change elsewhere can ask all to look again. */
export class SafeAreaRegistry {
  private entries = new Map<string, Entry>(); private canvas: Box | null = null; private listeners = new Set<() => void>();
  private measurers = new Set<() => void>(); private pending: unknown = null; private cache = new Map<string, SafeArea>();
  /** An island's box in page pixels, or null when it is gone. */
  set(key: string, entry: Entry | null) {
    const old = this.entries.get(key);
    if (!entry) { if (old) { this.entries.delete(key); this.changed(); } return; }
    if (old && old.kind === entry.kind && old.owner === entry.owner && same(old.rect, entry.rect)) return;
    this.entries.set(key, entry); this.changed();
  }
  setCanvas(box: Box | null) { if (box && this.canvas && same(box, this.canvas) || !box && !this.canvas) return; this.canvas = box; this.changed(); }
  /** The area as an extension sees it: its own panel or popover is not in its way; its pill is. */
  area(owner?: string): SafeArea {
    const key = owner ?? ''; const hit = this.cache.get(key); if (hit) return hit;
    const c = this.canvas; if (!c) return EMPTY_SAFE_AREA({ width: 0, height: 0 });
    const covered = [...this.entries.values()].filter(e => !owner || e.owner !== owner || e.kind === 'pill').map(e => ({ kind: e.kind, x: e.rect.x - c.x, y: e.rect.y - c.y, width: e.rect.width, height: e.rect.height }));
    const area = safeAreaOf(c, covered); this.cache.set(key, area); return area;
  }
  /** The free zone every fit uses (canvas pixels): the largest free rectangle, whatever extension asks. */
  free(): Box | null { return this.canvas ? this.area().freeRect : null; }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  measurer(run: () => void) { this.measurers.add(run); return () => { this.measurers.delete(run); }; }
  /** Every island looks at its box again (the window resized, a panel opened); coalesced to one animation frame. */
  remeasure() {
    if (this.pending !== null) return; const raf = (globalThis as { requestAnimationFrame?: (f: () => void) => unknown }).requestAnimationFrame;
    const run = () => { this.pending = null; this.measurers.forEach(m => m()); };
    this.pending = raf ? raf(run) : setTimeout(run, 16);
  }
  private changed() { this.cache.clear(); this.listeners.forEach(l => l()); }
}
const same = (a: Box, b: Box) => Math.abs(a.x - b.x) < .5 && Math.abs(a.y - b.y) < .5 && Math.abs(a.width - b.width) < .5 && Math.abs(a.height - b.height) < .5;

export const SafeAreaContext = createContext<SafeAreaRegistry | null>(null);
type Measurable = { getBoundingClientRect?(): { left: number; top: number; width: number; height: number }; measureInWindow?(done: (x: number, y: number, width: number, height: number) => void): void };
/** A box in page pixels: the DOM's on the web (where extensions run), measureInWindow elsewhere. */
export function measureNode(node: unknown, done: (box: Box | null) => void) {
  const n = node as Measurable | null;
  if (n?.getBoundingClientRect) { const r = n.getBoundingClientRect(); done(r.width > 0 && r.height > 0 ? { x: r.left, y: r.top, width: r.width, height: r.height } : null); return; }
  if (n?.measureInWindow) { n.measureInWindow((x, y, width, height) => done(width > 0 && height > 0 ? { x, y, width, height } : null)); return; }
  done(null);
}
/**
 * Reports the box of the View it is spread on (`ref` and `onLayout`) as covering the canvas, while mounted and `on`.
 * `owner` marks an extension's own surface; `registry` is for the component that provides it. Without one (a test, a
 * harness) it does nothing.
 */
export function useSafeRect(kind: SafeKind, options: { owner?: string; on?: boolean; key?: string; registry?: SafeAreaRegistry } = {}) {
  const above = useContext(SafeAreaContext), registry = options.registry ?? above, ref = useRef<unknown>(null), id = useRef(options.key ?? `${kind}:${Math.random().toString(36).slice(2)}`).current, on = options.on !== false;
  const measure = () => { if (!registry) return; if (!on) { registry.set(id, null); return; } measureNode(ref.current, box => registry.set(id, box ? { kind, rect: box, owner: options.owner } : null)); };
  const latest = useRef(measure); latest.current = measure;
  useEffect(() => { if (!registry) return; const stop = registry.measurer(() => latest.current()); latest.current(); return () => { stop(); registry.set(id, null); }; }, [registry, on, kind, options.owner]);
  return { ref: ref as never, onLayout: () => latest.current() };
}
