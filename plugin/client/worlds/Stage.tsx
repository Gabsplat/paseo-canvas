import React, { useRef, useState } from 'react';
import { View } from 'react-native';
import { reducedMotion } from '../motion';
import { ZOOM, ZoomPill } from '../Pannable';
import { CanvasSurface, type Canvas2DContext, type SurfaceFrame, type SurfacePointer, type SurfaceWheel } from '../Surfaces';
import { tokens } from '../tokens';
import { Txt, useUI } from '../ui';
import { clamp } from './shared';

/** The safe area of a stage in CSS pixels: clear of the title island, the heading, the composer and the zoom control. */
export const STAGE_INSET = { top: 148, right: 32, bottom: 128, left: 32 } as const;
const SIDE = 300;
type Cam = { scale: number; x: number; y: number };
/**
 * What a world knows while it draws: how far in the camera is, the clock, the part of the world on screen, and
 * where the pointer is in world units. A world draws in its own fixed coordinates and never thinks about the frame.
 */
export type Sight = { scale: number; time: number; dt: number; width: number; height: number; left: number; top: number; right: number; bottom: number; pointer: { x: number; y: number } | null; screen(x: number, y: number): { x: number; y: number } };
export type Legend = { color: string; shape?: 'dot' | 'line' | 'bar' | 'ring'; text: string };

/**
 * The frame every world is drawn in: one drawing surface with a camera you move like the canvas (wheel pans,
 * command-wheel or a pinch zooms around the pointer, a drag on the surface pans, a double press on nothing fits).
 * The name, the question the world answers and how to read it stay in the corner. `summary` is what a screen
 * reader, or a device without a canvas, gets instead of the drawing.
 */
