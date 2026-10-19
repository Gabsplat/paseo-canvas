// One WebGL context for every shader on the page. A browser keeps about sixteen live contexts and force-loses the
// oldest past that, so a context per block put a ceiling on a Lienzo. Here each drawing keeps a plain 2D canvas on its
// card and borrows the shared context for a frame: draw into it at the card's pixel size, then copy the picture over.
// Only drawings on screen take frames; one that comes into view draws at once. When the frames cost too much, the
// drawings take turns (a lower frame rate); none is refused.
import type { GLContext } from './web';

export const GL_LIMITS = {
  /** Longest side of one drawing, and of the shared drawing buffer, in device pixels. */
  edge: 2048,
  /** A zoomed-out card draws at fewer pixels than CSS pixels, down to this ratio. */
  floor: .25,
  /** Device pixels drawn per frame across all drawings. It shrinks when a frame runs long and recovers slowly. */
  budget: { start: 4_000_000, min: 262_144, max: 16_000_000 },
  /** A frame that takes longer than this (draws plus copies) lowers the next budget. */
  frameMs: 12,
} as const;

export type SurfacePixels = { width: number; height: number; pixelRatio: number };
/**
 * The drawing buffer for a canvas shown at `width` × `height` CSS pixels and `shownWidth` screen pixels wide (the
 * camera's scale): the screen's resolution, capped by the block's own `maxPixelSize` and by `edge` on the long side.
 */
export function surfacePixels(width: number, height: number, devicePixelRatio: number, shownWidth: number, maxPixelSize?: number, floor = 1, edge = Infinity): SurfacePixels {
  const physical = Math.max(floor, Math.min(4, (devicePixelRatio || 1) * (shownWidth || width) / width));
  const cap = Number.isFinite(maxPixelSize) ? Math.max(16, Math.min(2048, edge, maxPixelSize!)) : edge;
  const pixelRatio = Math.min(physical, cap / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * pixelRatio)), height: Math.max(1, Math.round(height * pixelRatio)), pixelRatio };
}

export type GLCandidate = { id: string; pixels: number; fresh: boolean; last: number };
/**
 * Which drawings get this frame. Fresh ones (just shown, resized or changed) go first, then whoever has waited longest,
 * while the pixel budget lasts; the first is always drawn. The rest wait a frame or two: the one left out longest is
 * first next time, so a large drawing never starves behind small ones.
 */
export function planGLFrame(candidates: readonly GLCandidate[], budget: number): string[] {
  const order = [...candidates].sort((a, b) => Number(b.fresh) - Number(a.fresh) || a.last - b.last);
  const chosen: string[] = []; let spent = 0;
  for (const c of order) { if (chosen.length && spent + c.pixels > budget) continue; chosen.push(c.id); spent += c.pixels; }
  return chosen;
}
/** The next frame's budget: a long frame cuts it to a share of what it drew; a quick one lets it grow back. */
export function nextGLBudget(budget: number, spent: number, elapsedMs: number): number {
  const { min, max } = GL_LIMITS.budget, clamp = (v: number) => Math.round(Math.max(min, Math.min(max, v)));
  if (spent > 0 && elapsedMs > GL_LIMITS.frameMs) return clamp(Math.min(budget, spent) * Math.max(.25, GL_LIMITS.frameMs / elapsedMs));
  return clamp(budget * 1.1);
}

export interface SharedGLCanvas {
  width: number; height: number; getContext(kind: string, options?: object): unknown;
  addEventListener(name: string, listener: (event: { preventDefault(): void }) => void): void;
  removeEventListener(name: string, listener: (event: { preventDefault(): void }) => void): void;
}
type Host = { document?: { createElement?(tag: string): unknown }; requestAnimationFrame(cb: (time: number) => void): number; cancelAnimationFrame(id: number): void; performance?: { now(): number } };
/** A drawing that borrows the shared context. The hub decides when it draws; it owns everything else. */
export type GLClient = {
  /** Mounted, on screen and in a visible tab. */
  ready(): boolean; animated(): boolean;
  /** Wants a frame even if it is not animated: just shown, resized or changed. */
  fresh: boolean; last: number;
  /** Its drawing buffer now, or null while it has no size. */
  pixels(): SurfacePixels | null;
  /** The context is there (again), or null when the browser offers none. */
  start(gl: GLContext | null): void;
  lost(): void;
  /** Draw into the shared buffer (viewport and clear already set) and copy the bottom-left `pixels` from `source`. */
  draw(gl: GLContext, pixels: SurfacePixels, time: number, source: SharedGLCanvas): void;
};
type Hub = { host: Host; clients: Set<GLClient>; canvas: SharedGLCanvas | null; gl: GLContext | null; lost: boolean; schedule(): void; release(): void };
let hub: Hub | null = null;
/** For tests: how many contexts exist now (0 or 1). */
export const sharedGLContexts = () => hub?.gl ? 1 : 0;

