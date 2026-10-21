import type { HostFullScreen } from './host/contract';

/**
 * The page's own full screen through the browser's Fullscreen API: what lienzo.ui.immersive uses where the host has no
 * window of its own to resize (Paseo, the desktop preview). Browsers refuse it without a recent press; then `set`
 * resolves false and Lienzo only hides its UI.
 */
type FullscreenDocument = { fullscreenElement?: unknown; documentElement?: { requestFullscreen?(): Promise<void> }; exitFullscreen?(): Promise<void>; addEventListener?(type: string, listener: () => void): void; removeEventListener?(type: string, listener: () => void): void };
const page = () => (globalThis as { document?: FullscreenDocument }).document;
export const browserFullScreen: HostFullScreen | null = page()?.documentElement?.requestFullscreen ? {
  isOn: () => !!page()?.fullscreenElement,
  async set(on) {
    const d = page(); if (!d) return false;
    try { if (on && !d.fullscreenElement) await d.documentElement?.requestFullscreen?.(); else if (!on && d.fullscreenElement) await d.exitFullscreen?.(); } catch { /* refused: no recent press, or not allowed */ }
    return !!d.fullscreenElement;
  },
  onChange(listener) { const d = page(), run = () => listener(!!page()?.fullscreenElement); d?.addEventListener?.('fullscreenchange', run); return () => d?.removeEventListener?.('fullscreenchange', run); },
} : null;