export function Stage({ id, title, question, summary, legend = [], bounds, fitKey = '', draw, overlay, hit, onPress, onHover, side, children }: {
  id: string; title: string; question: string; summary: string; legend?: Legend[]; bounds: { x: number; y: number; width: number; height: number }; fitKey?: string;
  draw(ctx: Canvas2DContext, sight: Sight): void; overlay?(ctx: Canvas2DContext, sight: Sight): void;
  hit?(x: number, y: number, sight: Sight): string | null; onPress?(id: string | null): void; onHover?(id: string | null): void;
  side?: React.ReactNode; children?: React.ReactNode;
}) {
  const u = useUI(), [box, setBox] = useState({ width: 0, height: 0 }), [percent, setPercent] = useState(100), [cursor, setCursor] = useState<'grab' | 'grabbing' | 'pointer'>('grab');
  const cam = useRef<Cam>({ scale: 1, x: 0, y: 0 }), goal = useRef<Cam | null>(null), fitted = useRef<string | null>(null), last = useRef(0), size = useRef({ width: 0, height: 0 }), shown = useRef(100);
  const held = useRef<{ x: number; y: number; cam: Cam; moved: boolean } | null>(null), at = useRef<{ x: number; y: number } | null>(null), over = useRef<string | null>(null), tapped = useRef(0), sight = useRef<Sight | null>(null);
  const latest = useRef({ bounds, hit, onPress, onHover }); latest.current = { bounds, hit, onPress, onHover };
  const inset = { top: u.compact ? 120 : STAGE_INSET.top, left: STAGE_INSET.left, bottom: STAGE_INSET.bottom, right: side && !u.compact ? SIDE + 48 : STAGE_INSET.right };
  const fit = (): Cam | null => {
    const b = latest.current.bounds, w = size.current.width - inset.left - inset.right, h = size.current.height - inset.top - inset.bottom; if (w < 40 || h < 40 || !(b.width > 0) || !(b.height > 0)) return null;
    const scale = clamp(Math.min(w / b.width, h / b.height), ZOOM.min, 1.2); return { scale, x: inset.left + w / 2 - (b.x + b.width / 2) * scale, y: inset.top + h / 2 - (b.y + b.height / 2) * scale };
  };
  const zoomAt = (sx: number, sy: number, to: number, fly: boolean) => { const c = goal.current ?? cam.current, s = clamp(to, ZOOM.min, ZOOM.max), next = { scale: s, x: sx - (sx - c.x) / c.scale * s, y: sy - (sy - c.y) / c.scale * s }; if (fly && !reducedMotion.current) goal.current = next; else { goal.current = null; cam.current = next; } };
  const world = (sx: number, sy: number) => ({ x: (sx - cam.current.x) / cam.current.scale, y: (sy - cam.current.y) / cam.current.scale });
  const paint = (ctx: Canvas2DContext, frame: SurfaceFrame) => {
    size.current = frame;
    if (fitted.current !== fitKey) { const f = fit(); if (f) { if (fitted.current === null || reducedMotion.current) cam.current = f; else goal.current = f; fitted.current = fitKey; } }
    const dt = last.current ? clamp(frame.time - last.current, 0, 64) : 16; last.current = frame.time;
    if (goal.current) { const c = cam.current, g = goal.current, k = 1 - Math.exp(-dt / 110); cam.current = { scale: c.scale + (g.scale - c.scale) * k, x: c.x + (g.x - c.x) * k, y: c.y + (g.y - c.y) * k };
      if (Math.abs(g.scale - c.scale) < .001 && Math.abs(g.x - c.x) + Math.abs(g.y - c.y) < .5) { cam.current = g; goal.current = null; } }
    const c = cam.current, p = Math.round(c.scale * 100); if (p !== shown.current) { shown.current = p; setPercent(p); }
    const s: Sight = { scale: c.scale, time: frame.time, dt, width: frame.width, height: frame.height, left: -c.x / c.scale, top: -c.y / c.scale, right: (frame.width - c.x) / c.scale, bottom: (frame.height - c.y) / c.scale,
      pointer: at.current ? world(at.current.x, at.current.y) : null, screen: (x, y) => ({ x: x * c.scale + c.x, y: y * c.scale + c.y }) };
    sight.current = s; ctx.clearRect(0, 0, frame.width, frame.height);
    ctx.save(); try { ctx.translate(c.x, c.y); ctx.scale(c.scale, c.scale); draw(ctx, s); } finally { ctx.restore(); }
    if (overlay) { ctx.save(); try { overlay(ctx, s); } finally { ctx.restore(); } }
  };
  const under = (sx: number, sy: number) => { const w = world(sx, sy); return sight.current ? latest.current.hit?.(w.x, w.y, sight.current) ?? null : null; };
  const hover = (next: string | null) => { if (next !== over.current) { over.current = next; latest.current.onHover?.(next); } setCursor(held.current?.moved ? 'grabbing' : next ? 'pointer' : 'grab'); };
  const pointer = (e: SurfacePointer) => {
    if (e.kind === 'down') { held.current = { x: e.x, y: e.y, cam: { ...cam.current }, moved: false }; at.current = { x: e.x, y: e.y }; return; }
    if (e.kind === 'move') {
      at.current = { x: e.x, y: e.y }; const h = held.current;
      if (h && e.buttons) { if (!h.moved && Math.hypot(e.x - h.x, e.y - h.y) > 4) { h.moved = true; goal.current = null; setCursor('grabbing'); } if (h.moved) cam.current = { scale: h.cam.scale, x: h.cam.x + e.x - h.x, y: h.cam.y + e.y - h.y }; return; }
      hover(under(e.x, e.y)); return;
    }
    const h = held.current; held.current = null; if (e.kind === 'cancel') { at.current = null; hover(null); return; }
    if (h && !h.moved) { const id = under(e.x, e.y), now = Date.now();
      if (!id && now - tapped.current < 350) { const f = fit(); if (f) { if (reducedMotion.current) cam.current = f; else goal.current = f; } tapped.current = 0; } else tapped.current = id ? 0 : now;
      latest.current.onPress?.(id); }
    hover(under(e.x, e.y));
  };
  const wheel = (e: SurfaceWheel) => { if (e.command) zoomAt(e.x, e.y, (goal.current ?? cam.current).scale * Math.exp(-e.dy * .002), Math.abs(e.dy) >= 60); else { goal.current = null; cam.current = { ...cam.current, x: cam.current.x - e.dx, y: cam.current.y - e.dy }; } };
  const mid = () => ({ x: (inset.left + size.current.width - inset.right) / 2, y: (inset.top + size.current.height - inset.bottom) / 2 });
  const glyph = (l: Legend) => l.shape === 'line' ? { width: 16, height: 3, borderRadius: 2, backgroundColor: l.color } : l.shape === 'bar' ? { width: 12, height: 10, borderRadius: 2, backgroundColor: l.color } : l.shape === 'ring' ? { width: 11, height: 11, borderRadius: 6, borderWidth: 2, borderColor: l.color } : { width: 10, height: 10, borderRadius: 5, backgroundColor: l.color };
  return <View nativeID={`lienzo-world-${id}`} onLayout={e => setBox(e.nativeEvent.layout)} style={{ flex: 1, backgroundColor: u.c.surface0, overflow: 'hidden', ...({ cursor } as object) }}>
    {box.height > 0 && <CanvasSurface id={`world-${id}`} label={`${title}. ${summary}`} summary={summary} height={box.height} animated draw={paint} onPointer={pointer} onWheel={wheel} />}
    <View pointerEvents="none" style={{ position: 'absolute', left: u.compact ? 16 : tokens.island.inset + 4, top: u.compact ? 12 : tokens.island.bannerTop, maxWidth: 440, gap: 2 }}>
      <Txt kind="heading">{title}</Txt><Txt kind="small" muted>{question}</Txt>
      {!u.compact && !!legend.length && <View nativeID={`lienzo-world-${id}-legend`} style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 4, marginTop: 6 }}>{legend.map(l => <View key={l.text} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><View style={glyph(l)} /><Txt kind="label" muted>{l.text}</Txt></View>)}</View>}
    </View>
    {!!side && <View nativeID={`lienzo-world-${id}-side`} style={{ position: 'absolute', right: u.compact ? 12 : STAGE_INSET.right, top: u.compact ? undefined : 20, bottom: u.compact ? STAGE_INSET.bottom : undefined, left: u.compact ? 12 : undefined, width: u.compact ? undefined : SIDE, maxHeight: Math.max(160, box.height - STAGE_INSET.bottom - 20), borderRadius: 12, borderWidth: 1, borderColor: u.c.border, backgroundColor: u.c.surface1, padding: 14, gap: 10 }}>{side}</View>}
    {children}
    <ZoomPill percent={percent} onOut={() => { const m = mid(); zoomAt(m.x, m.y, (goal.current ?? cam.current).scale / ZOOM.step, true); }} onIn={() => { const m = mid(); zoomAt(m.x, m.y, (goal.current ?? cam.current).scale * ZOOM.step, true); }}
      onActual={() => { const m = mid(); zoomAt(m.x, m.y, 1, true); }} onFit={() => { const f = fit(); if (f) { if (reducedMotion.current) cam.current = f; else goal.current = f; } }} />
  </View>;
}
