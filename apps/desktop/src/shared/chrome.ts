// The window's own chrome on macOS: no title bar, the traffic lights drawn over the app's top-left corner.

/**
 * Where macOS draws the traffic lights (`trafficLightPosition`, from the window's top-left). They sit on the row of
 * the panel's top islands: the islands are 12 from the top and 44 tall, so the lights (about 14 tall) are centred on 34.
 */
export const TRAFFIC_LIGHTS = { x: 18, y: 27 } as const;
/** The room they take inside the panel: the top row starts after `left`, the left edge after `top`. */
export const TRAFFIC_LIGHT_INSET = { left: 78, top: 52 } as const;
/** Main → renderer: the window entered (true) or left (false) full screen, where macOS hides the lights. */
export const FULL_SCREEN_CHANNEL = 'lienzo:full-screen';
/** Renderer → main: a PNG of part of the window as drawn now (lienzo.view.snapshot), as a data URL, or null. */
export const CAPTURE_CHANNEL = 'lienzo:capture';
/** The largest picture an extension may ask for, per side, in CSS pixels. */
export const CAPTURE_MAX = 4096;
/** The rectangle to capture, whole pixels inside the window, or null when there is nothing to take. */
export function captureRect(value: unknown, window: { width: number; height: number }): { x: number; y: number; width: number; height: number } | null {
  const r = value as { x?: unknown; y?: unknown; width?: unknown; height?: unknown } | null;
  if (!r || [r.x, r.y, r.width, r.height].some(n => typeof n !== 'number' || !Number.isFinite(n))) return null;
  const x = Math.max(0, Math.floor(r.x as number)), y = Math.max(0, Math.floor(r.y as number));
  const width = Math.min(CAPTURE_MAX, window.width - x, Math.ceil(r.width as number)), height = Math.min(CAPTURE_MAX, window.height - y, Math.ceil(r.height as number));
  return width >= 1 && height >= 1 ? { x, y, width, height } : null;
}
