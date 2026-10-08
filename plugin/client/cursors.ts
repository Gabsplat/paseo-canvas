import { tokens } from './tokens';
import type { CanvasTool } from './whiteboard-tools';

/**
 * Lienzo's own cursors, drawn in the theme's ink over a paper halo so they read on any surface, with the accent
 * marking the exact point that acts. Each is a CSS cursor value: an inline SVG, its hot spot, and the system
 * cursor to fall back on. No DOM here, only strings.
 */
export type CanvasCursors = Record<'select' | 'hand' | 'handActive' | 'text' | 'shape' | 'draw' | 'eraser', string>;
const C = tokens.whiteboard.tools.cursor, S = C.size;
const css = (body: string, x: number, y: number, fallback: string, size: number = S) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 ${size} ${size}'>${body}</svg>`)}") ${x} ${y}, ${fallback}`;
/** A stroked figure twice: wide in paper underneath, thin in ink on top. */
const lined = (paths: string, ink: string, paper: string, width = C.line) =>
  `<g fill='none' stroke-linecap='round' stroke-linejoin='round'><g stroke='${paper}' stroke-width='${width + C.halo}'>${paths}</g><g stroke='${ink}' stroke-width='${width}'>${paths}</g></g>`;
const openHand = "<path d='M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2'/><path d='M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2'/><path d='M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8'/><path d='M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15'/>";
const closedHand = "<path d='M18 11.5V9a2 2 0 0 0-2-2a2 2 0 0 0-2 2v1.4'/><path d='M14 10V8a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2'/><path d='M10 9.9V9a2 2 0 0 0-2-2a2 2 0 0 0-2 2v5'/><path d='M6 14a2 2 0 0 0-2-2a2 2 0 0 0-2 2'/><path d='M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-4a8 8 0 0 1-8-8 2 2 0 1 1 4 0'/>";
const cache = new Map<string, CanvasCursors>();
export function canvasCursors(ink: string, paper: string, accent: string): CanvasCursors {
  const key = `${ink}|${paper}|${accent}`, known = cache.get(key); if (known) return known;
  const m = S / 2, gap = 4, arm = 9, r = tokens.whiteboard.draw.eraserRadiusScreen, ring = Math.ceil(r * 2 + 6);
  const cross = `<path d='M${m} ${m - arm}V${m - gap}'/><path d='M${m} ${m + gap}V${m + arm}'/><path d='M${m - arm} ${m}H${m - gap}'/><path d='M${m + gap} ${m}H${m + arm}'/>`;
  const point = `<circle cx='${m}' cy='${m}' r='1.75' fill='${accent}' stroke='${paper}' stroke-width='1'/>`;
  const cursors: CanvasCursors = {
    select: css(`<path d='M5 3v16l4.4-4.1 2.9 6.3 2.6-1.2-2.9-6.2H18z' fill='${ink}' stroke='${paper}' stroke-width='1.5' stroke-linejoin='round'/>`, 5, 3, C.select),
    hand: css(`<path d='M6 14V7h12v7a8 8 0 0 1-8 8z' fill='${paper}' opacity='.9'/>${lined(openHand, ink, paper)}`, m, m, C.hand),
    handActive: css(`<path d='M5 14V9h14v5a8 8 0 0 1-14 0z' fill='${paper}' opacity='.9'/>${lined(closedHand, ink, paper)}`, m, m, C.handActive),
    text: css(lined(`<path d='M${m} 5v14'/><path d='M${m - 3} 4h2a1 1 0 0 1 1 1a1 1 0 0 1 1-1h2'/><path d='M${m - 3} 20h2a1 1 0 0 0 1-1a1 1 0 0 0 1 1h2'/>`, ink, paper), m, m, C.text),
    shape: css(lined(cross, ink, paper) + point, m, m, C.shape),
    draw: css(`<circle cx='${m}' cy='${m}' r='5.5' fill='none' stroke='${paper}' stroke-width='${C.line + C.halo}'/><circle cx='${m}' cy='${m}' r='5.5' fill='none' stroke='${ink}' stroke-width='${C.line}'/>${point}`, m, m, C.draw),
    eraser: css(`<circle cx='${ring / 2}' cy='${ring / 2}' r='${r}' fill='none' stroke='${paper}' stroke-width='${C.line + C.halo}'/><circle cx='${ring / 2}' cy='${ring / 2}' r='${r}' fill='none' stroke='${ink}' stroke-width='${C.line}'/>`, ring / 2, ring / 2, C.eraser, ring),
  };
  cache.set(key, cursors); return cursors;
}
export const cursorForTool = (cursors: CanvasCursors, tool: CanvasTool): string => tool === 'svg' ? cursors.select : cursors[tool];
