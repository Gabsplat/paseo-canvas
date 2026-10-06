import { Platform } from 'react-native';
import type { WbColor, WbScale } from '../shared/whiteboard';
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
