// The only browser/DOM adapter. Loading this module never touches the DOM on native.
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { safeUrl } from './logic';
import { tokens } from './tokens';
import { frameSandbox } from './media';
import type { LinkMotionSample } from './renderers/types';
import { sanitizeSvg, SVG_LIMITS } from '../shared/svg';
import { useContentInteraction } from './interaction';
import type { StepAudioPort } from './sequencer-audio';
interface BrowserEventTarget {
  addEventListener(name: string, listener: (event: BrowserKeyEvent) => void, capture?: boolean): void;
  removeEventListener(name: string, listener: (event: BrowserKeyEvent) => void, capture?: boolean): void;
}
interface BrowserElement extends BrowserEventTarget {
  id?: string;
  contains?(node: unknown): boolean;
  focus?(): void;
  querySelectorAll?(selector: string): ArrayLike<BrowserElement>;
  getAttribute?(name: string): string | null;
  setPointerCapture?(id: number): void;
  releasePointerCapture?(id: number): void;
  href: string; download: string;
  type: string; accept: string; files?: { length: number; [index: number]: { size: number; text(): Promise<string> } };
  appendChild(child: BrowserElement): void; click(): void; remove(): void;
  closest(selector: string): BrowserElement | null;
  querySelector(selector: string): (BrowserElement & { focus(): void }) | null;
  getBoundingClientRect(): { left: number; top: number; width?: number; height?: number };
  setAttribute(name: string, value: string): void;
}
interface BrowserKeyEvent { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; target: BrowserElement | null; preventDefault(): void; stopPropagation(): void; deltaX: number; deltaY: number; clientX: number; clientY: number }
interface BrowserHost {
  document?: BrowserEventTarget & { hidden?: boolean; body: BrowserElement; createElement(tag: string): BrowserElement; getElementById?(id: string): BrowserElement | null };
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
  const interacting = useContentInteraction(), safe = safeUrl(url), [loaded, setLoaded] = useState(false);
  useEffect(() => { if (Platform.OS !== 'web') return; setLoaded(false); const timer = setTimeout(() => onTimeout?.(), 8000); return () => clearTimeout(timer); }, [safe]);
  if (Platform.OS !== 'web' || !safe) return null;
  return React.createElement('div', { id: `lienzo-${interacting ? 'interactive' : 'passive'}-frame-${title}`, 'data-lienzo-interacting': interacting ? 'true' : 'false', style: { position: 'relative', height, width: '100%', border: `1px solid ${border}`, borderRadius: 6, overflow: 'hidden', backgroundColor: surface } },
    React.createElement('iframe', { key: safe, src: safe, title, sandbox: frameSandbox(safe, browser().location?.origin), referrerPolicy: 'strict-origin-when-cross-origin', loading: 'lazy', allow: player ? 'encrypted-media; fullscreen; picture-in-picture' : 'fullscreen', allowFullScreen: true, onLoad: () => { setLoaded(true); onLoaded?.(); }, style: { width: '100%', height: '100%', border: 0, opacity: loaded ? 1 : 0, pointerEvents: interacting ? 'auto' : 'none' }, 'aria-label': loaded ? title : `Cargando ${title}` }), !interacting && React.createElement('div', { 'aria-label': 'Doble clic para interactuar', style: { position: 'absolute', inset: 0, background: 'transparent' } }));
}
/** Uses browser controls, with no playback loop in React. No media implementation is loaded on native. */
export function WebMedia({ url, title, kind, height, surface, onError }: { url: string; title: string; kind: 'video' | 'audio'; height: number | '100%'; surface: string; onError: () => void }) {
  const interacting = useContentInteraction(), element = useRef<{ pause(): void } | null>(null), safe = safeUrl(url);
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
  return React.createElement('div', { style: { position: 'relative', height: kind === 'audio' ? tokens.media.audio.height : height, width: '100%' } }, React.createElement(kind, { key: safe, ref: element, src: safe, controls: true, preload: tokens.media[kind].preload, playsInline: true, 'aria-label': title, onError, style: { display: 'block', width: '100%', height: kind === 'audio' ? tokens.media.audio.height : height, borderRadius: 6, backgroundColor: surface, objectFit: 'contain', pointerEvents: interacting ? 'auto' : 'none' } }), !interacting && React.createElement('div', { 'aria-label': 'Doble clic para interactuar', style: { position: 'absolute', inset: 0, background: 'transparent' } }));
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
export function pickSvgFile(): Promise<string | null> {
  const host = browser(); if (!host.document) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const input = host.document!.createElement('input'); input.type = 'file'; input.accept = '.svg,image/svg+xml';
    input.addEventListener('cancel', () => { input.remove(); resolve(null); });
    input.addEventListener('change', () => {
      const file = input.files?.[0]; input.remove();
      if (!file) { resolve(null); return; }
      if (file.size > SVG_LIMITS.bytes) { reject(new Error('El SVG supera 64 KB.')); return; }
      void file.text().then(text => resolve(sanitizeSvg(text).svg)).catch(reject);
    });
    input.click();
  });
}
/** Browser fetch only. Read a bounded body, then validate with the same static dialect as the server. */
export async function fetchSvgUrl(value: string): Promise<string> {
  const url = safeUrl(value); if (!browser().document || !url) throw new Error('Usá una URL HTTP o HTTPS válida en el navegador.');
  type Response = { ok: boolean; url?: string; headers: { get(name: string): string | null }; body?: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel(): Promise<void> } } | null };
  const host = globalThis as unknown as { fetch(url: string, options: { credentials: string; signal: unknown }): Promise<Response>; AbortController: new () => { signal: unknown; abort(): void }; TextDecoder: new () => { decode(value: Uint8Array): string } };
  const abort = new host.AbortController(), timeout = setTimeout(() => abort.abort(), 10000);
  try {
    const response = await host.fetch(url, { credentials: 'omit', signal: abort.signal });
    if (!response.ok || response.url && !safeUrl(response.url)) throw new Error('No se pudo cargar el SVG.');
    if (Number(response.headers.get('content-length')) > SVG_LIMITS.bytes) throw new Error('El SVG supera 64 KB.');
    const reader = response.body?.getReader(); if (!reader) throw new Error('No se pudo leer el SVG.');
    const chunks: Uint8Array[] = []; let bytes = 0;
    for (;;) { const part = await reader.read(); if (part.done) break; if (!part.value) continue; bytes += part.value.byteLength; if (bytes > SVG_LIMITS.bytes) { await reader.cancel(); throw new Error('El SVG supera 64 KB.'); } chunks.push(part.value); }
    const content = new Uint8Array(bytes); let offset = 0; for (const chunk of chunks) { content.set(chunk, offset); offset += chunk.byteLength; }
    return sanitizeSvg(new host.TextDecoder().decode(content)).svg;
  } finally { clearTimeout(timeout); }
}
/** Safe markup is validated again at the rendering boundary, including custom-pack data. */
export function WebSvg({ svg, color, label }: { svg: string; color: string; label: string }) {
  if (Platform.OS !== 'web') return null;
  let safe: string; try { safe = sanitizeSvg(svg).svg.replaceAll('currentColor', color); } catch { return null; }
  return React.createElement('img', { src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(safe)}`, alt: label, draggable: false, style: { display: 'block', width: '100%', height: '100%', objectFit: 'contain', userSelect: 'none' } });
}
export function attachWheel(element: unknown, handler: (e: { x: number; y: number; dx: number; dy: number; command: boolean }) => void) {
  const node = element as BrowserElement | null; if (!browser().document || !node?.addEventListener) return () => {};
  const listener = (e: BrowserKeyEvent) => {
    // An active player, page or resized card scrolls independently; command-wheel still zooms the canvas.
    if (e.target?.closest('[id^="lienzo-interactive-surface-"],[id^="lienzo-interactive-range-"]')) return;
    const target = pointerElement(e.target);
    const legacy = target?.closest?.('[id^="lienzo-interactive-"]');
    const active = target?.closest?.('[data-lienzo-interacting="true"],[id^="lienzo-using-"]');
    if (!e.ctrlKey && !e.metaKey && (active || legacy && !/^lienzo-interactive-(frame|media|video)-/.test(legacy.id ?? ''))) return;
    const origin = node.getBoundingClientRect(); handler({ x: e.clientX - origin.left, y: e.clientY - origin.top, dx: e.deltaX, dy: e.deltaY, command: e.ctrlKey || e.metaKey }); e.preventDefault();
  };
  node.addEventListener('wheel', listener); return () => node.removeEventListener('wheel', listener);
}
// Middle mouse button (wheel click) drags the canvas on both axes, including over blocks.
// `onEnd` receives the release velocity in px/ms (zero when the pointer had stopped), so the canvas can keep gliding.
export function attachMiddlePan(element: unknown, handler: (delta: { dx: number; dy: number }) => void, onEnd?: (velocity: { vx: number; vy: number }) => void) {
  const node = element as BrowserElement | null, doc = browser().document; if (!doc || !node?.addEventListener) return () => {};
  type PointerLike = BrowserKeyEvent & { button?: number; pointerId?: number };
  let last: { x: number; y: number; t: number } | null = null, velocity = { vx: 0, vy: 0 };
  const down = (e: PointerLike) => { if (e.button !== 1) return; last = { x: e.clientX, y: e.clientY, t: Date.now() }; velocity = { vx: 0, vy: 0 }; if (e.pointerId !== undefined) { try { node.setPointerCapture?.(e.pointerId); } catch {} } handler({ dx: 0, dy: 0 }); e.preventDefault(); e.stopPropagation(); };
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
export type CanvasPointer = { x: number; y: number; shift: boolean; command: boolean; pointerId: number };
export type ToolPointerHandlers = {
  begin(point: CanvasPointer, entityId: string | null): boolean;
  move(point: CanvasPointer): void;
  end(point: CanvasPointer, cancelled: boolean): void;
};
/** Tools opt into each press. A rejected press remains available to cards, links and controls. */
export function attachToolPointer(element: unknown, handlers: ToolPointerHandlers): () => void {
  const node = element as BrowserElement | null, doc = browser().document; if (!doc || !node?.addEventListener) return () => {};
  type Event = BrowserKeyEvent & { button?: number; pointerId?: number };
  let current: CanvasPointer | null = null;
  const point = (e: Event): CanvasPointer => ({ x: e.clientX, y: e.clientY, shift: e.shiftKey, command: e.ctrlKey || e.metaKey, pointerId: e.pointerId ?? 0 });
  const down = (e: Event) => {
    if (e.button !== 0 || pointerElement(e.target)?.closest?.('[id^="lienzo-tools"],[id^="lienzo-interaction-exit-"]')) return;
    const id = pointerElement(e.target)?.closest?.('[id^="lienzo-entity-"]')?.id?.slice('lienzo-entity-'.length) ?? null, p = point(e);
    if (!handlers.begin(p, id)) return;
    current = p; try { node.setPointerCapture?.(p.pointerId); } catch {} e.preventDefault(); e.stopPropagation();
  };
  const move = (e: Event) => { if (!current || current.pointerId !== (e.pointerId ?? 0)) return; current = point(e); handlers.move(current); e.preventDefault(); e.stopPropagation(); };
  const finish = (cancelled: boolean) => { const p = current; current = null; if (!p) return; try { node.releasePointerCapture?.(p.pointerId); } catch {} handlers.end(p, cancelled); if (!cancelled) swallowClick(); };
  const up = (e: Event) => { if (!current || current.pointerId !== (e.pointerId ?? 0)) return; current = point(e); finish(false); e.preventDefault(); e.stopPropagation(); };
  const cancel = () => finish(true);
  const key = (e: BrowserKeyEvent) => { if (e.key === 'Escape' && current) { cancel(); e.preventDefault(); e.stopPropagation(); } };
  node.addEventListener('pointerdown', down, true); doc.addEventListener('pointermove', move, true); doc.addEventListener('pointerup', up, true); doc.addEventListener('pointercancel', cancel, true); doc.addEventListener('keydown', key, true);
  return () => { cancel(); node.removeEventListener('pointerdown', down, true); doc.removeEventListener('pointermove', move, true); doc.removeEventListener('pointerup', up, true); doc.removeEventListener('pointercancel', cancel, true); doc.removeEventListener('keydown', key, true); };
}
function pointerElement(target: unknown): BrowserElement | null {
  const node = target as (BrowserElement & { nodeType?: number; parentElement?: BrowserElement }) | null;
  return node?.nodeType === 3 ? node.parentElement ?? null : node;
}
/** Editing inputs keep their drag; passive text, buttons and SVG geometry allow threshold-based entity drag. */
export function isEditingTarget(target: unknown): boolean {
  if (pointerElement(target)?.closest?.('[id^="lienzo-grab-"]') && !pointerElement(target)?.closest?.('input,textarea,[contenteditable="true"]')) return false;
  return Platform.OS === 'web' && !!pointerElement(target)?.closest?.('input,textarea,select,[contenteditable="true"],[data-lienzo-interacting="true"],[id^="lienzo-using-"],iframe,video,audio,[id^="lienzo-interactive-range-"],[id^="lienzo-interactive-surface-"]');
}
export type EntityPointerHandlers = {
  enabled(): boolean;
  start(id: string, point: CanvasPointer): void;
  move(point: CanvasPointer): void;
  end(cancelled: boolean, velocity: { vx: number; vy: number }): void;
  edit?(id: string): void;
};
/** Capture only after movement, so ordinary clicks still reach all nested controls. */
export function attachEntityDrag(element: unknown, handlers: EntityPointerHandlers, threshold = 4): () => void {
  const node = element as BrowserElement | null, doc = browser().document; if (!doc || !node?.addEventListener) return () => {};
  type Event = BrowserKeyEvent & { button?: number; pointerId?: number; buttons?: number };
  let pending: { id: string; start: CanvasPointer; last: CanvasPointer; time: number; active: boolean } | null = null;
  let velocity = { vx: 0, vy: 0 };
  const point = (e: Event): CanvasPointer => ({ x: e.clientX, y: e.clientY, shift: e.shiftKey, command: e.ctrlKey || e.metaKey, pointerId: e.pointerId ?? 0 });
  const entity = (e: Event) => pointerElement(e.target)?.closest?.('[id^="lienzo-entity-"]')?.id?.slice('lienzo-entity-'.length);
  const down = (e: Event) => {
    if (e.button !== 0 || !handlers.enabled() || isEditingTarget(e.target) || pointerElement(e.target)?.closest?.('[id^="lienzo-interactive-resize-"],[id^="lienzo-link-handle-"]')) return;
    const id = entity(e); if (!id) return;
    const p = point(e); pending = { id, start: p, last: p, time: Date.now(), active: false }; velocity = { vx: 0, vy: 0 };
  };
  const move = (e: Event) => {
    const state = pending; if (!state || (e.pointerId ?? 0) !== state.start.pointerId) return;
    const p = point(e), now = Date.now(), dt = Math.max(1, now - state.time);
    if (!state.active && Math.hypot(p.x - state.start.x, p.y - state.start.y) < threshold) return;
    if (!state.active) { state.active = true; try { node.setPointerCapture?.(p.pointerId); } catch {} handlers.start(state.id, state.start); }
    velocity = { vx: .6 * (p.x - state.last.x) / dt + .4 * velocity.vx, vy: .6 * (p.y - state.last.y) / dt + .4 * velocity.vy };
    state.last = p; state.time = now; handlers.move(p); e.preventDefault(); e.stopPropagation();
  };
  const finish = (cancelled: boolean) => {
    const state = pending; pending = null; if (!state?.active) return;
    try { node.releasePointerCapture?.(state.start.pointerId); } catch {}
    handlers.end(cancelled, Date.now() - state.time > 80 ? { vx: 0, vy: 0 } : velocity); if (!cancelled) swallowClick();
  };
  const up = (e: Event) => { if (pending && (e.pointerId ?? 0) === pending.start.pointerId) { const active = pending.active; finish(false); if (active) { e.preventDefault(); e.stopPropagation(); } } };
  const cancel = () => finish(true);
  const key = (e: BrowserKeyEvent) => { if (e.key === 'Escape' && pending) { cancel(); e.preventDefault(); e.stopPropagation(); } };
  const edit = (e: Event) => { if (isEditingTarget(e.target)) return; const id = entity(e); if (id && handlers.edit) { handlers.edit(id); } };
  node.addEventListener('pointerdown', down, true); node.addEventListener('dblclick', edit); doc.addEventListener('pointermove', move, true); doc.addEventListener('pointerup', up, true); doc.addEventListener('pointercancel', cancel, true); doc.addEventListener('keydown', key, true);
  return () => { cancel(); node.removeEventListener('pointerdown', down, true); node.removeEventListener('dblclick', edit); doc.removeEventListener('pointermove', move, true); doc.removeEventListener('pointerup', up, true); doc.removeEventListener('pointercancel', cancel, true); doc.removeEventListener('keydown', key, true); };
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

export type VectorPath = { d: string; color: string; weight: number; fill?: string; dash?: string; hit?: boolean };
/** Shape geometry uses browser SVG only here; native components render their own geometric fallback. */
export function WebVectors({ width, height, paths, label, scale = 1, onPress, onHover }: { width: number; height: number; paths: readonly VectorPath[]; label: string; scale?: number; onPress?: (point?: CanvasPointer) => void; onHover?: (inside: boolean) => void }) {
  if (Platform.OS !== 'web') return null;
  return React.createElement('svg', { width:'100%',height:'100%',viewBox:`0 0 ${width} ${height}`,role:'img','aria-label':label,style:{overflow:'visible',pointerEvents:'none'} }, ...paths.flatMap((path,i) => [
    React.createElement('path',{key:`paint-${i}`,d:path.d,fill:path.fill??'none',stroke:path.color,strokeWidth:path.weight,strokeDasharray:path.dash,strokeLinecap:'round',strokeLinejoin:'round',vectorEffect:'non-scaling-stroke',style:{pointerEvents:'none'}}),
    ...(path.hit===false?[]:[React.createElement('path',{key:`hit-${i}`,d:path.d,fill:path.fill&&path.fill!=='none'?'transparent':'none',stroke:'transparent',strokeWidth:16/Math.max(.01,scale),style:{pointerEvents:path.fill&&path.fill!=='none'?'all':'stroke',cursor:'grab'},onClick:(e:{stopPropagation():void;clientX:number;clientY:number;shiftKey:boolean;ctrlKey:boolean;metaKey:boolean})=>{e.stopPropagation();onPress?.({x:e.clientX,y:e.clientY,shift:e.shiftKey,command:e.ctrlKey||e.metaKey,pointerId:0});},onPointerEnter:()=>onHover?.(true),onPointerLeave:()=>onHover?.(false)})]),
  ]));
}

export function attachEditorKeys(element: unknown, confirm:()=>void, cancel:()=>void):()=>void {
  const node=element as BrowserElement|null;if(!browser().document||!node?.addEventListener)return()=>{};
  const key=(e:BrowserKeyEvent)=>{if(e.key==='Escape'||e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();e.stopPropagation();if(e.key==='Escape')cancel();else confirm();}};
  node.addEventListener('keydown',key,true);return()=>node.removeEventListener('keydown',key,true);
}
export function attachCanvasKeys(element:unknown,handler:(key:string,typing:boolean)=>boolean,temporaryHand:(active:boolean)=>void):()=>void {
  const node=element as BrowserElement|null,doc=browser().document;if(!doc||!node?.addEventListener)return()=>{};let space=false;
  const down=(e:BrowserKeyEvent)=>{if(pointerElement(e.target)?.closest?.('input,textarea,select,[contenteditable="true"],iframe,video,audio,[id^="lienzo-interactive-"],[id^="lienzo-using-"],[data-lienzo-interacting="true"]'))return;if(e.key===' '){if(!space){space=true;temporaryHand(true);}e.preventDefault();e.stopPropagation();return;}if(!e.ctrlKey&&!e.metaKey&&handler(e.key,e.key.length===1)){e.preventDefault();e.stopPropagation();}};
  const up=(e:BrowserKeyEvent)=>{if(e.key===' '&&space){space=false;temporaryHand(false);e.preventDefault();}};
  const cancel=()=>{if(space){space=false;temporaryHand(false);}};
  node.addEventListener('keydown',down,true);doc.addEventListener('keyup',up,true);doc.addEventListener('visibilitychange',cancel);return()=>{cancel();node.removeEventListener('keydown',down,true);doc.removeEventListener('keyup',up,true);doc.removeEventListener('visibilitychange',cancel);};
}

/** Library clicks use normal controls. Only an actual drag creates a ghost and consumes the release. */
export function attachLibraryDrag(element: unknown, handlers: { enabled(): boolean; preview(id: string): { svg: string; color: string } | undefined; drop(id: string, page: { x: number; y: number }): void }): () => void {
  const node = element as BrowserElement | null, doc = browser().document;
  if (!doc || !node?.addEventListener) return () => {};
  type Event = BrowserKeyEvent & { button?: number; pointerId?: number };
  let state: { id: string; x: number; y: number; pointer: number; active: boolean } | null = null, ghost: BrowserElement | null = null;
  const cancel = () => { if (state?.active) { try { node.releasePointerCapture?.(state.pointer); } catch {} } state = null; ghost?.remove(); ghost = null; };
  const down = (e: Event) => {
    if (e.button !== 0 || !handlers.enabled()) return;
    const id = pointerElement(e.target)?.closest?.('[id^="lienzo-library-icon-"]')?.id?.slice('lienzo-library-icon-'.length);
    if (id) state = { id, x: e.clientX, y: e.clientY, pointer: e.pointerId ?? 0, active: false };
  };
  const move = (e: Event) => {
    if (!state || state.pointer !== (e.pointerId ?? 0)) return;
    if (!handlers.enabled()) { cancel(); return; }
    if (!state.active && Math.hypot(e.clientX - state.x, e.clientY - state.y) < 4) return;
    if (!state.active) {
      state.active = true; try { node.setPointerCapture?.(state.pointer); } catch {}
      const image = handlers.preview(state.id);
      if (image) { try { ghost = doc.createElement('img'); ghost.setAttribute('src', `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sanitizeSvg(image.svg).svg.replace(/currentColor/g, image.color))}`); ghost.setAttribute('aria-hidden', 'true'); doc.body.appendChild(ghost); } catch { ghost?.remove(); ghost = null; } }
    }
    ghost?.setAttribute('style', `position:fixed;left:${e.clientX - 48}px;top:${e.clientY - 48}px;width:96px;height:96px;opacity:.55;pointer-events:none;z-index:2147483647`);
    e.preventDefault(); e.stopPropagation();
  };
  const up = (e: Event) => {
    if (!state || state.pointer !== (e.pointerId ?? 0)) return;
    const held = state; cancel(); if (!held.active) return;
    e.preventDefault(); e.stopPropagation(); swallowClick();
    const rect = doc.getElementById?.('lienzo-canvas-viewport')?.getBoundingClientRect();
    if (handlers.enabled() && rect?.width && rect.height && e.clientX >= rect.left && e.clientY >= rect.top && e.clientX <= rect.left + rect.width && e.clientY <= rect.top + rect.height) handlers.drop(held.id, { x: e.clientX, y: e.clientY });
  };
  const key = (e: BrowserKeyEvent) => { if (e.key === 'Escape' && state) { cancel(); e.preventDefault(); e.stopPropagation(); } };
  node.addEventListener('pointerdown', down, true); doc.addEventListener('pointermove', move, true); doc.addEventListener('pointerup', up, true); doc.addEventListener('pointercancel', cancel, true); doc.addEventListener('keydown', key, true);
  return () => { cancel(); node.removeEventListener('pointerdown', down, true); doc.removeEventListener('pointermove', move, true); doc.removeEventListener('pointerup', up, true); doc.removeEventListener('pointercancel', cancel, true); doc.removeEventListener('keydown', key, true); };
}

/** Browser dismissal and keyboard focus for the canvas zoom menu. Native uses its controls directly. */
export function attachZoomMenu(element: unknown, trigger: unknown, dismiss: () => void): () => void {
  const node = element as BrowserElement | null, button = trigger as BrowserElement | null, doc = browser().document;
  if (!doc || !node?.addEventListener) return () => {};
  let prefix = '', typedAt = 0;
  const items = () => Array.from(node.querySelectorAll?.('[role="menuitem"]') ?? []).filter(item => item.getAttribute?.('aria-disabled') !== 'true');
  items()[0]?.focus?.();
  const outside = (event: BrowserKeyEvent) => { if (!node.contains?.(event.target) && !button?.contains?.(event.target)) dismiss(); };
  const key = (event: BrowserKeyEvent) => {
    if (event.key === 'Escape') { dismiss(); button?.focus?.(); event.preventDefault(); event.stopPropagation(); return; }
    if (!node.contains?.(event.target) || event.ctrlKey || event.metaKey) return;
    const rows = items(), current = rows.indexOf(pointerElement(event.target)!); let next: BrowserElement | undefined;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') next = rows[(current + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length];
    else if (event.key === 'Home' || event.key === 'End') next = rows[event.key === 'Home' ? 0 : rows.length - 1];
    else if (event.key.length === 1) { const now = Date.now(); prefix = now - typedAt > tokens.menu.typeaheadMs ? event.key : prefix + event.key; typedAt = now; next = rows.find(row => row.getAttribute?.('aria-label')?.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())); }
    if (next) { next.focus?.(); event.preventDefault(); event.stopPropagation(); }
  };
  doc.addEventListener('pointerdown', outside, true); doc.addEventListener('keydown', key, true);
  return () => { doc.removeEventListener('pointerdown', outside, true); doc.removeEventListener('keydown', key, true); };
}
// ---- Step sequencer audio ----------------------------------------------------------------------------------------
// The only Web Audio entry. A context exists only between a learner's press and the next stop: closing is the one
// way to stop, so nothing keeps sounding or holding an audio thread after pause, hide, replace or unmount.
type AudioParam = { setValueAtTime(value: number, time: number): void; linearRampToValueAtTime(value: number, time: number): void };
type AudioNode = { connect(target: unknown): void; disconnect(): void };
type AudioOscillator = AudioNode & { type: string; frequency: AudioParam; onended: (() => void) | null; start(time: number): void; stop(time?: number): void };
interface AudioHost {
  currentTime: number; state: string; destination: unknown; onstatechange: (() => void) | null;
  resume(): Promise<void>; close(): Promise<void>;
  createGain(): AudioNode & { gain: AudioParam }; createOscillator(): AudioOscillator;
}
export const STEP_AUDIO = { master: .2, peak: { sine: .3, triangle: .3, square: .1 }, attack: .006, maxNote: .5, maxVoices: 24, minHz: 30, maxHz: 4200, activationMs: 1500 } as const;
export type StepAudioInterrupt = 'hidden' | 'suspended' | 'replaced';
export type StepAudioOpen = { port: StepAudioPort; ready: Promise<boolean> } | { error: 'unsupported' | 'failed' };
let liveStepAudio: ((reason: StepAudioInterrupt) => void) | null = null;
/**
 * Call synchronously from a press handler. `ready` resolves false, with the context already closed, when the
 * browser refuses to start it. One context is live across the plugin: opening another interrupts the previous owner.
 */
export function openStepAudio(options: { voice: keyof typeof STEP_AUDIO.peak; elementId?: string; onInterrupt(reason: StepAudioInterrupt): void }): StepAudioOpen {
  const host = browser() as unknown as { AudioContext?: new () => AudioHost; webkitAudioContext?: new () => AudioHost; document?: BrowserHost['document'] & { getElementById?(id: string): unknown };
    IntersectionObserver?: new (cb: (entries: { isIntersecting: boolean }[]) => void) => { observe(node: unknown): void; disconnect(): void } };
  const Context = host.AudioContext ?? host.webkitAudioContext, doc = host.document;
  if (!doc || !Context) return { error: 'unsupported' };
  liveStepAudio?.('replaced');
  let context: AudioHost, master: AudioNode & { gain: AudioParam };
  try {
    context = new Context(); master = context.createGain();
    master.gain.setValueAtTime(STEP_AUDIO.master, context.currentTime); master.connect(context.destination);
  } catch { return { error: 'failed' }; }
  const voices = new Set<AudioOscillator>();
  let closed = false, started = false, observer: { observe(node: unknown): void; disconnect(): void } | null = null;
  const close = () => {
    if (closed) return;
    closed = true; if (liveStepAudio === interrupt) liveStepAudio = null;
    doc.removeEventListener('visibilitychange', visibility); observer?.disconnect(); context.onstatechange = null;
    for (const voice of voices) { voice.onended = null; try { voice.stop(); } catch { /* not started */ } try { voice.disconnect(); } catch { /* already released */ } }
    voices.clear();
    try { master.disconnect(); } catch { /* already released */ }
    try { void context.close().catch(() => {}); } catch { /* already closed */ }
  };
  const interrupt = (reason: StepAudioInterrupt) => { if (closed) return; close(); options.onInterrupt(reason); };
  const visibility = () => { if (doc.hidden) interrupt('hidden'); };
  liveStepAudio = interrupt;
  doc.addEventListener('visibilitychange', visibility);
  const element = options.elementId ? doc.getElementById?.(options.elementId) : null;
  if (element && host.IntersectionObserver) { observer = new host.IntersectionObserver(entries => { if (entries.some(entry => !entry.isIntersecting)) interrupt('hidden'); }); observer.observe(element); }
  context.onstatechange = () => { if (started && context.state !== 'running') interrupt('suspended'); };
  const port: StepAudioPort = {
    now: () => context.currentTime,
    running: () => !closed && context.state === 'running',
    note(frequency, at, duration) {
      if (closed || voices.size >= STEP_AUDIO.maxVoices || !(frequency >= STEP_AUDIO.minHz && frequency <= STEP_AUDIO.maxHz) || !(duration > 0)) return false;
      const length = Math.min(STEP_AUDIO.maxNote, duration), start = Math.max(at, context.currentTime);
      const oscillator = context.createOscillator(), envelope = context.createGain();
      oscillator.type = options.voice; oscillator.frequency.setValueAtTime(frequency, start);
      envelope.gain.setValueAtTime(0, start); envelope.gain.linearRampToValueAtTime(STEP_AUDIO.peak[options.voice], start + Math.min(STEP_AUDIO.attack, length / 2)); envelope.gain.linearRampToValueAtTime(0, start + length);
      oscillator.connect(envelope); envelope.connect(master);
      oscillator.onended = () => { voices.delete(oscillator); try { oscillator.disconnect(); envelope.disconnect(); } catch { /* already released */ } };
      voices.add(oscillator); oscillator.start(start); oscillator.stop(start + length + .01);
      return true;
    },
    close,
  };
  let timer: ReturnType<typeof setTimeout> | undefined, resumed: Promise<void>;
  // Requested in this same call stack: a deferred resume() can fall outside the browser's user activation.
  try { resumed = context.resume(); } catch (error) { resumed = Promise.reject(error); }
  const ready = Promise.race([
    resumed.then(() => context.state === 'running', () => false),
    new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), STEP_AUDIO.activationMs); }),
  ]).then(ok => { clearTimeout(timer); if (ok && !closed) started = true; else close(); return ok && started; });
  return { port, ready };
}
/** Arrow, Home and End inside a grid. The handler returns true when it used the key. Nothing happens on native. */
export function attachGridKeys(element: unknown, handler: (key: string) => boolean): () => void {
  const node = element as BrowserElement | null;
  if (!browser().document || !node?.addEventListener) return () => {};
  const listener = (event: BrowserKeyEvent) => { if (!event.ctrlKey && !event.metaKey && handler(event.key)) { event.preventDefault(); event.stopPropagation(); } };
  node.addEventListener('keydown', listener); return () => node.removeEventListener('keydown', listener);
}
