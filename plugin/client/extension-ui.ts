import { PRESENTATION_DEFAULTS, type ResolvedPresentation } from '../shared/presentation';

/**
 * The pure parts of how an open extension sits on screen (docs/design.md §45): where its box goes for each mode, where
 * a popover points, and the blocks extensions hid for an effect. No React here, so tests run it directly.
 */
export type Box = { x: number; y: number; width: number; height: number };
/** Room the panel's own controls take around the canvas: the top islands, the toolbar, the right panel. */
export type SurfaceInsets = { top: number; bottom: number; left: number; right: number; chip: number };
export type SurfacePlacement = Box & { z: 'overlay' | 'panel' | 'popover' | 'fullscreen'; arrow?: { side: 'top' | 'bottom'; x: number } };
const T = { gap: 12, arrow: 7, edge: 8, cascade: 24 };

/**
 * Where an extension's box goes, in the panel's coordinates. `area` is the whole Lienzo area, `canvas` the canvas
 * inside it (smaller on a compact panel), `anchor` the screen rectangle a popover points at, `stack` how many panels
 * with the same position opened before this one (they cascade). On a compact panel, panels and popovers are a sheet
 * across the bottom.
 */
export function surfaceBox(ui: ResolvedPresentation, area: { width: number; height: number }, canvas: Box, insets: SurfaceInsets, options: { compact?: boolean; anchor?: Box | null; stack?: number } = {}): SurfacePlacement {
  if (ui.mode === 'overlay') return { ...canvas, z: 'overlay' };
  if (ui.mode === 'fullscreen') return { x: 0, y: 0, width: area.width, height: area.height, z: 'fullscreen' };
  const room = { x: canvas.x + insets.left, y: canvas.y + insets.top, width: Math.max(0, canvas.width - insets.left - insets.right), height: Math.max(0, canvas.height - insets.top - insets.bottom) };
  const width = Math.round(Math.min(ui.width, Math.max(160, room.width))), height = Math.round(Math.min(ui.height, Math.max(120, room.height)));
  if (options.compact) {
    const w = Math.max(0, canvas.width - 2 * T.edge), h = Math.min(height, Math.round(canvas.height * .6));
    return { x: Math.round(canvas.x + (canvas.width - w) / 2), y: Math.round(canvas.y + canvas.height - insets.bottom - h), width: w, height: h, z: ui.mode === 'popover' ? 'popover' : 'panel' };
  }
  if (ui.mode === 'popover') {
    const a = options.anchor;
    if (a) return popoverBox(a, { width, height }, room);
    return { x: Math.round(room.x + (room.width - width) / 2), y: room.y, width, height, z: 'popover' };
  }
  const shift = (options.stack ?? 0) * T.cascade;
  switch (ui.position) {
    case 'left': return { x: room.x + shift, y: room.y + shift, width, height, z: 'panel' };
    case 'bottom': return { x: Math.round(room.x + (room.width - width) / 2) + shift, y: room.y + room.height - height - shift, width, height, z: 'panel' };
    case 'center': return { x: Math.round(room.x + (room.width - width) / 2) + shift, y: Math.round(room.y + (room.height - height) / 2) + shift, width, height, z: 'panel' };
    default: return { x: room.x + room.width - width - shift, y: room.y + shift, width, height, z: 'panel' };
  }
}
/**
 * A popover above its anchor when it fits there, else below; centred on it and kept inside `room`. The arrow points
 * at the anchor's centre, clamped away from the rounded corners.
 */
