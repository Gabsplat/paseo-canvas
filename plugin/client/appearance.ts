import { useSyncExternalStore } from 'react';
import type { HostTheme } from './host';
import { tokens } from './tokens';

/**
 * Appearance (Settings → Appearance, ⌘K "Theme: …"): System follows the host (Paseo's own theme; the operating system
 * in the desktop app), Light and Dark use Lienzo's Papel and Tinta. The choice is kept in the host's `interface`
 * settings; this module holds the live value so every UIProvider, and the desktop shell, switch in the same frame.
 */
export type Appearance = 'system' | 'light' | 'dark';
export const APPEARANCES: readonly { id: Appearance; label: string; detail: string; icon: string }[] = [
  { id: 'system', label: 'System', detail: 'Follows the app around Lienzo.', icon: 'Monitor' },
  { id: 'light', label: 'Light', detail: 'Warm paper, dark ink.', icon: 'Sun' },
  { id: 'dark', label: 'Dark', detail: 'Dark paper, light ink.', icon: 'Moon' },
];
export const isAppearance = (value: unknown): value is Appearance => value === 'system' || value === 'light' || value === 'dark';
/** The next one round the cycle, for the shortcut. */
export const nextAppearance = (current: Appearance): Appearance => current === 'system' ? 'light' : current === 'light' ? 'dark' : 'system';

/** Lienzo's own Papel and Tinta, in the shape a host hands the panel. One object each, so a theme compares by identity. */
function lienzoTheme(dark: boolean): HostTheme {
  const palette = tokens.contributedThemes[dark ? 'lienzo-tinta' : 'lienzo-papel'].colors, status = tokens.mockOnly[dark ? 'dark' : 'light'];
  return { colors: { surface0: palette.background, surface1: palette.raised, surface2: palette.control, border: palette.border, foreground: palette.foreground, foregroundMuted: palette.mutedForeground, accent: palette.accent, accentForeground: status.onAccent, statusSuccess: status.success, statusWarning: status.warning, statusDanger: status.danger } };
}
export const LIENZO_THEMES = { light: lienzoTheme(false), dark: lienzoTheme(true) } as const;
/** Light or dark, as decided: System defers to `systemDark` (the host or the operating system). */
export const resolveDark = (appearance: Appearance, systemDark: boolean) => appearance === 'system' ? systemDark : appearance === 'dark';
/** The theme the panel draws with: the host's own for System, else Papel or Tinta. Applying it twice changes nothing. */
export const themeFor = (appearance: Appearance, host: HostTheme): HostTheme => appearance === 'system' ? host : LIENZO_THEMES[appearance];

// ---- The live choice. Saved settings seed it (`adoptAppearance`); a choice made here wins until the save settles.
let current: Appearance = 'system', chosen = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
export const getAppearance = () => current;
export function subscribeAppearance(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
/** The person's choice: applies at once. */
export function chooseAppearance(next: Appearance) { chosen = true; if (next !== current) { current = next; emit(); } }
/** What the host has saved; ignored while a choice made in this session is newer. */
export function adoptAppearance(saved: unknown, settled = false) {
  if (chosen && !settled) return;
  if (settled) chosen = false;
  const next = isAppearance(saved) ? saved : 'system';
  if (next !== current) { current = next; emit(); }
}
export function useAppearance(): Appearance { return useSyncExternalStore(subscribeAppearance, getAppearance, getAppearance); }