function createHub(host: Host): Hub {
  let canvas: SharedGLCanvas | null = null, gl: GLContext | null = null, frame = 0, budget: number = GL_LIMITS.budget.start;
  try {
    canvas = (host.document?.createElement?.('canvas') as SharedGLCanvas | undefined) ?? null;
    if (canvas) { canvas.width = 256; canvas.height = 256; gl = canvas.getContext('webgl', { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false }) as GLContext | null; }
  } catch { gl = null; }
  const now = () => host.performance?.now() ?? Date.now();
  const self: Hub = { host, clients: new Set(), canvas, gl, lost: false,
    // Ask for a frame when some drawing wants one; drop the pending one when none does any more.
    schedule() {
      const wanted = !!gl && !self.lost && [...self.clients].some(c => c.ready() && (c.fresh || c.animated()));
      if (wanted && !frame) frame = host.requestAnimationFrame(tick); else if (!wanted && frame) { host.cancelAnimationFrame(frame); frame = 0; }
    },
    release() {
      if (frame) host.cancelAnimationFrame(frame); frame = 0;
      canvas?.removeEventListener('webglcontextlost', onLost); canvas?.removeEventListener('webglcontextrestored', onRestored);
      try { gl?.getExtension('WEBGL_lose_context')?.loseContext?.(); } catch {}
      if (hub === self) hub = null;
    },
  };
  const onLost = (event: { preventDefault(): void }) => { event.preventDefault(); self.lost = true; if (frame) host.cancelAnimationFrame(frame); frame = 0; for (const c of [...self.clients]) c.lost(); };
  const onRestored = () => { self.lost = false; for (const c of [...self.clients]) { c.fresh = true; c.start(gl); } self.schedule(); };
  canvas?.addEventListener('webglcontextlost', onLost); canvas?.addEventListener('webglcontextrestored', onRestored);
  const tick = (time: number) => {
    frame = 0; if (!gl || !canvas || self.lost) return;
    const list = [...self.clients].filter(c => c.ready() && (c.fresh || c.animated())), sizes = list.map(c => c.pixels());
    const candidates = list.flatMap((c, i) => sizes[i] ? [{ id: String(i), pixels: sizes[i]!.width * sizes[i]!.height, fresh: c.fresh, last: c.last }] : []);
    const chosen = planGLFrame(candidates, budget), started = now(); let spent = 0;
    for (const id of chosen) {
      const c = list[Number(id)], size = sizes[Number(id)]!;
      if (canvas.width < size.width || canvas.height < size.height) {
        const grow = (have: number, need: number) => have >= need ? have : Math.min(GL_LIMITS.edge, Math.ceil(need / 256) * 256);
        canvas.width = grow(canvas.width, size.width); canvas.height = grow(canvas.height, size.height);
      }
      c.fresh = false; c.last = time; spent += size.width * size.height;
      gl.viewport(0, 0, size.width, size.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      c.draw(gl, size, time, canvas);
      if (self.lost) return;
    }
    budget = nextGLBudget(budget, spent, now() - started);
    // Another frame only for what is still moving or still waiting its turn; a drawing without a size waits for a resize.
    if (candidates.some(c => list[Number(c.id)].fresh || list[Number(c.id)].animated())) self.schedule();
  };
  return self;
}
/** Join the shared context. `wake` asks for a frame, `update` re-reads what the drawings want (one went off screen);
 * `leave` drops the drawing, and the context with the last one. */
export function joinSharedGL(client: GLClient, host: Host = globalThis as unknown as Host): { wake(): void; update(): void; leave(): void } {
  const current = hub && hub.host === host ? hub : (hub?.release(), hub = createHub(host));
  current.clients.add(client); if (current.lost) client.lost(); else client.start(current.gl); current.schedule();
  return {
    wake() { client.fresh = true; current.schedule(); }, update() { current.schedule(); },
    leave() { if (!current.clients.delete(client)) return; if (!current.clients.size) current.release(); else current.schedule(); },
  };
}