export function popoverBox(anchor: Box, size: { width: number; height: number }, room: Box): SurfacePlacement {
  const cx = anchor.x + anchor.width / 2, x = Math.round(Math.max(room.x, Math.min(room.x + room.width - size.width, cx - size.width / 2)));
  const above = anchor.y - T.gap - size.height, below = anchor.y + anchor.height + T.gap;
  const fitsAbove = above >= room.y, fitsBelow = below + size.height <= room.y + room.height;
  const side = fitsAbove || !fitsBelow && anchor.y - room.y > room.y + room.height - (anchor.y + anchor.height) ? 'bottom' : 'top';
  const y = Math.round(side === 'bottom' ? Math.max(room.y, above) : Math.min(room.y + room.height - size.height, below));
  return { x, y, width: size.width, height: size.height, z: 'popover', arrow: { side, x: Math.round(Math.max(16, Math.min(size.width - 16, cx - x))) } };
}
/** The screen rectangle around some world rectangles, for a camera `{ scale, offset }` (screen = world × scale + offset). */
export function screenBounds(rects: readonly Box[], camera: { scale: number; offset: { x: number; y: number } }): Box | null {
  if (!rects.length) return null;
  const x0 = Math.min(...rects.map(r => r.x)), y0 = Math.min(...rects.map(r => r.y)), x1 = Math.max(...rects.map(r => r.x + r.width)), y1 = Math.max(...rects.map(r => r.y + r.height));
  return { x: x0 * camera.scale + camera.offset.x, y: y0 * camera.scale + camera.offset.y, width: (x1 - x0) * camera.scale, height: (y1 - y0) * camera.scale };
}
/** A rectangle cut to the visible area, or null when nothing of it is visible. */
export function clipBox(box: Box, to: Box): Box | null {
  const x = Math.max(box.x, to.x), y = Math.max(box.y, to.y), r = Math.min(box.x + box.width, to.x + to.width), b = Math.min(box.y + box.height, to.y + to.height);
  return r - x >= 1 && b - y >= 1 ? { x, y, width: r - x, height: b - y } : null;
}
/** Panels whose box changes when the person drags nothing: a mode switch keeps the same element (no reload). */
export const defaultSize = (mode: ResolvedPresentation['mode']) => mode === 'popover' ? PRESENTATION_DEFAULTS.popover : PRESENTATION_DEFAULTS.panel;
/** Esc closes these at once; a panel with its title bar closes from its ✕ (Esc keeps deselecting on the canvas). */
export const closesOnEscape = (ui: Pick<ResolvedPresentation, 'mode' | 'chrome'>) => ui.mode !== 'panel' || ui.chrome !== 'full';
/** Overlays let the pointer through to the canvas unless the page asked for it; every other mode takes it. */
export const takesPointer = (ui: Pick<ResolvedPresentation, 'mode'>, capturing: boolean) => ui.mode !== 'overlay' || capturing;

type Timer = unknown;
/**
 * Blocks and Frames extensions hid for an effect (lienzo.hide): only on this screen, never saved, no revision. Each
 * extension owns its own set; closing it (release) shows them again, and `ms` shows them again by itself.
 */
export class HiddenRegistry {
  private readonly owners = new Map<string, Map<string, Timer | null>>();
  private readonly listeners = new Set<() => void>();
  private cache: ReadonlySet<string> = new Set();
  constructor(private readonly timers: { set(fn: () => void, ms: number): Timer; clear(timer: Timer): void } = { set: (fn, ms) => setTimeout(fn, ms), clear: timer => clearTimeout(timer as ReturnType<typeof setTimeout>) }) {}
  hide(owner: string, ids: readonly string[], ms: number | null) {
    if (!ids.length) return;
    const mine = this.owners.get(owner) ?? new Map<string, Timer | null>(); this.owners.set(owner, mine);
    for (const id of ids) {
      const old = mine.get(id); if (old) this.timers.clear(old);
      mine.set(id, ms === null ? null : this.timers.set(() => this.show(owner, [id]), ms));
    }
    this.changed();
  }
  /** Shows some of what `owner` hid, or all of it (`ids` null). */
  show(owner: string, ids: readonly string[] | null) {
    const mine = this.owners.get(owner); if (!mine) return;
    for (const id of ids ?? [...mine.keys()]) { const timer = mine.get(id); if (timer) this.timers.clear(timer); mine.delete(id); }
    if (!mine.size) this.owners.delete(owner);
    this.changed();
  }
  release(owner: string) { this.show(owner, null); }
  /** Everything hidden by anyone now. */
  ids(): ReadonlySet<string> { return this.cache; }
  of(owner: string): string[] { return [...(this.owners.get(owner)?.keys() ?? [])]; }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private changed() {
    const next = new Set<string>(); for (const mine of this.owners.values()) for (const id of mine.keys()) next.add(id);
    if (next.size === this.cache.size && [...next].every(id => this.cache.has(id))) return;
    this.cache = next; this.listeners.forEach(listener => listener());
  }
}
