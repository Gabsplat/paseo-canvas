import type { PluginHostProps } from '@getpaseo/plugin/client';
import { tokens } from './tokens';
export type Theme = PluginHostProps['theme'];
export type Tone = 'neutro' | 'acento' | 'violeta' | 'turquesa' | 'exito' | 'aviso' | 'riesgo';
export function parseColor(c: string): { r: number; g: number; b: number; a: number } | null {
  const hex = c.match(/^#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i);
  if (hex) {
    let s = hex[1];
    if (s.length === 3) s = [...s].map(x => x + x).join('');
    return { r: parseInt(s.slice(0, 2), 16), g: parseInt(s.slice(2, 4), 16), b: parseInt(s.slice(4, 6), 16), a: s.length === 8 ? parseInt(s.slice(6), 16) / 255 : 1 };
  }
  const rgb = c.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/);
  return rgb ? { r: +rgb[1], g: +rgb[2], b: +rgb[3], a: rgb[4] ? +rgb[4] : 1 } : null;
}
export function withAlpha(c: string, a: number): string {
  const p = parseColor(c);
  return p ? `rgba(${p.r},${p.g},${p.b},${Math.max(0, Math.min(1, a))})` : c;
}
export function isDark(c: string): boolean {
  const p = parseColor(c);
  if (!p) return false;
  const linear = (v: number) => v / 255 <= .04045 ? v / 255 / 12.92 : ((v / 255 + .055) / 1.055) ** 2.4;
  return .2126 * linear(p.r) + .7152 * linear(p.g) + .0722 * linear(p.b) < .4;
}
export function toneColor(tone: Tone, theme: Theme): string {
  const value = tokens.tones[tone][isDark(theme.colors.surface0) ? 'dark' : 'light'];
  return value.startsWith('host:') ? theme.colors[value.slice(5) as keyof Theme['colors']] : value;
}
