// The only browser/DOM adapter. Loading this module never touches the DOM on native.
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { safeUrl } from './logic';
import { tokens } from './tokens';
import { frameSandbox } from './media';
interface BrowserEventTarget {
  addEventListener(name: string, listener: (event: BrowserKeyEvent) => void, capture?: boolean): void;
  removeEventListener(name: string, listener: (event: BrowserKeyEvent) => void, capture?: boolean): void;
}
interface BrowserElement extends BrowserEventTarget {
  href: string; download: string;
  type: string; accept: string; files?: { length: number; [index: number]: { size: number; text(): Promise<string> } };
  appendChild(child: BrowserElement): void; click(): void; remove(): void;
  closest(selector: string): BrowserElement | null;
  querySelector(selector: string): (BrowserElement & { focus(): void }) | null;
  getBoundingClientRect(): { left: number; top: number };
}
interface BrowserKeyEvent { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; target: BrowserElement | null; preventDefault(): void; stopPropagation(): void; deltaX: number; deltaY: number; clientX: number; clientY: number }
interface BrowserHost {
  document?: BrowserEventTarget & { hidden?: boolean; body: BrowserElement; createElement(tag: string): BrowserElement };
  location?: { origin: string };
  Blob: new (parts: string[], options: { type: string }) => unknown;
  URL: { createObjectURL(blob: unknown): string; revokeObjectURL(url: string): void };
}
const browser = () => (Platform.OS === 'web' ? globalThis : {}) as unknown as BrowserHost;
let lastInputWasKeyboard = false, stopFocusTracking: (() => void) | undefined;
const focusSubscribers = new Set<() => void>();
function setKeyboardInput(value: boolean) {
  if (value === lastInputWasKeyboard) return;
  lastInputWasKeyboard = value; focusSubscribers.forEach(listener => listener());
}
function subscribeKeyboardInput(listener: () => void) {
  const doc = browser().document;
  if (!doc) return () => {};
  focusSubscribers.add(listener);
  if (!stopFocusTracking) {
    const keydown = (event: BrowserKeyEvent) => { if (event.key === 'Tab' || event.key.startsWith('Arrow')) setKeyboardInput(true); };
    const pointerdown = () => setKeyboardInput(false);
    doc.addEventListener('keydown', keydown, true); doc.addEventListener('pointerdown', pointerdown, true);
    stopFocusTracking = () => { doc.removeEventListener('keydown', keydown, true); doc.removeEventListener('pointerdown', pointerdown, true); };
  }
  return () => { focusSubscribers.delete(listener); if (!focusSubscribers.size) { stopFocusTracking?.(); stopFocusTracking = undefined; lastInputWasKeyboard = false; } };
}
const noKeyboardInput = () => false, noFocusSubscription = () => () => {};
/** Browser modality changes also clear the ring on an already focused control. */
export function useKeyboardFocus(web: boolean) {
  return useSyncExternalStore(web ? subscribeKeyboardInput : noFocusSubscription, web ? () => lastInputWasKeyboard : noKeyboardInput, noKeyboardInput);
}
export function WebFrame({ url, title, border, height, surface, player = false, onLoaded, onTimeout }: { url: string; title: string; border: string; height: number | '100%'; surface: string; player?: boolean; onLoaded?: () => void; onTimeout?: () => void }) {
  const safe = safeUrl(url), [loaded, setLoaded] = useState(false);
  useEffect(() => { if (Platform.OS !== 'web') return; setLoaded(false); const timer = setTimeout(() => onTimeout?.(), 8000); return () => clearTimeout(timer); }, [safe]);
  if (Platform.OS !== 'web' || !safe) return null;
  return React.createElement('div', { id: `lienzo-interactive-frame-${title}`, style: { position: 'relative', height, width: '100%', border: `1px solid ${border}`, borderRadius: 6, overflow: 'hidden', backgroundColor: surface } },
    React.createElement('iframe', { key: safe, src: safe, title, sandbox: frameSandbox(safe, browser().location?.origin), referrerPolicy: 'strict-origin-when-cross-origin', loading: 'lazy', allow: player ? 'encrypted-media; fullscreen; picture-in-picture' : 'fullscreen', allowFullScreen: true, onLoad: () => { setLoaded(true); onLoaded?.(); }, style: { width: '100%', height: '100%', border: 0, opacity: loaded ? 1 : 0 }, 'aria-label': loaded ? title : `Cargando ${title}` }));
}
/** Uses browser controls, with no playback loop in React. No media implementation is loaded on native. */
export function WebMedia({ url, title, kind, height, surface, onError }: { url: string; title: string; kind: 'video' | 'audio'; height: number | '100%'; surface: string; onError: () => void }) {
  const element = useRef<{ pause(): void } | null>(null), safe = safeUrl(url);
  useEffect(() => {
    const doc = browser().document; if (!doc || !element.current) return;
    const media = element.current;
    const visibility = () => { if (doc.hidden) media.pause(); };
    const host = globalThis as unknown as { IntersectionObserver?: new (cb: (entries: { isIntersecting: boolean }[]) => void) => { observe(node: unknown): void; disconnect(): void } };
    const observer = host.IntersectionObserver ? new host.IntersectionObserver(entries => { if (entries.some(e => !e.isIntersecting)) media.pause(); }) : null;
    observer?.observe(media); doc.addEventListener('visibilitychange', visibility);
    return () => { observer?.disconnect(); doc.removeEventListener('visibilitychange', visibility); media.pause(); };
  }, [safe, kind]);
  if (Platform.OS !== 'web' || !safe) return null;
  return React.createElement(kind, { key: safe, ref: element, src: safe, controls: true, preload: tokens.media[kind].preload, playsInline: true, 'aria-label': title, onError, style: { display: 'block', width: '100%', height: kind === 'audio' ? tokens.media.audio.height : height, borderRadius: 6, backgroundColor: surface, objectFit: 'contain' } });
}
// Legacy exports for the isolated design harness only. The plugin uses host settings.
const harnessGuideDismissals = new Set<string>();
export function guideWasDismissed(scope: string): boolean { return harnessGuideDismissals.has(scope); }
export function dismissGuide(scope: string) { harnessGuideDismissals.add(scope); }
export function downloadJson(value: unknown, filename: string): boolean {
  try { const host = browser(); if (!host.document) return false;
  const blob = new host.Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = host.URL.createObjectURL(blob), a = host.document.createElement('a'); a.href = url; a.download = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  host.document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => host.URL.revokeObjectURL(url), 1000); return true; } catch { return false; }
}
export function pickJsonFile(maxBytes = 1048576): Promise<string | null> {
  const host = browser(); if (!host.document) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const input = host.document!.createElement('input'); input.type = 'file'; input.accept = '.json,application/json';
    const cleanup = () => input.remove();
    input.addEventListener('cancel', () => { cleanup(); resolve(null); });
    input.addEventListener('change', () => { const file = input.files?.[0]; if (!file) { cleanup(); resolve(null); } else if (file.size > maxBytes) { cleanup(); reject(new Error('El archivo supera 1 MB.')); } else void file.text().then(text => { cleanup(); resolve(text); }).catch(error => { cleanup(); reject(error); }); });
    input.click();
  });
}
export function attachWheel(element: unknown, handler: (e: { x: number; y: number; dx: number; dy: number; command: boolean }) => void) {
  const node = element as BrowserElement | null; if (!browser().document || !node?.addEventListener) return () => {};
  const listener = (e: BrowserKeyEvent) => {
    // An active player, page or resized card scrolls independently; command-wheel still zooms the canvas.
    if (!e.ctrlKey && !e.metaKey && e.target?.closest('video,audio,iframe,[id^="lienzo-interactive-"],[id^="lienzo-scroll-"]')) return;
    const origin = node.getBoundingClientRect(); handler({ x: e.clientX - origin.left, y: e.clientY - origin.top, dx: e.deltaX, dy: e.deltaY, command: e.ctrlKey || e.metaKey }); e.preventDefault();
  };
  node.addEventListener('wheel', listener); return () => node.removeEventListener('wheel', listener);
}
// Middle mouse button (wheel click) drags the canvas on both axes, including over blocks.
// `onEnd` receives the release velocity in px/ms (zero when the pointer had stopped), so the canvas can keep gliding.
export function attachMiddlePan(element: unknown, handler: (delta: { dx: number; dy: number }) => void, onEnd?: (velocity: { vx: number; vy: number }) => void) {
  const node = element as BrowserElement | null, doc = browser().document; if (!doc || !node?.addEventListener) return () => {};
  type PointerLike = BrowserKeyEvent & { button?: number };
  let last: { x: number; y: number; t: number } | null = null, velocity = { vx: 0, vy: 0 };
  const down = (e: PointerLike) => { if (e.button !== 1) return; last = { x: e.clientX, y: e.clientY, t: Date.now() }; velocity = { vx: 0, vy: 0 }; handler({ dx: 0, dy: 0 }); e.preventDefault(); e.stopPropagation(); };
  const move = (e: PointerLike) => {
    if (!last) return; const now = Date.now(), dx = e.clientX - last.x, dy = e.clientY - last.y, dt = Math.max(1, now - last.t);
    velocity = { vx: .6 * dx / dt + .4 * velocity.vx, vy: .6 * dy / dt + .4 * velocity.vy }; handler({ dx, dy }); last = { x: e.clientX, y: e.clientY, t: now }; e.preventDefault();
  };
  const up = (e: PointerLike) => { if (last && (e.button === 1 || e.button === undefined)) { const still = Date.now() - last.t > 80; last = null; onEnd?.(still ? { vx: 0, vy: 0 } : velocity); } };
  const cancel = () => { last = null; };
  // mousedown preventDefault stops the browser's middle-click autoscroll; auxclick stops paste/open-link side effects.
  const block = (e: PointerLike) => { if (e.button === 1) e.preventDefault(); };
  node.addEventListener('pointerdown', down, true); node.addEventListener('mousedown', block, true); node.addEventListener('auxclick', block, true);
  doc.addEventListener('pointermove', move, true); doc.addEventListener('pointerup', up, true); doc.addEventListener('pointercancel', cancel, true);
  return () => {
    node.removeEventListener('pointerdown', down, true); node.removeEventListener('mousedown', block, true); node.removeEventListener('auxclick', block, true);
    doc.removeEventListener('pointermove', move, true); doc.removeEventListener('pointerup', up, true); doc.removeEventListener('pointercancel', cancel, true);
  };
}
export function keyboard(element: unknown, handler: (event: { key: string; shift: boolean; command: boolean }) => boolean): () => void {
  const node = element as BrowserElement | null;
  if (!browser().document || !node?.addEventListener) return () => {};
  const listener = (event: BrowserKeyEvent) => {
    const target = event.target;
    if (target?.closest('input,textarea,select,[contenteditable="true"],iframe,video,audio,[id^="lienzo-interactive-"]')) return;
    if (handler({ key: event.key, shift: event.shiftKey, command: event.ctrlKey || event.metaKey })) { event.preventDefault(); event.stopPropagation(); }
  };
  node.addEventListener('keydown', listener); return () => node.removeEventListener('keydown', listener);
}
/**
 * After a drag or a pan the browser still sends a click to whatever is under the pointer when the button comes up,
 * and a Pressable there would take it as a press (selecting, or collapsing a multi-selection). Call this when a
 * gesture that moved ends: the one click that follows is dropped before React sees it. Nothing happens on native.
 */
