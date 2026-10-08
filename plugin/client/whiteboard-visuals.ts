import { Platform } from 'react-native';
import type { WbColor, WbScale, WbShapeData } from '../shared/whiteboard';
import { isDark, withAlpha } from './color';
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
