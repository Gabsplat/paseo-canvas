// The only browser/DOM adapter. Loading this module never touches the DOM on native.
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { safeUrl } from './logic';
import { tokens } from './tokens';
import { frameSandbox } from './media';
import type { LinkMotionSample } from './renderers/types';
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
// RN supplies nativeEvent.source; RN-web 0.21 supplies a browser load event.
// Keep browser image properties in this adapter and use confirmed intrinsic sizes.
export function imageLoadDimensions(event: unknown): { width: number; height: number } | null {
  const nativeEvent = (event as { nativeEvent?: { source?: { width?: number; height?: number }; target?: { naturalWidth?: number; naturalHeight?: number } } } | null)?.nativeEvent;
  const source = nativeEvent?.source;
  const target = browser().document ? nativeEvent?.target : undefined;
  const width = source?.width ?? target?.naturalWidth, height = source?.height ?? target?.naturalHeight;
  return typeof width === 'number' && typeof height === 'number' && Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? { width, height } : null;
}
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
    if (e.target?.closest('[id^="lienzo-interactive-surface-"],[id^="lienzo-interactive-range-"]')) return;
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
  const down = (e: PointerLike) => { if (e.button !== 1 || e.target?.closest('[id^="lienzo-interactive-renderer-"],[id^="lienzo-interactive-surface-"]')) return; last = { x: e.clientX, y: e.clientY, t: Date.now() }; velocity = { vx: 0, vy: 0 }; handler({ dx: 0, dy: 0 }); e.preventDefault(); e.stopPropagation(); };
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
  linkIds?: readonly string[];
  key: string; d: string; color: string; width: number; dash: string; opacity: number; interactive: boolean; title: string; shift?: { x: number; y: number };
  arrow: { x: number; y: number; side: 'top' | 'bottom' | 'left' | 'right'; length: number; width: number } | null;
  label: { x: number; y: number; text: string; color: string } | null;
  badge: { x: number; y: number; text: string; fill: string; color: string; radius: number } | null;
};
export type LinkScene = { draws: LinkDraw[]; origin: { x: number; y: number }; halo: string; font: string; labelSize: number; badgeSize: number; hitWidth: number; motion?: (epochMs: number) => LinkMotionSample };
interface SvgNode {
  setAttribute(name: string, value: string): void; removeAttribute(name: string): void; appendChild(child: SvgNode): void; remove(): void;
  addEventListener(name: string, listener: (event: { stopPropagation(): void; preventDefault(): void }) => void): void; textContent: string | null;
  getTotalLength?(): number; getPointAtLength?(distance: number): { x: number; y: number };
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
  const motionRoot = make('g', { 'pointer-events': 'none', 'data-lienzo-motion': 'true' }); marks.appendChild(motionRoot);
  type MotionEntry = { group: SvgNode; symbol: SvgNode; label: SvgNode };
  const motionEntries: MotionEntry[] = [], paths = new Map<string, { entry: Entry; draw: LinkDraw; length?: number }>();
  const frameHost = globalThis as unknown as DrawingHost, page = browser().document;
  let current: LinkScene | undefined, frame: number | undefined, destroyed = false, visible = !frameHost.IntersectionObserver;
  const stop = () => { if (frame !== undefined) frameHost.cancelAnimationFrame(frame); frame = undefined; };
  const clearMotion = (keep = 0) => { while (motionEntries.length > keep) motionEntries.pop()!.group.remove(); };
  const renderMotion = () => {
    stop();
    if (destroyed || !visible || page?.hidden || !current?.motion) { clearMotion(); return; }
    // RAF's argument is relative to navigation; the runtime anchor uses epoch time.
    const sample = current.motion(Date.now()); let count = 0;
    for (const token of sample.tokens.slice(0, 256)) {
      const path = paths.get(token.linkId);
      if (!path?.entry.line.getPointAtLength || !path.entry.line.getTotalLength || !Number.isFinite(token.progress) || token.progress < 0 || token.progress > 1) continue;
      let point: { x: number; y: number };
      try {
        path.length ??= path.entry.line.getTotalLength();
        if (!Number.isFinite(path.length) || path.length <= 0) continue;
        point = path.entry.line.getPointAtLength(path.length * token.progress);
      } catch { continue; }
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
      let node = motionEntries[count];
      if (!node) {
        const group = make('g'), symbol = make('path'), label = make('text', { x: '0', y: '-13', 'text-anchor': 'middle', 'paint-order': 'stroke', 'stroke-linejoin': 'round' });
        group.appendChild(symbol); group.appendChild(label); motionRoot.appendChild(group); motionEntries.push(node = { group, symbol, label });
      }
      node.group.setAttribute('transform', `translate(${n(point.x + (path.draw.shift?.x ?? 0))} ${n(point.y + (path.draw.shift?.y ?? 0))})`);
      node.group.setAttribute('data-kind', token.kind); node.group.setAttribute('data-link-id', token.linkId);
      node.symbol.setAttribute('d', token.kind === 'message' ? 'M-6 -4 H6 V4 H-6 Z M-6 -4 L0 0 L6 -4' : token.kind === 'signal' ? 'M0 -6 L6 5 H-6 Z' : 'M-5 0 A5 5 0 1 0 5 0 A5 5 0 1 0 -5 0');
      node.symbol.setAttribute('fill', current.halo); node.symbol.setAttribute('stroke', path.draw.color); node.symbol.setAttribute('stroke-width', '2');
      const kind = token.kind === 'message' ? 'Mensaje' : token.kind === 'signal' ? 'Señal' : 'Valor';
      node.label.textContent = `${kind}: ${Array.from(token.label).slice(0, 40).join('')}${token.sign === undefined ? '' : ` · ${token.sign === 1 ? '+' : '−'}`}${token.delay === undefined ? '' : ` · ${n(token.delay)} ms`}`;
      node.label.setAttribute('fill', path.draw.color); node.label.setAttribute('stroke', current.halo); node.label.setAttribute('stroke-width', '4');
      node.label.setAttribute('font-family', current.font); node.label.setAttribute('font-size', n(current.labelSize)); count++;
    }
    clearMotion(count);
    if (sample.playing && frameHost.requestAnimationFrame) frame = frameHost.requestAnimationFrame(renderMotion);
  };
  const visibility = () => renderMotion();
  page?.addEventListener('visibilitychange', visibility);
  const observer = frameHost.IntersectionObserver ? new frameHost.IntersectionObserver(entries => {
    visible = entries.some(entry => entry.isIntersecting); renderMotion();
  }) : null;
  observer?.observe(element);
  return {
    // One path per gesture. Updating it never walks the 150-card document or rewrites its existing connectors.
    preview(draw) {
      if (!draw) { draft.setAttribute('d', ''); return; }
      draft.setAttribute('d', draw.d); draft.setAttribute('stroke', draw.color); draft.setAttribute('stroke-width', n(draw.width)); draft.setAttribute('opacity', n(draw.opacity));
      if (draw.dash) draft.setAttribute('stroke-dasharray', draw.dash); else draft.removeAttribute('stroke-dasharray');
    },
    update(scene) {
      current = scene; paths.clear();
      root.setAttribute('transform', `translate(${n(-scene.origin.x)} ${n(-scene.origin.y)})`);
      if (above) marks.setAttribute('transform', `translate(${n(-scene.origin.x)} ${n(-scene.origin.y)})`);
      entries.forEach(e => { e.seen = false; });
      for (const draw of scene.draws) {
        const e = entry(draw.key); e.seen = true;
        for (const id of draw.linkIds ?? []) paths.set(id, { entry: e, draw });
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
      renderMotion();
    },
    destroy() { destroyed = true; stop(); observer?.disconnect(); page?.removeEventListener('visibilitychange', visibility); clearMotion(); svg.remove(); above?.remove(); entries.clear(); paths.clear(); },
  };
}

/** Small browser drawing contracts. Extend these here rather than enabling DOM types in the client. */
export interface Canvas2DContext {
  fillStyle: string; strokeStyle: string; lineWidth: number; globalAlpha: number; font: string;
  textAlign: string; textBaseline: string; lineCap: string; lineJoin: string;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void; strokeRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void; closePath(): void; moveTo(x: number, y: number): void; lineTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, start: number, end: number, anticlockwise?: boolean): void;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
  bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number): void;
  fill(): void; stroke(): void; clip(): void; save(): void; restore(): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  translate(x: number, y: number): void; rotate(angle: number): void; scale(x: number, y: number): void;
  setLineDash(values: number[]): void; fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  drawImage(image: unknown, ...coordinates: number[]): void;
}
export interface GLContext {
  readonly VERTEX_SHADER: number; readonly FRAGMENT_SHADER: number; readonly COMPILE_STATUS: number; readonly LINK_STATUS: number;
  readonly ARRAY_BUFFER: number; readonly STATIC_DRAW: number; readonly DYNAMIC_DRAW: number; readonly FLOAT: number;
  readonly TRIANGLES: number; readonly TRIANGLE_STRIP: number; readonly LINES: number; readonly POINTS: number; readonly COLOR_BUFFER_BIT: number;
  createShader(type: number): object | null; shaderSource(shader: object, source: string): void; compileShader(shader: object): void;
  getShaderParameter(shader: object, parameter: number): unknown; getShaderInfoLog(shader: object): string | null; deleteShader(shader: object): void;
  createProgram(): object | null; attachShader(program: object, shader: object): void; linkProgram(program: object): void;
  getProgramParameter(program: object, parameter: number): unknown; getProgramInfoLog(program: object): string | null; deleteProgram(program: object): void;
  useProgram(program: object | null): void; getUniformLocation(program: object, name: string): object | null;
  uniform1f(location: object | null, a: number): void; uniform2f(location: object | null, a: number, b: number): void;
  uniform3f(location: object | null, a: number, b: number, c: number): void; uniform4f(location: object | null, a: number, b: number, c: number, d: number): void;
  uniform1i(location: object | null, a: number): void;
  createBuffer(): object | null; bindBuffer(type: number, buffer: object | null): void; bufferData(type: number, data: Float32Array, usage: number): void; deleteBuffer(buffer: object): void;
  getAttribLocation(program: object, name: string): number; enableVertexAttribArray(index: number): void;
  vertexAttribPointer(index: number, size: number, type: number, normalized: boolean, stride: number, offset: number): void;
  viewport(x: number, y: number, w: number, h: number): void; clearColor(r: number, g: number, b: number, a: number): void;
  clear(mask: number): void; drawArrays(mode: number, first: number, count: number): void;
  getExtension(name: string): { loseContext?(): void } | null;
}
export function compileGLProgram(gl: GLContext, vertexSource: string, fragmentSource: string): { program?: object; error?: string } {
  const shaders: object[] = []; let program: object | null = null;
  try {
    for (const [type, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]] as const) {
      const shader = gl.createShader(type); if (!shader) throw new Error('No se pudo crear el shader.'); shaders.push(shader);
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Error al compilar el shader.');
    }
    program = gl.createProgram(); if (!program) throw new Error('No se pudo crear el programa.');
    shaders.forEach(shader => gl.attachShader(program!, shader)); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Error al enlazar el programa.');
    return { program };
  } catch (error) { if (program) gl.deleteProgram(program); return { error: error instanceof Error ? error.message : String(error) }; }
  finally { shaders.forEach(shader => gl.deleteShader(shader)); }
}
export type SurfaceFrame = { width: number; height: number; pixelRatio: number; time: number };
export type SurfacePointer = { kind: 'down' | 'move' | 'up' | 'cancel'; x: number; y: number; pointerId: number; buttons: number; pressure: number };
type SurfaceBase = { id: string; label: string; height: number; animated?: boolean; maxPixelSize?: number; onVisibilityChange?(visible: boolean): void; onPointer?(event: SurfacePointer): void; onError?(message: string): void };
export type CanvasSurfaceProps = SurfaceBase & { draw(context: Canvas2DContext, frame: SurfaceFrame): void };
export type GLSurfaceProps = SurfaceBase & {
  initialize?(context: GLContext): { error?: string; dispose?(): void } | void;
  draw(context: GLContext, frame: SurfaceFrame): void;
};
interface DrawingCanvas {
  clientWidth: number; clientHeight: number; width: number; height: number;
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  getContext(kind: string): unknown;
  addEventListener(name: string, listener: (event: { preventDefault(): void }) => void): void;
  removeEventListener(name: string, listener: (event: { preventDefault(): void }) => void): void;
  setPointerCapture?(id: number): void; releasePointerCapture?(id: number): void;
}
interface DrawingHost {
  devicePixelRatio?: number;
  requestAnimationFrame(cb: (time: number) => void): number; cancelAnimationFrame(id: number): void;
  ResizeObserver?: new (cb: () => void) => { observe(node: unknown): void; disconnect(): void };
  IntersectionObserver?: new (cb: (entries: { isIntersecting: boolean }[]) => void) => { observe(node: unknown): void; disconnect(): void };
}
export const MAX_LIVE_GL_CONTEXTS = 8;
let liveGLContexts = 0;
function DrawingSurface({ kind, ...props }: (CanvasSurfaceProps | GLSurfaceProps) & { kind: '2d' | 'webgl' }) {
  const ref = useRef<DrawingCanvas | null>(null), latest = useRef(props), invalidate = useRef<() => void>(() => {});
  latest.current = props; const [error, setError] = useState('');
  useEffect(() => {
    if (Platform.OS !== 'web' || !ref.current || !browser().document) return;
    const canvas = ref.current, doc = browser().document!, host = globalThis as unknown as DrawingHost;
    let context: Canvas2DContext | GLContext | null = null, frameId = 0, visible = !host.IntersectionObserver, lost = false, stopped = false, allocated = false, allocatedContext: GLContext | null = null, dispose: (() => void) | undefined;
    const report = (message: string) => { setError(message); latest.current.onError?.(message); };
    const initialize = () => {
      try {
        if (kind === 'webgl' && !allocated && liveGLContexts >= MAX_LIVE_GL_CONTEXTS) { report('Hay demasiados gráficos WebGL abiertos. Cierra otro gráfico y vuelve a abrir este bloque.'); return; }
        context = canvas.getContext(kind) as typeof context;
        if (!context) { report('El navegador no ofrece este contexto de dibujo.'); return; }
        if (kind === 'webgl') {
          if (!allocated) { allocated = true; liveGLContexts++; }
          allocatedContext = context as GLContext;
          const result = (latest.current as GLSurfaceProps).initialize?.(context as GLContext);
          dispose = result?.dispose; if (result?.error) { report('No se pudo preparar el gráfico. Revisa el shader o su configuración.'); latest.current.onError?.(result.error); context = null; return; }
        }
        setError('');
      } catch (error) { report('No se pudo iniciar el gráfico. Revisa su configuración y vuelve a abrir el bloque.'); context = null; }
    };
    const active = () => !stopped && visible && !doc.hidden && !lost && !!context;
    let notified: boolean | undefined;
    const notifyVisibility = () => { const value = active(); if (value !== notified) { notified = value; latest.current.onVisibilityChange?.(value); } };
    const schedule = () => { if (active() && !frameId) frameId = host.requestAnimationFrame(draw); };
    const draw = (time: number) => {
      frameId = 0; notifyVisibility(); if (!active()) return;
      const width = canvas.clientWidth, height = canvas.clientHeight; if (!width || !height) return;
      // CSS camera transforms do not change clientWidth. Sample their physical scale at redraw time.
      const rect = canvas.getBoundingClientRect(), physicalRatio = Math.max(1, Math.min(4, (host.devicePixelRatio ?? 1) * rect.width / width));
      const cap = Number.isFinite(latest.current.maxPixelSize) ? Math.max(16, Math.min(2048, latest.current.maxPixelSize!)) : Infinity;
      const pixelRatio = Math.min(physicalRatio, cap / Math.max(width, height));
      const w = Math.max(1, Math.round(width * pixelRatio)), h = Math.max(1, Math.round(height * pixelRatio));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      try {
        const frame = { width, height, pixelRatio, time };
        if (kind === '2d') {
          const ctx = context as Canvas2DContext; ctx.save();
          try { ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0); (latest.current as CanvasSurfaceProps).draw(ctx, frame); } finally { ctx.restore(); }
        } else { const gl = context as GLContext; gl.viewport(0, 0, w, h); (latest.current as GLSurfaceProps).draw(gl, frame); }
      } catch (error) { report('No se pudo dibujar el gráfico. Revisa los parámetros y vuelve a intentarlo.'); return; }
      if (latest.current.animated) schedule();
    };
    const stop = () => { if (frameId) host.cancelAnimationFrame(frameId); frameId = 0; };
    const visibility = () => { notifyVisibility(); if (doc.hidden) stop(); else schedule(); };
    const onLost = (event: { preventDefault(): void }) => {
      event.preventDefault(); lost = true; stop(); notifyVisibility();
      const cleanup = dispose; dispose = undefined; context = null;
      try { cleanup?.(); } finally { report('El contexto WebGL se perdió. Esperando restauración.'); }
    };
    const onRestored = () => { lost = false; initialize(); notifyVisibility(); schedule(); };
    initialize(); invalidate.current = schedule;
    const intersection = host.IntersectionObserver ? new host.IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting); notifyVisibility(); if (visible) schedule(); else stop(); }) : null;
    const resize = host.ResizeObserver ? new host.ResizeObserver(schedule) : null;
    intersection?.observe(canvas); resize?.observe(canvas); doc.addEventListener('visibilitychange', visibility);
    if (kind === 'webgl') { canvas.addEventListener('webglcontextlost', onLost); canvas.addEventListener('webglcontextrestored', onRestored); }
    notifyVisibility(); schedule();
    return () => {
      stopped = true; notifyVisibility(); invalidate.current = () => {}; stop(); intersection?.disconnect(); resize?.disconnect(); doc.removeEventListener('visibilitychange', visibility);
      canvas.removeEventListener('webglcontextlost', onLost); canvas.removeEventListener('webglcontextrestored', onRestored);
      try { dispose?.(); } finally { if (allocated) { liveGLContexts--; allocatedContext?.getExtension('WEBGL_lose_context')?.loseContext?.(); } }
    };
  }, [kind, props.id, kind === 'webgl' ? (props as GLSurfaceProps).initialize : undefined]);
  useEffect(() => { invalidate.current(); });
  if (Platform.OS !== 'web') return null;
  type PointerLike = { clientX: number; clientY: number; pointerId: number; buttons: number; pressure: number; stopPropagation(): void; preventDefault(): void };
  const pointer = (kind: SurfacePointer['kind']) => (event: PointerLike) => {
    const canvas = ref.current; if (!canvas) return; event.stopPropagation();
    const rect = canvas.getBoundingClientRect();
    if (kind === 'down') canvas.setPointerCapture?.(event.pointerId);
    if (kind === 'up' || kind === 'cancel') canvas.releasePointerCapture?.(event.pointerId);
    latest.current.onPointer?.({ kind, x: (event.clientX - rect.left) * canvas.clientWidth / Math.max(1, rect.width), y: (event.clientY - rect.top) * canvas.clientHeight / Math.max(1, rect.height), pointerId: event.pointerId, buttons: event.buttons, pressure: event.pressure });
  };
  const isolate = (event: { stopPropagation(): void }) => event.stopPropagation();
  return React.createElement('div', { id: `lienzo-interactive-surface-${props.id}`, style: { position: 'relative', width: '100%', height: props.height }, onWheel: isolate, onKeyDown: isolate, onKeyUp: isolate },
    React.createElement('canvas', { ref, 'aria-label': props.label, role: 'img', tabIndex: 0, style: { width: '100%', height: '100%', display: 'block', touchAction: 'none' }, onPointerDown: pointer('down'), onPointerMove: pointer('move'), onPointerUp: pointer('up'), onPointerCancel: pointer('cancel') }),
    error ? React.createElement('div', { role: 'status', style: { position: 'absolute', inset: 0, padding: 8, color: 'inherit', background: 'inherit' } }, error) : null);
}
export function WebCanvasSurface(props: CanvasSurfaceProps) { return React.createElement(DrawingSurface, { ...props, kind: '2d' }); }

export function WebGLSurface(props: GLSurfaceProps) { return React.createElement(DrawingSurface, { ...props, kind: 'webgl' }); }
export function WebRange({ id, label, min, max, step, value, disabled, color, onChange, onSettle }: {
  id: string; label: string; min: number; max: number; step: number | 'any'; value: number; disabled: boolean; color: string;
  onChange(value: number): void; onSettle(value: number): void;
}) {
  if (Platform.OS !== 'web') return null;
  const read = (e: { currentTarget: { value: string } }) => Number(e.currentTarget.value);
  return React.createElement('input', { id: `lienzo-interactive-range-${id}`, type: 'range', 'aria-label': label, min, max, step, value, disabled,
    style: { width: '100%', accentColor: color }, onInput: (e: { currentTarget: { value: string } }) => onChange(read(e)),
    onPointerUp: (e: { currentTarget: { value: string } }) => onSettle(read(e)), onPointerCancel: (e: { currentTarget: { value: string } }) => onSettle(read(e)),
    onKeyUp: (e: { key: string; currentTarget: { value: string } }) => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) onSettle(read(e)); },
  });
}
