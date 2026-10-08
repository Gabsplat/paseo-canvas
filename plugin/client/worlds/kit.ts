import type { Canvas2DContext } from '../Surfaces';
import { clamp, fit, FONT, type Palette, type Thing } from './shared';
import type { Sight } from './Stage';

/** The drawing vocabulary the worlds share, so they differ in what they mean and not in how carefully they are made. */
export type Point = { x: number; y: number };
export const areaColor = (p: Palette, index: number) => index < 0 ? p.muted : p.areas[index % p.areas.length];
export function rounded(ctx: Canvas2DContext, x: number, y: number, w: number, h: number, r: number) {
  const k = Math.max(0, Math.min(r, w / 2, h / 2)); ctx.beginPath(); ctx.moveTo(x + k, y); ctx.lineTo(x + w - k, y); ctx.quadraticCurveTo(x + w, y, x + w, y + k); ctx.lineTo(x + w, y + h - k);
  ctx.quadraticCurveTo(x + w, y + h, x + w - k, y + h); ctx.lineTo(x + k, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - k); ctx.lineTo(x, y + k); ctx.quadraticCurveTo(x, y, x + k, y); ctx.closePath();
}
/** Words broken into at most `lines` lines of `max` width; the last one is cut with an ellipsis. Uses the current font. */
export function wrap(ctx: Canvas2DContext, text: string, max: number, lines: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean), out: string[] = []; let line = '';
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(next).width <= max || !line) { line = next; continue; }
    if (out.length === lines - 1) { out.push(fit(ctx, `${line} ${words.slice(i).join(' ')}`, max)); return out; }
    out.push(line); line = words[i];
  }
  if (line) out.push(fit(ctx, line, max)); return out;
}
/** A short text on a pad of the paper colour, so it stays readable over whatever is drawn behind it. */
export function tag(ctx: Canvas2DContext, p: Palette, text: string, x: number, y: number, o: { size?: number; weight?: number; color?: string; align?: 'left' | 'center' | 'right'; pad?: boolean; alpha?: number; k?: number } = {}) {
  const size = (o.size ?? 11) * (o.k ?? 1); ctx.font = `${o.weight ?? 500} ${size}px ${FONT}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  const w = ctx.measureText(text).width, left = o.align === 'center' ? x - w / 2 : o.align === 'right' ? x - w : x;
  if (o.pad !== false) { ctx.fillStyle = p.a(p.paper, o.alpha ?? .82); rounded(ctx, left - 5, y - size * .75, w + 10, size * 1.5, 5); ctx.fill(); }
  ctx.fillStyle = o.color ?? p.muted; ctx.fillText(text, left, y + .5); return w;
}
export const PLATE = { w: 188, h: 64 } as const;
export type PlateState = { dim?: boolean; lit?: boolean; chosen?: boolean; hover?: boolean; badge?: string; badgeColor?: string; w?: number; h?: number; color?: string };
/**
 * A thing as a plate: its area's colour on the edge, its title, and its text once you are close enough to read it.
 * From far away it is only a block of its colour, so a hundred of them still read as a shape.
 */
export function plate(ctx: Canvas2DContext, p: Palette, sight: Sight, t: Thing, cx: number, cy: number, s: PlateState = {}) {
  const w = s.w ?? PLATE.w, h = s.h ?? PLATE.h, x = cx - w / 2, y = cy - h / 2, color = s.color ?? areaColor(p, t.areaIndex), far = sight.scale < .38;
  ctx.save(); ctx.globalAlpha *= s.dim ? .34 : 1;
  if (s.chosen || s.hover || s.lit) { ctx.shadowColor = p.a(s.chosen ? p.accent : color, s.chosen ? .7 : .45); ctx.shadowBlur = (s.chosen ? 26 : 16) * sight.scale; }
  rounded(ctx, x, y, w, h, 10); ctx.fillStyle = far ? p.a(color, .55) : p.surface; ctx.fill(); ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
  ctx.lineWidth = s.chosen ? 2.5 : s.hover || s.lit ? 1.75 : 1; ctx.strokeStyle = s.chosen ? p.accent : s.hover || s.lit ? color : p.border; ctx.stroke();
  if (!far) {
    ctx.save(); rounded(ctx, x, y, w, h, 10); ctx.clip(); ctx.fillStyle = color; ctx.fillRect(x, y, 4, h); ctx.restore();
    const room = w - 26, close = sight.scale >= .85 && !!t.summary && h >= 56, big = clamp(1 / sight.scale, 1, 1.6);
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.font = `600 ${13 * big}px ${FONT}`; ctx.fillStyle = p.ink;
    const title = wrap(ctx, t.title, room, close ? 1 : 2), lineH = 16 * big, block = title.length * lineH + (close ? 30 : 0); let ty = cy - block / 2 + lineH / 2;
    for (const line of title) { ctx.fillText(line, x + 15, ty); ty += lineH; }
    if (close) { ctx.font = `400 11px ${FONT}`; ctx.fillStyle = p.muted; for (const line of wrap(ctx, t.summary, room, 2)) { ctx.fillText(line, x + 15, ty + 1); ty += 14; } }
  }
  if (s.badge) { ctx.font = `700 11px ${FONT}`; const bw = Math.max(20, ctx.measureText(s.badge).width + 12); rounded(ctx, x + w - bw + 6, y - 9, bw, 20, 10); ctx.fillStyle = s.badgeColor ?? p.accent; ctx.fill(); ctx.fillStyle = p.paper; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(s.badge, x + w - bw / 2 + 6, y + 1.5); }
  ctx.restore();
}
/** A point on the quadratic from `a` to `b` bent through `c`. */
export const along = (a: Point, c: Point, b: Point, t: number): Point => ({ x: (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * c.x + t * t * b.x, y: (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * c.y + t * t * b.y });
/** The control point of a gentle bend between two points: `bend` is the sag as a fraction of the distance. */
export const bend = (a: Point, b: Point, amount: number): Point => ({ x: (a.x + b.x) / 2 - (b.y - a.y) * amount, y: (a.y + b.y) / 2 + (b.x - a.x) * amount });
export function arrow(ctx: Canvas2DContext, from: Point, to: Point, size: number) {
  const a = Math.atan2(to.y - from.y, to.x - from.x); ctx.beginPath(); ctx.moveTo(to.x, to.y); ctx.lineTo(to.x - size * Math.cos(a - .45), to.y - size * Math.sin(a - .45)); ctx.lineTo(to.x - size * Math.cos(a + .45), to.y - size * Math.sin(a + .45)); ctx.closePath(); ctx.fill();
}
/** What the pointer is over, said in a small card beside it. Drawn in screen pixels, so it never scales. */
export function tooltip(ctx: Canvas2DContext, p: Palette, sight: Sight, at: Point, title: string, lines: string[]) {
  const s = sight.screen(at.x, at.y), max = 250; ctx.font = `600 13px ${FONT}`; const head = wrap(ctx, title, max, 2); ctx.font = `400 12px ${FONT}`; const body = lines.filter(Boolean).flatMap(l => wrap(ctx, l, max, 3));
  ctx.font = `600 13px ${FONT}`; let w = Math.max(...head.map(l => ctx.measureText(l).width)); ctx.font = `400 12px ${FONT}`; for (const l of body) w = Math.max(w, ctx.measureText(l).width);
  const bw = w + 24, bh = 18 + head.length * 17 + body.length * 16 + (body.length ? 4 : 0), x = clamp(s.x + 18, 8, sight.width - bw - 8), y = clamp(s.y + 18, 8, sight.height - bh - 8);
  ctx.shadowColor = p.a(p.paper, .9); ctx.shadowBlur = 18; rounded(ctx, x, y, bw, bh, 10); ctx.fillStyle = p.surface; ctx.fill(); ctx.shadowBlur = 0; ctx.shadowColor = 'transparent'; ctx.lineWidth = 1; ctx.strokeStyle = p.border; ctx.stroke();
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; let ty = y + 18; ctx.font = `600 13px ${FONT}`; ctx.fillStyle = p.ink; for (const l of head) { ctx.fillText(l, x + 12, ty); ty += 17; }
  ty += body.length ? 3 : 0; ctx.font = `400 12px ${FONT}`; ctx.fillStyle = p.muted; for (const l of body) { ctx.fillText(l, x + 12, ty); ty += 16; }
}
/** How much marks and words grow when the camera is far, so a whole world fitted on screen can still be read. */
export const legible = (sight: Sight) => clamp(1 / sight.scale, 1, 1.75);
/** Positions that travel to where they are told instead of jumping, so a change of mind is something you can follow. */
export class Drift {
  private now = new Map<string, Point>();
  step(targets: Map<string, Point>, dt: number, still: boolean, from?: Point): Map<string, Point> {
    const k = still ? 1 : 1 - Math.exp(-dt / 170), next = new Map<string, Point>();
    for (const [id, to] of targets) { const at = this.now.get(id) ?? from ?? to; next.set(id, { x: at.x + (to.x - at.x) * k, y: at.y + (to.y - at.y) * k }); }
    this.now = next; return next;
  }
}
