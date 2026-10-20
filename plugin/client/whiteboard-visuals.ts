import { Platform } from 'react-native';
import { WB_COLORS, type WbColor, type WbScale, type WbShapeData } from '../shared/whiteboard';
import { boundOf } from '../shared/bindings';
import { isDark, parseColor, withAlpha } from './color';
import { tokens } from './tokens';
import type { useUI } from './ui';
export function wbColor(role: WbColor, u: ReturnType<typeof useUI>): string {
  if (role === 'tinta') return u.c.foreground;
  if (role === 'gris') return u.c.foregroundMuted;
  if (role === 'rojo') return u.c.statusDanger;
  const series = tokens.viz.series.find(s => s.id === role);
  return series?.[isDark(u.c.surface0) ? 'dark' : 'light'] ?? u.c.foreground;
}
export const wbWeight = (scale: WbScale) => tokens.whiteboard.weight[scale];
export const wbFont = (family: 'sans' | 'serif' | 'mono') => family === 'mono' ? Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, Menlo, Consolas, monospace' }) : family === 'serif' ? Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia, "Iowan Old Style", serif' }) : undefined;
/**
 * Free text's type on the canvas, shared by the saved text and its editor so the two set the same glyphs in the same
 * lines: family, size, line height, weight, colour and alignment. `k` scales it live while a corner handle is held.
 */
export function wbTextStyle(data: { color: WbColor; font: 'sans' | 'serif' | 'mono'; align: 'left' | 'center' | 'right' }, type: { fontSize: number; lineHeight: number }, u: ReturnType<typeof useUI>, k = 1) {
  return { fontFamily: wbFont(data.font), fontSize: type.fontSize * k, lineHeight: type.lineHeight * k, fontWeight: tokens.whiteboard.text.weight as '400', letterSpacing: 0, color: wbColor(data.color, u), textAlign: data.align };
}
export function islandStyle(u: ReturnType<typeof useUI>, popover = false) {
  const dark = isDark(u.c.surface0), t = tokens.elevation[popover ? 'popover' : 'island'];
  return { backgroundColor: u.c.surface1, borderRadius: tokens.island.radius, borderWidth: 1, borderColor: u.c.border, padding: tokens.island.padding, gap: tokens.island.gap,
    elevation: t.androidElevation, boxShadow: t[dark ? 'dark' : 'light'].map(([x,y,blur,spread,alpha]) => `${x}px ${y}px ${blur}px ${spread}px ${withAlpha(dark ? '#000000' : u.c.foreground, alpha)}`).join(', ') };
}
/**
 * Everything a shape paints, in one place so the label and its editor can never disagree:
 * outline, interior, and a label sized by the same S/M/L/XL step as the outline.
 */
export function shapeLook(data: Pick<WbShapeData, 'shape' | 'color' | 'fill' | 'fillColor' | 'weight'>, u: ReturnType<typeof useUI>) {
  const stroke = wbColor(data.color, u), weight = wbWeight(data.weight), filled = data.shape !== 'line' && data.fill !== 'none';
  const interior = wbColor(data.fillColor ?? data.color, u), solid = filled && data.fill === 'solid';
  // On a solid interior the label takes whichever of paper/ink reads against it.
  const text = solid ? (isDark(interior) === isDark(u.c.surface0) ? u.c.foreground : u.c.surface0) : stroke;
  const label = tokens.whiteboard.shape.label;
  return { stroke, weight, fill: !filled ? 'none' : solid ? interior : withAlpha(interior, tokens.whiteboard.fill.wash), text, ...label.sizes[data.weight], padding: label.padding };
}
/** A colour a binding gives (shared/bindings.ts BoundColor): a whiteboard role, #rrggbb, or a hue lit for the theme. */
export function boundColor(value: unknown, u: ReturnType<typeof useUI>): string | undefined {
  if (typeof value !== 'string') return undefined;
  if ((WB_COLORS as readonly string[]).includes(value)) return wbColor(value as WbColor, u);
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  const hue = /^hue:(-?\d+(?:\.\d+)?)$/.exec(value); if (!hue) return undefined;
  const H = tokens.face.bindings.hue; return hslHex(Number(hue[1]), H.saturation, isDark(u.c.surface0) ? H.darkLightness : H.lightLightness);
}
export function hslHex(h: number, s: number, l: number): string {
  const a = s / 100 * Math.min(l / 100, 1 - l / 100), k = (n: number) => (n + h / 30) % 12;
  const c = (n: number) => Math.round(255 * (l / 100 - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))).toString(16).padStart(2, '0');
  return `#${c(0)}${c(8)}${c(4)}`;
}
/**
 * shapeLook with what a block's bindings change: outline and fill colour, outline width, label size and text. A bound
 * fill paints the interior even when the shape's fill is none; on a wash it keeps the wash.
 */
export function boundShapeLook(block: object, data: WbShapeData, u: ReturnType<typeof useUI>) {
  const look = shapeLook(data, u), v = boundOf(block);
  if (!v) return { ...look, label: data.text, radius: undefined as number | undefined };
  const stroke = boundColor(v['stroke.color'], u) ?? look.stroke;
  // A fill without its own colour takes the outline's, bound or not.
  const interior = boundColor(v['fill.color'], u) ?? (!data.fillColor && v['stroke.color'] !== undefined && data.fill !== 'none' ? stroke : undefined);
  const painted = data.shape !== 'line' && !!interior, wash = data.fill === 'wash';
  const fill = painted ? wash ? withAlpha(interior!, tokens.whiteboard.fill.wash) : interior! : look.fill;
  const solid = painted ? wash ? undefined : interior : data.fill === 'solid' && data.shape !== 'line' ? look.fill : undefined;
  const size = typeof v['text.size'] === 'number' ? v['text.size'] : undefined;
  return { ...look, stroke, fill, text: solid ? readableOn(solid, [u.c.foreground, u.c.surface0]) : stroke,
    weight: typeof v['stroke.width'] === 'number' ? v['stroke.width'] : look.weight, label: typeof v['text.template'] === 'string' ? v['text.template'] : data.text,
    ...(size ? { fontSize: size, lineHeight: Math.round(size * look.lineHeight / look.fontSize) } : {}), radius: typeof v['corner.radius'] === 'number' ? v['corner.radius'] : undefined };
}
/** Text and its size as bound (text.template, text.size); the stored ones otherwise. Line height keeps its ratio. */
export function boundText(block: object, text: string, fontSize: number, lineHeight: number): { text: string; fontSize: number; lineHeight: number } {
  const v = boundOf(block), size = typeof v?.['text.size'] === 'number' ? v['text.size'] : undefined;
  return { text: typeof v?.['text.template'] === 'string' ? v['text.template'] : text, fontSize: size ?? fontSize, lineHeight: size ? Math.round(size * lineHeight / fontSize) : lineHeight };
}
const luminance = (c: string) => { const p = parseColor(c); if (!p) return 0; const l = (v: number) => v / 255 <= .04045 ? v / 255 / 12.92 : ((v / 255 + .055) / 1.055) ** 2.4; return .2126 * l(p.r) + .7152 * l(p.g) + .0722 * l(p.b); };
/** Of the candidates, the one with the most contrast on `background`: a bound hue can land anywhere in lightness. */
export function readableOn(background: string, candidates: readonly string[]): string {
  const bg = luminance(background), ratio = (c: string) => { const l = luminance(c); return (Math.max(l, bg) + .05) / (Math.min(l, bg) + .05); };
  return candidates.reduce((best, c) => ratio(c) > ratio(best) ? c : best);
}