export function swallowClick() {
  const doc = browser().document; if (!doc) return;
  const stop = (event: BrowserKeyEvent) => { if ((event as BrowserKeyEvent & { detail?: number }).detail !== 0) { event.stopPropagation(); event.preventDefault(); } done(); };
  const timer = setTimeout(() => done(), 300), done = () => { clearTimeout(timer); doc.removeEventListener('click', stop, true); doc.removeEventListener('pointerdown', done, true); doc.removeEventListener('keydown', done, true); };
  doc.addEventListener('click', stop, true);
  // A new press is deliberate. Do not swallow it if the browser never generated a post-drag click.
  doc.addEventListener('pointerdown', done, true); doc.addEventListener('keydown', done, true);
}
/** True when a press starts on something the browser should keep: an input, an embedded page, or text that can be selected. */
export function isTextTarget(target: unknown): boolean {
  if (Platform.OS !== 'web') return false;
  const node = target as (BrowserElement & { nodeType?: number; parentElement?: BrowserElement }) | null, host = globalThis as unknown as { document?: unknown; getComputedStyle?: (element: unknown) => { userSelect?: string; webkitUserSelect?: string } };
  if (!host.document || !node) return false;
  try {
    const element = node.nodeType === 3 ? node.parentElement : node; if (!element?.closest) return false;
    if (element.closest('input,textarea,select,iframe,video,audio,[contenteditable="true"],[id^="lienzo-interactive-"],[id^="lienzo-scroll-"]')) return true;
    const style = host.getComputedStyle?.(element), select = style?.userSelect ?? style?.webkitUserSelect;
    return select === 'text' || select === 'all';
  } catch { return false; }
}
/** Main card/group grab areas, excluding nested action buttons. Native keeps move-based responder negotiation. */
export function isDragHandle(target: unknown): boolean {
  if (Platform.OS !== 'web') return false;
  const node = target as (BrowserElement & { nodeType?: number; parentElement?: BrowserElement }) | null;
  const element = node?.nodeType === 3 ? node.parentElement : node;
  const handle = element?.closest?.('[id^="lienzo-grab-"]');
  return !!handle && (!element?.closest('button') || element.closest('button') === handle);
}
export function focusInput(element: unknown) {
  const node = element as BrowserElement | null;
  if (browser().document) node?.querySelector?.('input,textarea')?.focus();
}
// ---- Connector layer -------------------------------------------------------------------------------------------
// React Native in the Paseo host has no SVG component, so on web the links of the graph canvas are one DOM <svg>
// owned by this module. Components hand over resolved geometry and colours; nothing here reads the theme or the DOM
// outside the element it was given. On native `mountLinkLayer` returns null and the caller draws elbow Views.
export type LinkDraw = {
  key: string; d: string; color: string; width: number; dash: string; opacity: number; interactive: boolean; title: string; shift?: { x: number; y: number };
  arrow: { x: number; y: number; side: 'top' | 'bottom' | 'left' | 'right'; length: number; width: number } | null;
  label: { x: number; y: number; text: string; color: string } | null;
  badge: { x: number; y: number; text: string; fill: string; color: string; radius: number } | null;
};
export type LinkScene = { draws: LinkDraw[]; origin: { x: number; y: number }; halo: string; font: string; labelSize: number; badgeSize: number; hitWidth: number };
interface SvgNode {
  setAttribute(name: string, value: string): void; removeAttribute(name: string): void; appendChild(child: SvgNode): void; remove(): void;
  addEventListener(name: string, listener: (event: { stopPropagation(): void; preventDefault(): void }) => void): void; textContent: string | null;
}
type SvgHost = { document?: { createElementNS(namespace: string, tag: string): SvgNode } };
/** `element` holds the lines (under the cards); `marksElement`, when given, holds labels and counts (over the cards). */
export function mountLinkLayer(element: unknown, handlers: { onPress(key: string): void; onHover(key: string | null): void }, marksElement?: unknown): { update(scene: LinkScene): void; preview(draw: Pick<LinkDraw, 'd' | 'color' | 'width' | 'opacity' | 'dash'> | null): void; destroy(): void } | null {
  if (Platform.OS !== 'web') return null;
  type Host = { appendChild?(child: SvgNode): void } | null;
  const doc = (globalThis as unknown as SvgHost).document, host = element as Host, marksHost = marksElement as Host;
  if (!doc?.createElementNS || !host?.appendChild) return null;
  const make = (tag: string, attributes: Record<string, string> = {}) => { const node = doc.createElementNS('http://www.w3.org/2000/svg', tag); for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value); return node; };
  const surface = () => make('svg', { width: '100%', height: '100%', style: 'position:absolute;left:0;top:0;overflow:visible;pointer-events:none', 'aria-hidden': 'true' });
  const svg = surface(), root = make('g'), lines = make('g'), marks = make('g'), draft = make('path', { fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'pointer-events': 'none', 'data-lienzo-draft': 'true' }); root.appendChild(lines); root.appendChild(draft); svg.appendChild(root); host.appendChild(svg);
  const above = marksHost?.appendChild ? surface() : null;
  if (above) { above.appendChild(marks); marksHost!.appendChild!(above); } else root.appendChild(marks);
  type Entry = { group: SvgNode; line: SvgNode; hit: SvgNode; head: SvgNode; mark: SvgNode; label: SvgNode; badge: SvgNode; badgeDisc: SvgNode; badgeText: SvgNode; tip: SvgNode; seen: boolean; drawn: string };
  const entries = new Map<string, Entry>();
  const entry = (key: string): Entry => {
    let e = entries.get(key); if (e) return e;
    const group = make('g'), line = make('path', { fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }), head = make('path'), tip = make('title');
    const hit = make('path', { fill: 'none', stroke: 'transparent', 'stroke-linecap': 'round' });
    hit.addEventListener('click', event => { event.stopPropagation(); handlers.onPress(key); });
    hit.addEventListener('pointerenter', () => handlers.onHover(key)); hit.addEventListener('pointerleave', () => handlers.onHover(null));
    hit.appendChild(tip); group.appendChild(line); group.appendChild(head); group.appendChild(hit); lines.appendChild(group);
    // Text sits in a later group so no connector ever paints over a label.
    const mark = make('g', { style: 'pointer-events:none' }), label = make('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', 'paint-order': 'stroke', 'stroke-linejoin': 'round' });
    const badge = make('g'), badgeDisc = make('circle'), badgeText = make('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-weight': '700' });
    badge.appendChild(badgeDisc); badge.appendChild(badgeText); mark.appendChild(label); mark.appendChild(badge); marks.appendChild(mark);
    e = { group, line, hit, head, mark, label, badge, badgeDisc, badgeText, tip, seen: true, drawn: '' }; entries.set(key, e); return e;
  };
  const n = (value: number) => String(Math.round(value * 10) / 10);
  return {
    // One path per gesture. Updating it never walks the 150-card document or rewrites its existing connectors.
    preview(draw) {
      if (!draw) { draft.setAttribute('d', ''); return; }
      draft.setAttribute('d', draw.d); draft.setAttribute('stroke', draw.color); draft.setAttribute('stroke-width', n(draw.width)); draft.setAttribute('opacity', n(draw.opacity));
      if (draw.dash) draft.setAttribute('stroke-dasharray', draw.dash); else draft.removeAttribute('stroke-dasharray');
    },
    update(scene) {
      root.setAttribute('transform', `translate(${n(-scene.origin.x)} ${n(-scene.origin.y)})`);
      if (above) marks.setAttribute('transform', `translate(${n(-scene.origin.x)} ${n(-scene.origin.y)})`);
      entries.forEach(e => { e.seen = false; });
      for (const draw of scene.draws) {
        const e = entry(draw.key); e.seen = true;
        // While something is dragged this runs every frame: connectors that did not change are left alone.
        const drawn = JSON.stringify(draw) + scene.halo + scene.labelSize + scene.badgeSize + scene.hitWidth; if (drawn === e.drawn) continue; e.drawn = drawn;
        e.group.setAttribute('transform', draw.shift ? `translate(${n(draw.shift.x)} ${n(draw.shift.y)})` : '');
        e.line.setAttribute('d', draw.d); e.line.setAttribute('stroke', draw.color); e.line.setAttribute('stroke-width', n(draw.width)); e.line.setAttribute('opacity', n(draw.opacity));
        if (draw.dash) e.line.setAttribute('stroke-dasharray', draw.dash); else e.line.removeAttribute('stroke-dasharray');
        e.hit.setAttribute('d', draw.d); e.hit.setAttribute('stroke-width', n(scene.hitWidth)); e.hit.setAttribute('style', draw.interactive ? 'pointer-events:stroke;cursor:pointer' : 'pointer-events:none'); e.tip.textContent = draw.title;
        if (draw.arrow) {
          const { x, y, side, length, width } = draw.arrow, w = width / 2;
          // The tip touches the frame; the base points back along the side the connector arrives on.
          const base = side === 'top' ? [[x - w, y - length], [x + w, y - length]] : side === 'bottom' ? [[x - w, y + length], [x + w, y + length]] : side === 'left' ? [[x - length, y - w], [x - length, y + w]] : [[x + length, y - w], [x + length, y + w]];
          e.head.setAttribute('d', `M${n(x)} ${n(y)} L${n(base[0][0])} ${n(base[0][1])} L${n(base[1][0])} ${n(base[1][1])} Z`); e.head.setAttribute('fill', draw.color); e.head.setAttribute('opacity', n(draw.opacity));
        } else e.head.setAttribute('d', '');
        if (draw.label) {
          e.label.textContent = draw.label.text; e.label.setAttribute('x', n(draw.label.x)); e.label.setAttribute('y', n(draw.label.y)); e.label.setAttribute('fill', draw.label.color);
          e.label.setAttribute('stroke', scene.halo); e.label.setAttribute('stroke-width', '5'); e.label.setAttribute('font-size', n(scene.labelSize)); e.label.setAttribute('font-family', scene.font); e.label.setAttribute('opacity', n(Math.min(1, draw.opacity * 1.6)));
        } else e.label.textContent = '';
        if (draw.badge) {
          e.badge.setAttribute('opacity', n(Math.min(1, draw.opacity * 1.6))); e.badge.setAttribute('transform', `translate(${n(draw.badge.x)} ${n(draw.badge.y)})`);
          e.badgeDisc.setAttribute('r', n(draw.badge.radius)); e.badgeDisc.setAttribute('fill', draw.badge.fill); e.badgeDisc.setAttribute('stroke', scene.halo); e.badgeDisc.setAttribute('stroke-width', '2');
          e.badgeText.textContent = draw.badge.text; e.badgeText.setAttribute('fill', draw.badge.color); e.badgeText.setAttribute('font-size', n(scene.badgeSize)); e.badgeText.setAttribute('font-family', scene.font);
        } else { e.badge.setAttribute('opacity', '0'); e.badgeText.textContent = ''; }
      }
      for (const [key, e] of entries) if (!e.seen) { e.group.remove(); e.mark.remove(); entries.delete(key); }
    },
    destroy() { svg.remove(); above?.remove(); entries.clear(); },
  };
}
