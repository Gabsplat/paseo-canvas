// The only browser/DOM adapter. Loading this module never touches the DOM on native.
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { safeUrl } from './logic';
import { tokens } from './tokens';
import { frameSandbox } from './media';
import type { LinkMotionSample } from './renderers/types';
import { sanitizeSvg, SVG_LIMITS } from '../shared/svg';
import { useContentInteraction } from './interaction';
import { GL_LIMITS, joinSharedGL, surfacePixels, type GLClient } from './shared-gl';
interface BrowserEventTarget {
  addEventListener(name: string, listener: (event: BrowserKeyEvent) => void, capture?: boolean): void;
  removeEventListener(name: string, listener: (event: BrowserKeyEvent) => void, capture?: boolean): void;
}
interface BrowserElement extends BrowserEventTarget {
  id?: string;
  isConnected?: boolean;
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
interface BrowserKeyEvent { key: string; code?: string; altKey?: boolean; repeat?: boolean; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; target: BrowserElement | null; preventDefault(): void; stopPropagation(): void; deltaX: number; deltaY: number; clientX: number; clientY: number }
interface BrowserHost {
  document?: BrowserEventTarget & { hidden?: boolean; body: BrowserElement; createElement(tag: string): BrowserElement; getElementById?(id: string): BrowserElement | null };
  location?: { origin: string };
  navigator?: { platform?: string; userAgent?: string };
  Blob: new (parts: string[], options: { type: string }) => unknown;
  URL: { createObjectURL(blob: unknown): string; revokeObjectURL(url: string): void };
}
const browser = () => (Platform.OS === 'web' ? globalThis : {}) as unknown as BrowserHost;
/** Toolbar reset reaches the renderer's single handler, including pending edits and audio cleanup. */
export function activateRendererReset(root: unknown, id: string, isCurrent: () => boolean): boolean {
  const panel = root as BrowserElement | null;
  if (!browser().document || !panel || panel.isConnected === false || !isCurrent()) return false;
  const renderer = Array.from(panel.querySelectorAll?.('[id^="lienzo-interactive-renderer-"]') ?? []).find(node => node.getAttribute?.('id') === 'lienzo-interactive-renderer-' + id);
  const action = renderer?.querySelector('[aria-label="Reset"]');
  if (!action || action.getAttribute?.('aria-disabled') === 'true' || action.getAttribute?.('disabled') != null || !isCurrent()) return false;
  action.click();
  return true;
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
export function WebFrame({ url, title, border, height, surface, player = false, bare = false, onLoaded, onTimeout }: { url: string; title: string; border: string; height: number | '100%'; surface: string; player?: boolean; bare?: boolean; onLoaded?: () => void; onTimeout?: () => void }) {
  const interacting = useContentInteraction(), safe = safeUrl(url), [loaded, setLoaded] = useState(false);
  useEffect(() => { if (Platform.OS !== 'web') return; setLoaded(false); const timer = setTimeout(() => onTimeout?.(), 8000); return () => clearTimeout(timer); }, [safe]);
  if (Platform.OS !== 'web' || !safe) return null;
  return React.createElement('div', { id: `lienzo-${interacting ? 'interactive' : 'passive'}-frame-${title}`, 'data-lienzo-interacting': interacting ? 'true' : 'false', style: { position: 'relative', height, width: '100%', border: bare ? 0 : `1px solid ${border}`, borderRadius: bare ? 0 : 6, overflow: 'hidden', backgroundColor: surface } },
    React.createElement('iframe', { key: safe, src: safe, title, sandbox: frameSandbox(safe, browser().location?.origin), referrerPolicy: 'strict-origin-when-cross-origin', loading: 'lazy', allow: player ? 'encrypted-media; fullscreen; picture-in-picture' : 'fullscreen', allowFullScreen: true, onLoad: () => { setLoaded(true); onLoaded?.(); }, style: { width: '100%', height: '100%', border: 0, opacity: loaded ? 1 : 0, pointerEvents: interacting ? 'auto' : 'none' }, 'aria-label': loaded ? title : `Loading ${title}` }), !interacting && React.createElement('div', { 'aria-label': 'Double-click to interact', style: { position: 'absolute', inset: 0, background: 'transparent' } }));
}
/**
 * What every mini app gets before its own code: a `lienzo` object that talks to the canvas page through messages. It
 * only believes messages from the canvas page: mini apps can post to each other, and one must not pass for the canvas.
 * `setState` stores a small JSON value on the block for the agent to read; `send` is kept for pages written before it
 * and only records the last call on the block. Nothing a page does reaches the agent by itself. It also reports the height
 * of the page's content (`fit`) whenever it changes, so a window without a stored size can fit it.
 */
export const HTML_APP_BRIDGE = "<script>(function(){var l=[],c=null,m=[],r=null,w={},q=0;function post(m){m.lienzo=1;parent.postMessage(m,'*')}window.lienzo={setState:function(v){return new Promise(function(ok,no){var id=++q;w[id]={ok:ok,no:no};post({type:'state',id:id,value:v===undefined?null:v})})},get state(){return c&&c.state!==undefined?c.state:null},send:function(k,p){post({type:'event',kind:String(k),payload:p===undefined?null:p})},resize:function(h){post({type:'resize',height:Number(h)})},select:function(id){post({type:'select',id:String(id)})},onContext:function(f){l.push(f);if(c)f(c)},get context(){return c},onFrame:function(f){m.push(f);if(r)f(r)},get frame(){return r}};addEventListener('message',function(e){var d=e.data;if(!d||d.lienzo!==1||e.source!==parent)return;if(d.type==='frame'){r=d.frame;m.forEach(function(f){try{f(r)}catch(_){}});return}if(d.type==='stored'){var x=w[d.id];if(!x)return;delete w[d.id];if(d.ok)x.ok();else x.no(new Error(d.error||'Not saved'));return}if(d.type!=='context')return;c=d.context;try{document.documentElement.style.colorScheme=c.theme.dark?'dark':'light'}catch(_){}l.forEach(function(f){try{f(c)}catch(_){}})});post({type:'ready'});var fh=0,fs=0;function fit(){fs=0;try{var d=document.documentElement,h=d.scrollHeight>d.clientHeight+1?d.scrollHeight:Math.ceil(d.getBoundingClientRect().height);if(h>0&&Math.abs(h-fh)>=2){fh=h;post({type:'fit',height:h,width:d.scrollWidth})}}catch(_){}}function soon(){if(fs)return;fs=1;try{(typeof requestAnimationFrame==='function'?requestAnimationFrame:setTimeout)(fit)}catch(_){fs=0}}function watch(){try{var o=new ResizeObserver(soon);o.observe(document.documentElement);if(document.body)o.observe(document.body)}catch(_){}try{new MutationObserver(soon).observe(document.documentElement,{childList:true,subtree:true,characterData:true})}catch(_){}try{addEventListener('load',soon)}catch(_){}soon()}try{if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',watch);else watch()}catch(_){}})();</script>";
export type HtmlAppMessage = { type: 'ready' } | { type: 'state'; id: unknown; value: unknown } | { type: 'event'; kind: unknown; payload: unknown } | { type: 'resize'; height: unknown } | { type: 'fit'; height: unknown; width?: unknown } | { type: 'select'; id: unknown };
/**
 * A page written by the author or an agent, running in a sandboxed frame with an opaque origin: scripts run, but it
 * cannot reach the canvas page, its storage or its cookies. It hears only the context it is sent and is heard only
 * through messages from its own window.
 */
export function WebHtml({ id, html, title, surface, context, onMessage }: { id: string; html: string; title: string; surface: string; context: unknown; onMessage(message: HtmlAppMessage, reply: (message: Record<string, unknown>) => void): void }) {
  const interacting = useContentInteraction(), frame = useRef<{ contentWindow?: { postMessage(message: unknown, target: string): void } | null } | null>(null), ready = useRef(false), latest = useRef({ context, onMessage }); latest.current = { context, onMessage };
  const post = () => { try { frame.current?.contentWindow?.postMessage({ lienzo: 1, type: 'context', context: latest.current.context }, '*'); } catch {} };
  useEffect(() => {
    const host = globalThis as unknown as { addEventListener?(type: string, listener: (event: { source: unknown; data: unknown }) => void): void; removeEventListener?(type: string, listener: (event: { source: unknown; data: unknown }) => void): void };
    if (Platform.OS !== 'web' || !host.addEventListener) return;
    const listen = (event: { source: unknown; data: unknown }) => {
      const data = event.data as { lienzo?: unknown; type?: unknown } | null;
      if (!frame.current?.contentWindow || event.source !== frame.current.contentWindow || !data || data.lienzo !== 1 || typeof data.type !== 'string') return;
      if (data.type === 'ready') { ready.current = true; post(); } else if (['state', 'event', 'resize', 'fit', 'select'].includes(data.type)) latest.current.onMessage(data as HtmlAppMessage, message => { try { frame.current?.contentWindow?.postMessage({ lienzo: 1, ...message }, '*'); } catch {} });
    };
    host.addEventListener('message', listen); return () => { host.removeEventListener?.('message', listen); ready.current = false; };
  }, [html]);
  const key = JSON.stringify(context); useEffect(() => { if (ready.current) post(); }, [key]);
  // The page also hears where its window is on screen and where the other mini apps are, every time that changes: a
  // drag never reaches the document until it ends, so this is how a page reacts to being moved or to what is beside it.
  useEffect(() => {
    type Box = { getBoundingClientRect(): { left: number; top: number; width: number; height: number } };
    const host = globalThis as unknown as { requestAnimationFrame?(tick: () => void): number; cancelAnimationFrame?(id: number): void; document?: { querySelectorAll(selector: string): ArrayLike<Box> } };
    if (Platform.OS !== 'web' || !host.requestAnimationFrame || !host.document) return;
    const box = (node: Box) => { const r = node.getBoundingClientRect(); return { x: Math.round(r.left * 10) / 10, y: Math.round(r.top * 10) / 10, width: Math.round(r.width * 10) / 10, height: Math.round(r.height * 10) / 10 }; };
    let request = 0, sent = '';
    const tick = () => {
      request = host.requestAnimationFrame!(tick);
      const self = frame.current as unknown as (Box & { contentWindow?: { postMessage(message: unknown, target: string): void } | null }) | null;
      if (!self?.contentWindow || !ready.current) { sent = ''; return; }
      const message = { ...box(self), others: Array.from(host.document!.querySelectorAll('iframe[data-lienzo-app]')).filter(node => node !== self).map(box) }, text = JSON.stringify(message);
      if (text === sent) return;
      sent = text; try { self.contentWindow.postMessage({ lienzo: 1, type: 'frame', frame: message }, '*'); } catch {}
    };
    request = host.requestAnimationFrame(tick); return () => host.cancelAnimationFrame?.(request);
  }, [html]);
  if (Platform.OS !== 'web') return null;
  return React.createElement('div', { id: `lienzo-${interacting ? 'interactive' : 'passive'}-html-${id}`, 'data-lienzo-interacting': interacting ? 'true' : 'false', style: { position: 'relative', height: '100%', width: '100%', overflow: 'hidden', backgroundColor: surface } },
    React.createElement('iframe', { key: html, ref: frame, srcDoc: HTML_APP_BRIDGE + html, title, 'data-lienzo-app': 'true', sandbox: 'allow-scripts allow-forms allow-modals allow-pointer-lock allow-popups', referrerPolicy: 'no-referrer', allow: 'fullscreen', style: { width: '100%', height: '100%', border: 0, display: 'block', pointerEvents: interacting ? 'auto' : 'none' } }),
    !interacting && React.createElement('div', { 'aria-label': 'Double-click to interact', style: { position: 'absolute', inset: 0, background: 'transparent' } }));
}
export type ExtensionCall = { method: string; args: Record<string, unknown> };
/**
 * The frame an extension runs in. Same isolation as a mini app (opaque origin, scripts only), always interactive, and
 * a request/response channel on top: the page calls a method, `onCall` answers or throws, and the page gets the result.
 * Everything else (the context and its patches, the view, keys) goes through `channel` once the page is listening;
 * `onReady` says when it is, after every load.
 */
/**
 * `passThrough`: an overlay that lets the pointer reach the canvas under it (lienzo.ui.capturePointer turns it off).
 * `onEscape`: Esc pressed inside the page and not bound by it. A transparent `surface` keeps the frame see-through: the
 * page's own background (none by default) is all that paints.
 */
export function WebExtension({ id, source, title, surface, onCall, onReady, channel, passThrough, onEscape, onHover }: { id: string; source: string; title: string; surface: string; onCall(call: ExtensionCall): Promise<unknown>; onReady?(): void; channel?: { current: ((message: Record<string, unknown>) => void) | null }; passThrough?: boolean; onEscape?(): void; onHover?(inside: boolean): void }) {
  const frame = useRef<{ contentWindow?: { postMessage(message: unknown, target: string): void } | null } | null>(null), ready = useRef(false), latest = useRef({ onCall, onReady, onEscape }); latest.current = { onCall, onReady, onEscape };
  const post = (message: Record<string, unknown>) => { try { frame.current?.contentWindow?.postMessage({ lienzo: 1, ...message }, '*'); } catch {} };
  // Messages besides the context and results (the view, a key), once the page is listening.
  if (channel) channel.current = message => { if (ready.current) post(message); };
  useEffect(() => {
    const host = globalThis as unknown as { addEventListener?(type: string, listener: (event: { source: unknown; data: unknown }) => void): void; removeEventListener?(type: string, listener: (event: { source: unknown; data: unknown }) => void): void };
    if (Platform.OS !== 'web' || !host.addEventListener) return;
    const listen = (event: { source: unknown; data: unknown }) => {
      const data = event.data as { lienzo?: unknown; type?: unknown; id?: unknown; method?: unknown; args?: unknown } | null;
      if (!frame.current?.contentWindow || event.source !== frame.current.contentWindow || !data || data.lienzo !== 1) return;
      if (data.type === 'ready') { ready.current = true; latest.current.onReady?.(); }
      else if (data.type === 'escape') latest.current.onEscape?.();
      else if (data.type === 'call' && typeof data.id === 'number' && typeof data.method === 'string') { const callId = data.id;
        Promise.resolve().then(() => latest.current.onCall({ method: data.method as string, args: data.args && typeof data.args === 'object' ? data.args as Record<string, unknown> : {} }))
          .then(value => post({ type: 'result', id: callId, ok: true, value: value ?? null }), error => post({ type: 'result', id: callId, ok: false, error: error instanceof Error ? error.message : String(error) })); }
    };
    host.addEventListener('message', listen); return () => { host.removeEventListener?.('message', listen); ready.current = false; };
  }, [source]);
  if (Platform.OS !== 'web') return null;
  return React.createElement('div', { id: `lienzo-extension-${id}`, 'data-lienzo-interacting': 'true', onMouseEnter: onHover && (() => onHover(true)), onMouseLeave: onHover && (() => onHover(false)), style: { position: 'relative', height: '100%', width: '100%', overflow: 'hidden', backgroundColor: surface, pointerEvents: passThrough ? 'none' : 'auto' } },
    React.createElement('iframe', { key: source, ref: frame, srcDoc: source, title, sandbox: 'allow-scripts allow-forms allow-modals allow-pointer-lock', referrerPolicy: 'no-referrer', allow: 'fullscreen', allowtransparency: 'true', style: { width: '100%', height: '100%', border: 0, display: 'block', background: 'transparent', colorScheme: 'normal', pointerEvents: passThrough ? 'none' : 'auto' } }));
}
/**
 * Keys an open extension took with lienzo.keys.bind, from anywhere in the page: heard first (window, capture) so the
 * canvas' shortcuts never see them, and left alone while the person types in a field.
 */
export function listenExtensionKeys(route: (event: { key: string; code?: string; shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }, typing: boolean) => string | null, onKey: (name: string) => void): () => void {
  const host = globalThis as unknown as { addEventListener?(type: string, listener: (event: BrowserKeyEvent) => void, capture: boolean): void; removeEventListener?(type: string, listener: (event: BrowserKeyEvent) => void, capture: boolean): void };
  if (Platform.OS !== 'web' || !host.addEventListener) return () => {};
  const listener = (event: BrowserKeyEvent) => {
    const target = event.target as { tagName?: string; isContentEditable?: boolean } | null, typing = !!target && (!!target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName ?? ''));
    const name = route(event as never, typing); if (!name) return;
    event.preventDefault(); (event as { stopImmediatePropagation?(): void }).stopImmediatePropagation?.(); event.stopPropagation(); onKey(name);
  };
  host.addEventListener('keydown', listener, true); return () => host.removeEventListener?.('keydown', listener, true);
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
  return React.createElement('div', { style: { position: 'relative', height: kind === 'audio' ? tokens.media.audio.height : height, width: '100%' } }, React.createElement(kind, { key: safe, ref: element, src: safe, controls: true, preload: tokens.media[kind].preload, playsInline: true, 'aria-label': title, onError, style: { display: 'block', width: '100%', height: kind === 'audio' ? tokens.media.audio.height : height, borderRadius: 6, backgroundColor: surface, objectFit: 'contain', pointerEvents: interacting ? 'auto' : 'none' } }), !interacting && React.createElement('div', { 'aria-label': 'Double-click to interact', style: { position: 'absolute', inset: 0, background: 'transparent' } }));
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
/** Any text file through the browser (a .lienzo file). The name keeps its words; only what file systems refuse goes. */
export function downloadText(text: string, filename: string, mime: string): boolean {
  try { const host = browser(); if (!host.document) return false;
  const url = host.URL.createObjectURL(new host.Blob([text], { type: mime })), a = host.document.createElement('a'); a.href = url; a.download = filename.replace(/[\\/:*?"<>|]/g, '_');
  host.document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => host.URL.revokeObjectURL(url), 1000); return true; } catch { return false; }
}
export function pickJsonFile(maxBytes = 1048576): Promise<string | null> {
  const host = browser(); if (!host.document) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const input = host.document!.createElement('input'); input.type = 'file'; input.accept = '.json,application/json';
    const cleanup = () => input.remove();
    input.addEventListener('cancel', () => { cleanup(); resolve(null); });
    input.addEventListener('change', () => { const file = input.files?.[0]; if (!file) { cleanup(); resolve(null); } else if (file.size > maxBytes) { cleanup(); reject(new Error('The file is larger than 1 MB.')); } else void file.text().then(text => { cleanup(); resolve(text); }).catch(error => { cleanup(); reject(error); }); });
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
      if (file.size > SVG_LIMITS.bytes) { reject(new Error('The SVG is larger than 64 KB.')); return; }
      void file.text().then(text => resolve(sanitizeSvg(text).svg)).catch(reject);
    });
    input.click();
  });
}
/** Browser fetch only. Read a bounded body, then validate with the same static dialect as the server. */
export async function fetchSvgUrl(value: string): Promise<string> {
  const url = safeUrl(value); if (!browser().document || !url) throw new Error('Use a valid HTTP or HTTPS address in the browser.');
  type Response = { ok: boolean; url?: string; headers: { get(name: string): string | null }; body?: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel(): Promise<void> } } | null };
  const host = globalThis as unknown as { fetch(url: string, options: { credentials: string; signal: unknown }): Promise<Response>; AbortController: new () => { signal: unknown; abort(): void }; TextDecoder: new () => { decode(value: Uint8Array): string } };
  const abort = new host.AbortController(), timeout = setTimeout(() => abort.abort(), 10000);
  try {
    const response = await host.fetch(url, { credentials: 'omit', signal: abort.signal });
    if (!response.ok || response.url && !safeUrl(response.url)) throw new Error('The SVG could not be loaded.');
    if (Number(response.headers.get('content-length')) > SVG_LIMITS.bytes) throw new Error('The SVG is larger than 64 KB.');
    const reader = response.body?.getReader(); if (!reader) throw new Error('The SVG could not be read.');
    const chunks: Uint8Array[] = []; let bytes = 0;
    for (;;) { const part = await reader.read(); if (part.done) break; if (!part.value) continue; bytes += part.value.byteLength; if (bytes > SVG_LIMITS.bytes) { await reader.cancel(); throw new Error('The SVG is larger than 64 KB.'); } chunks.push(part.value); }
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
    // A passive surface (a shader that is only a picture) pans like the canvas around it.
    const legacy = target?.closest?.('[id^="lienzo-surface-"]') ? null : target?.closest?.('[id^="lienzo-interactive-"]');
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
/**
 * A press on empty canvas, a pencil stroke, or a button that then disables itself leaves browser focus on <body>, so
 * the keys that follow would never reach a listener on the panel. Keys typed while nothing is focused go to the panel
 * that was pressed last. The pressed ancestors are remembered at press time, at module level: listeners are replaced
 * on every render that changes their handler, and the pressed element itself may be gone by the time a key arrives.
 */
let pressedChain = new WeakSet<object>(), stopPressTracking: (() => void) | undefined, keyScopes = 0;
function listenKeys(node: BrowserElement, listener: (event: BrowserKeyEvent) => void, capture: boolean): () => void {
  const doc = browser().document!;
  if (!keyScopes++) {
    const press = (event: BrowserKeyEvent) => { pressedChain = new WeakSet(); for (let element = event.target as (BrowserElement & { parentElement?: BrowserElement | null }) | null; element; element = element.parentElement ?? null) pressedChain.add(element); };
    doc.addEventListener('pointerdown', press, true); stopPressTracking = () => doc.removeEventListener('pointerdown', press, true);
  }
  const unfocused = (event: BrowserKeyEvent) => { if (event.target === doc.body && pressedChain.has(node)) listener(event); };
  node.addEventListener('keydown', listener, capture); doc.addEventListener('keydown', unfocused, capture);
  return () => { node.removeEventListener('keydown', listener, capture); doc.removeEventListener('keydown', unfocused, capture); if (!--keyScopes) { stopPressTracking?.(); stopPressTracking = undefined; } };
}
export type PanelKey = { key: string; code?: string; shift: boolean; command: boolean; alt: boolean; repeat: boolean; typing: boolean };
const keyOf = (event: BrowserKeyEvent, typing: boolean): PanelKey => ({ key: event.key, code: event.code, shift: event.shiftKey, command: event.ctrlKey || event.metaKey, alt: !!event.altKey, repeat: !!event.repeat, typing });
const FIELDS = 'input,textarea,select,[contenteditable="true"],iframe,video,audio';
/**
 * Panel keys. Keys typed into a field, a frame or an interactive control are left alone, except the ones `global`
 * accepts (the command palette's ⌘K works from the composer too); those arrive with `typing: true`.
 */
export function keyboard(element: unknown, handler: (event: PanelKey) => boolean, global?: (event: PanelKey) => boolean): () => void {
  const node = element as BrowserElement | null;
  if (!browser().document || !node?.addEventListener) return () => {};
  const listener = (event: BrowserKeyEvent) => {
    const target = event.target;
    // Tab, Enter and Space on a control in the Properties panel or a dialog move focus or press it, as on any page.
    if ((event.key === 'Tab' || event.key === 'Enter' || event.key === ' ') && !event.metaKey && !event.ctrlKey && target?.closest('#lienzo-right-panel,[role="dialog"]')) return;
    if (target?.closest(FIELDS + ',[id^="lienzo-interactive-"]')) { if (global && !target.closest('iframe') && global(keyOf(event, true))) { event.preventDefault(); event.stopPropagation(); } return; }
    if (handler(keyOf(event, false))) { event.preventDefault(); event.stopPropagation(); }
  };
  return listenKeys(node, listener, false);
}
/** The next key combination pressed anywhere in the page, for reassigning a shortcut. Modifier-only presses wait. */
export function captureKeys(handler: (event: PanelKey) => boolean): () => void {
  const doc = browser().document; if (!doc) return () => {};
  const listener = (event: BrowserKeyEvent) => { if (['Shift', 'Control', 'Meta', 'Alt'].includes(event.key)) return; if (handler(keyOf(event, false))) { event.preventDefault(); event.stopPropagation(); } };
  doc.addEventListener('keydown', listener, true);
  return () => doc.removeEventListener('keydown', listener, true);
}
/** Whether the person is typing in a field of the page now (an input, a text area, editable text). */
export function isTyping(): boolean {
  const active = (browser().document as { activeElement?: unknown } | undefined)?.activeElement as { tagName?: string; isContentEditable?: boolean } | null | undefined;
  return !!active && (!!active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName ?? ''));
}
/** Escape anywhere in the page while a screen is open (bubbling, so a key recorder or a field can take it first). */
/** Escape anywhere in the page. `capture` also hears it from a focused text field (react-native-web stops its keys). */
export function onEscapeKey(handler: () => boolean, capture = false): () => void {
  const doc = browser().document; if (!doc) return () => {};
  const listener = (event: BrowserKeyEvent) => { if (event.key === 'Escape' && handler()) { event.preventDefault(); event.stopPropagation(); } };
  doc.addEventListener('keydown', listener, capture);
  return () => doc.removeEventListener('keydown', listener, capture);
}
/** Enter outside text fields and controls that take it themselves (a dialog's primary action). Native ignores it. */
export function onEnterKey(handler: () => boolean): () => void {
  const doc = browser().document; if (!doc) return () => {};
  const listener = (event: BrowserKeyEvent) => { if (event.key === 'Enter' && !event.repeat && !isTextTarget(event.target) && !event.target?.closest?.('button,a,[role="button"],[role="checkbox"],[role="menuitem"]') && handler()) { event.preventDefault(); event.stopPropagation(); } };
  doc.addEventListener('keydown', listener);
  return () => doc.removeEventListener('keydown', listener);
}
/** ⌘ on Apple platforms, Ctrl elsewhere. Native clients ask React Native. */
export function isMacPlatform(): boolean {
  if (Platform.OS === 'ios' || Platform.OS === 'macos') return true;
  const nav = browser().navigator; return /mac|iphone|ipad/i.test(nav?.platform ?? nav?.userAgent ?? '');
}
/**
 * After a drag or a pan the browser still sends a click to whatever is under the pointer when the button comes up,
 * and a Pressable there would take it as a press (selecting, or collapsing a multi-selection). Call this when a
 * gesture that moved ends: the one click that follows is dropped before React sees it. Nothing happens on native.
 */
/**
 * Show `cursor` everywhere for the length of a gesture (a resize, whose pointer soon leaves the small handle it
 * started on), whatever element is under the pointer: inner elements that set their own cursor cannot override it.
 * Null releases it. Nothing happens on native.
 */
export function holdCursor(cursor: string | null) {
  const doc = browser().document; if (!doc) return;
  const old = doc.getElementById?.('lienzo-held-cursor'); if (!cursor) { old?.remove(); return; }
  const style = old ?? doc.createElement('style'); style.setAttribute('id', 'lienzo-held-cursor');
  (style as unknown as { textContent: string }).textContent = `*,*::before,*::after{cursor:${cursor}!important}`;
  if (!old) doc.body.appendChild(style);
}
/** While the primary button is held over `element`, show `cursor()` (the closed hand of the hand tool). Null leaves it alone. */
export function attachPressCursor(element: unknown, cursor: () => string | null): () => void {
  const node = element as (BrowserElement & { style?: { cursor: string } }) | null, doc = browser().document; if (!doc || !node?.addEventListener || !node.style) return () => {};
  let before: string | null = null;
  const down = (e: BrowserKeyEvent & { button?: number }) => { const value = e.button === 0 ? cursor() : null; if (value && before === null) { before = node.style!.cursor; node.style!.cursor = value; } };
  const up = () => { if (before !== null) { node.style!.cursor = before; before = null; } };
  node.addEventListener('pointerdown', down, true); doc.addEventListener('pointerup', up, true); doc.addEventListener('pointercancel', up, true);
  return () => { up(); node.removeEventListener('pointerdown', down, true); doc.removeEventListener('pointerup', up, true); doc.removeEventListener('pointercancel', up, true); };
}
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
export type CanvasPointer = { x: number; y: number; shift: boolean; command: boolean; pointerId: number; alt?: boolean };
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
  const point = (e: Event): CanvasPointer => ({ x: e.clientX, y: e.clientY, shift: e.shiftKey, command: e.ctrlKey || e.metaKey, alt: !!e.altKey, pointerId: e.pointerId ?? 0 });
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
const CONTROLS = 'button,a,input,select,textarea,[role="button"],[role="checkbox"],[role="radio"],[role="slider"],[role="switch"],[role="menuitem"],[role="link"]';
/** A control (Play, Reset, a checkbox…) inside a card's interactive region: its press is the control's, never a card drag.
 * The card's own grab area is a button too, but it is not inside an interactive region, so the picture still drags. */
export function isCardControl(target: unknown): boolean {
  const control = pointerElement(target)?.closest?.(CONTROLS);
  return !!control?.closest?.('[id^="lienzo-interactive-"]');
}
export type EntityPointerHandlers = {
  enabled(): boolean;
  /** A plain click on a part of the entity that is not itself a control: its text, its padding. */
  press?(id: string, point: CanvasPointer): void;
  start(id: string, point: CanvasPointer): void;
  move(point: CanvasPointer): void;
  end(cancelled: boolean, velocity: { vx: number; vy: number }): void;
  /** Whether a press may move `id` (logic.ts pressRole): a Frame answers by whether the press is on its header. Absent: always. */
  role?(id: string, onHeader: boolean): 'move' | 'select' | 'canvas';
  /** A double-click. `id` is the entity under it, null on the bare canvas; `point` is where, in page pixels. */
  edit?(id: string | null, point: CanvasPointer): void;
};
/**
 * Whiteboard resize handles (`lienzo-interactive-resize-<id>-<handle>`) by pointer events, not the responder system:
 * react-native-web drops any press or move with Alt held and reports altKey false, so Alt (from the centre) never
 * reached a held handle. Shift and Alt pressed or let go mid-drag apply at once.
 */
export function attachResizeHandles(element: unknown, handlers: { start(id: string, handle: string, point: CanvasPointer): boolean; move(point: CanvasPointer): void; end(cancelled: boolean): void }): () => void {
  const node = element as BrowserElement | null, doc = browser().document; if (!doc || !node?.addEventListener) return () => {};
  type Event = BrowserKeyEvent & { button?: number; pointerId?: number };
  let current: CanvasPointer | null = null;
  const point = (e: Event): CanvasPointer => ({ x: e.clientX, y: e.clientY, shift: e.shiftKey, command: e.ctrlKey || e.metaKey, alt: !!e.altKey, pointerId: e.pointerId ?? 0 });
  const down = (e: Event) => {
    const target = e.button === 0 ? pointerElement(e.target)?.closest?.('[id^="lienzo-interactive-resize-"]') : null; if (!target?.id) return;
    const rest = target.id.slice('lienzo-interactive-resize-'.length), cut = rest.lastIndexOf('-'), p = point(e);
    if (cut < 1 || !handlers.start(rest.slice(0, cut), rest.slice(cut + 1), p)) return;
    current = p; try { node.setPointerCapture?.(p.pointerId); } catch {} e.preventDefault(); e.stopPropagation();
  };
  const move = (e: Event) => { if (!current || current.pointerId !== (e.pointerId ?? 0)) return; current = point(e); handlers.move(current); e.preventDefault(); e.stopPropagation(); };
  const finish = (cancelled: boolean) => { const p = current; current = null; if (!p) return; try { node.releasePointerCapture?.(p.pointerId); } catch {} handlers.end(cancelled); if (!cancelled) swallowClick(); };
  const up = (e: Event) => { if (!current || current.pointerId !== (e.pointerId ?? 0)) return; finish(false); e.preventDefault(); e.stopPropagation(); };
  const cancel = () => finish(true);
  const key = (e: BrowserKeyEvent) => {
    if (!current) return; if (e.key === 'Escape') { cancel(); e.preventDefault(); e.stopPropagation(); return; }
    if (e.key === 'Shift' || e.key === 'Alt') { current = { ...current, shift: e.shiftKey, alt: !!e.altKey }; handlers.move(current); e.preventDefault(); }
  };
  node.addEventListener('pointerdown', down, true); doc.addEventListener('pointermove', move, true); doc.addEventListener('pointerup', up, true); doc.addEventListener('pointercancel', cancel, true); doc.addEventListener('keydown', key, true); doc.addEventListener('keyup', key, true);
  return () => { cancel(); node.removeEventListener('pointerdown', down, true); doc.removeEventListener('pointermove', move, true); doc.removeEventListener('pointerup', up, true); doc.removeEventListener('pointercancel', cancel, true); doc.removeEventListener('keydown', key, true); doc.removeEventListener('keyup', key, true); };
}
/** Capture only after movement, so ordinary clicks still reach all nested controls. */
export function attachEntityDrag(element: unknown, handlers: EntityPointerHandlers, threshold = 4): () => void {
  const node = element as BrowserElement | null, doc = browser().document; if (!doc || !node?.addEventListener) return () => {};
  type Event = BrowserKeyEvent & { button?: number; pointerId?: number; buttons?: number };
  let pending: { id: string; start: CanvasPointer; last: CanvasPointer; time: number; active: boolean } | null = null;
  let velocity = { vx: 0, vy: 0 };
  const point = (e: Event): CanvasPointer => ({ x: e.clientX, y: e.clientY, shift: e.shiftKey, command: e.ctrlKey || e.metaKey, alt: !!e.altKey, pointerId: e.pointerId ?? 0 });
  const entity = (e: Event) => pointerElement(e.target)?.closest?.('[id^="lienzo-entity-"]')?.id?.slice('lienzo-entity-'.length);
  const down = (e: Event) => {
    if (e.button !== 0 || !handlers.enabled() || isEditingTarget(e.target) || isCardControl(e.target) || pointerElement(e.target)?.closest?.('[id^="lienzo-interactive-resize-"],[id^="lienzo-link-handle-"]')) return;
    const id = entity(e); if (!id) return;
    // A Frame's body is canvas: the press is left to the selection box (or the hand) underneath.
    if (handlers.role && handlers.role(id, pointerElement(e.target)?.closest?.('[id^="lienzo-frame-header-"]')?.id === 'lienzo-frame-header-' + id) !== 'move') return;
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
  const key = (e: BrowserKeyEvent) => { if (e.key === 'Escape' && pending) { cancel(); e.preventDefault(); e.stopPropagation(); } else modifier(e); };
  // Shift or Alt pressed or let go while the hand is still: the drag hears it at once (axis lock, duplicate).
  const modifier = (e: BrowserKeyEvent) => { const state = pending; if (!state?.active || (e.key !== 'Shift' && e.key !== 'Alt')) return; state.last = { ...state.last, shift: e.shiftKey, alt: !!e.altKey }; handlers.move(state.last); };
  const edit = (e: Event) => {
    if (isEditingTarget(e.target)) return; const id = entity(e) ?? null;
    // Off every entity only the bare canvas counts: not the minimap, zoom, lens or another island over it.
    if (!id && pointerElement(e.target)?.closest?.(`${CONTROLS},[id^="lienzo-interactive-"],[id^="lienzo-tools"]`)) return;
    handlers.edit?.(id, point(e));
  };
  const press = (e: Event) => { if (!handlers.press || !handlers.enabled() || isEditingTarget(e.target) || pointerElement(e.target)?.closest?.('[role="button"],[role="checkbox"],[role="menuitem"],[role="radio"],button,a,[id^="lienzo-interactive-"],[id^="lienzo-link-handle-"],[id^="lienzo-using-"]')) return; const id = entity(e); if (id) handlers.press(id, point(e)); };
  node.addEventListener('click', press);
  node.addEventListener('pointerdown', down, true); node.addEventListener('dblclick', edit); doc.addEventListener('pointermove', move, true); doc.addEventListener('pointerup', up, true); doc.addEventListener('pointercancel', cancel, true); doc.addEventListener('keydown', key, true); doc.addEventListener('keyup', modifier, true);
  return () => { cancel(); doc.removeEventListener('keyup', modifier, true); node.removeEventListener('click', press); node.removeEventListener('pointerdown', down, true); node.removeEventListener('dblclick', edit); doc.removeEventListener('pointermove', move, true); doc.removeEventListener('pointerup', up, true); doc.removeEventListener('pointercancel', cancel, true); doc.removeEventListener('keydown', key, true); };
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
  /** Width of the pointer target when it differs from the scene's (a lane of a bundle is narrow). */
  hit?: number;
  arrow: { x: number; y: number; side: 'top' | 'bottom' | 'left' | 'right'; length: number; width: number } | null;
  label: { x: number; y: number; text: string; color: string } | null;
  badge: { x: number; y: number; text: string; fill: string; color: string; radius: number } | null;
};
/** A bundle's tie: a thin rounded band across the strand, centred on (x, y), its long side turned `angle` degrees; `scale` grows it in. */
export type TieDraw = { key: string; x: number; y: number; angle: number; length: number; thickness: number; fill: string; halo: string; haloWidth: number; opacity: number; scale?: number };
/** A thin outline around a bundle's trunk (`d` a closed path, stroked, never filled), shown while the bundle is in focus. */
export type BandDraw = { key: string; d: string; width: number; color: string; opacity: number };
export type LinkScene = { draws: LinkDraw[]; origin: { x: number; y: number }; halo: string; font: string; labelSize: number; badgeSize: number; hitWidth: number; motion?: (epochMs: number) => LinkMotionSample; ties?: TieDraw[]; bands?: BandDraw[] };
interface SvgNode {
  setAttribute(name: string, value: string): void; removeAttribute(name: string): void; appendChild(child: SvgNode): void; remove(): void;
  addEventListener(name: string, listener: (event: { stopPropagation(): void; preventDefault(): void; shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }) => void): void; textContent: string | null;
  getTotalLength?(): number; getPointAtLength?(distance: number): { x: number; y: number };
}
type SvgHost = { document?: { createElementNS(namespace: string, tag: string): SvgNode } };
/** `element` holds the lines (under the cards); `marksElement`, when given, holds labels and counts (over the cards). */
export function mountLinkLayer(element: unknown, handlers: { onPress(key: string, add: boolean): void; onHover(key: string | null): void }, marksElement?: unknown): { update(scene: LinkScene): void; preview(draw: Pick<LinkDraw, 'd' | 'color' | 'width' | 'opacity' | 'dash'> | null): void; destroy(): void } | null {
  if (Platform.OS !== 'web') return null;
  type Host = { appendChild?(child: SvgNode): void } | null;
  const doc = (globalThis as unknown as SvgHost).document, host = element as Host, marksHost = marksElement as Host;
  if (!doc?.createElementNS || !host?.appendChild) return null;
  const make = (tag: string, attributes: Record<string, string> = {}) => { const node = doc.createElementNS('http://www.w3.org/2000/svg', tag); for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value); return node; };
  const surface = () => make('svg', { width: '100%', height: '100%', style: 'position:absolute;left:0;top:0;overflow:visible;pointer-events:none', 'aria-hidden': 'true' });
  const svg = surface(), root = make('g'), lines = make('g'), marks = make('g'), draft = make('path', { fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'pointer-events': 'none', 'data-lienzo-draft': 'true' });
  // Bundles: the focus outline under the lanes, the ties over them (still under the cards and the labels).
  const bands = make('g', { 'pointer-events': 'none', 'data-lienzo-bands': 'true' }), ties = make('g', { 'pointer-events': 'none', 'data-lienzo-ties': 'true' });
  root.appendChild(bands); root.appendChild(lines); root.appendChild(ties); root.appendChild(draft); svg.appendChild(root); host.appendChild(svg);
  let tiesDrawn = '';
  const above = marksHost?.appendChild ? surface() : null;
  if (above) { above.appendChild(marks); marksHost!.appendChild!(above); } else root.appendChild(marks);
  type Entry = { group: SvgNode; line: SvgNode; hit: SvgNode; head: SvgNode; mark: SvgNode; label: SvgNode; badge: SvgNode; badgeDisc: SvgNode; badgeText: SvgNode; tip: SvgNode; seen: boolean; drawn: string };
  const entries = new Map<string, Entry>();
  const entry = (key: string): Entry => {
    let e = entries.get(key); if (e) return e;
    const group = make('g', { 'data-link-key': key }), line = make('path', { fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }), head = make('path'), tip = make('title');
    const hit = make('path', { fill: 'none', stroke: 'transparent', 'stroke-linecap': 'round' });
    hit.addEventListener('click', event => { event.stopPropagation(); handlers.onPress(key, !!(event.shiftKey || event.metaKey || event.ctrlKey)); });
    hit.addEventListener('pointerenter', () => handlers.onHover(key)); hit.addEventListener('pointerleave', () => handlers.onHover(null));
    hit.appendChild(tip); group.appendChild(line); group.appendChild(head); group.appendChild(hit); lines.appendChild(group);
    // Text sits in a later group so no connector ever paints over a label.
    const mark = make('g', { style: 'pointer-events:none' }), label = make('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', 'paint-order': 'stroke', 'stroke-linejoin': 'round' });
    const badge = make('g'), badgeDisc = make('circle'), badgeText = make('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-weight': '700' });
    badge.appendChild(badgeDisc); badge.appendChild(badgeText); mark.appendChild(label); mark.appendChild(badge); marks.appendChild(mark);
    e = { group, line, hit, head, mark, label, badge, badgeDisc, badgeText, tip, seen: true, drawn: '' }; entries.set(key, e); return e;
  };
  const n = (value: number) => String(Math.round(value * 10) / 10);
  const clear = (node: SvgNode) => { (node as unknown as { replaceChildren?(): void }).replaceChildren?.(); };
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
      const kind = token.kind === 'message' ? 'Message' : token.kind === 'signal' ? 'Signal' : 'Value';
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
        e.hit.setAttribute('d', draw.d); e.hit.setAttribute('stroke-width', n(draw.hit ?? scene.hitWidth)); e.hit.setAttribute('style', draw.interactive ? 'pointer-events:stroke;cursor:pointer' : 'pointer-events:none'); e.tip.textContent = draw.title;
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
      // Few and small: redrawn whole when anything about them changed.
      const bundled = JSON.stringify([scene.ties ?? [], scene.bands ?? []]);
      if (bundled !== tiesDrawn) {
        tiesDrawn = bundled; clear(bands); clear(ties);
        for (const band of scene.bands ?? []) bands.appendChild(make('path', { d: band.d, fill: 'none', stroke: band.color, 'stroke-width': n(band.width), 'stroke-linejoin': 'round', opacity: n(band.opacity), 'data-bundle': band.key }));
        for (const tie of scene.ties ?? []) {
          const scale = tie.scale ?? 1, g = make('g', { transform: `translate(${n(tie.x)} ${n(tie.y)}) rotate(${n(tie.angle)})${scale < 1 ? ` scale(${Math.round(scale * 1000) / 1000})` : ''}`, opacity: n(tie.opacity), 'data-bundle-tie': tie.key });
          const w = tie.length, h = tie.thickness;
          // A strap over the wires: the canvas colour as a thin halo keeps it apart from the lanes it holds.
          g.appendChild(make('rect', { x: n(-w / 2), y: n(-h / 2), width: n(w), height: n(h), rx: n(h / 2), fill: tie.fill, stroke: tie.halo, 'stroke-width': n(tie.haloWidth), 'paint-order': 'stroke' }));
          ties.appendChild(g);
        }
      }
      renderMotion();
    },
    destroy() { tiesDrawn = ''; destroyed = true; stop(); observer?.disconnect(); page?.removeEventListener('visibilitychange', visibility); clearMotion(); svg.remove(); above?.remove(); entries.clear(); paths.clear(); },
  };
}

/** Small browser drawing contracts. Extend these here rather than enabling DOM types in the client. */
/** A gradient made by the context; only good as a `fillStyle` or `strokeStyle` of that same context. */
export interface CanvasPaint { addColorStop(offset: number, color: string): void }
export interface Canvas2DContext {
  fillStyle: string | CanvasPaint; strokeStyle: string | CanvasPaint; lineWidth: number; globalAlpha: number; font: string;
  lineDashOffset: number; shadowColor: string; shadowBlur: number; shadowOffsetX: number; shadowOffsetY: number;
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasPaint;
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): CanvasPaint;
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
  setLineDash(values: number[]): void; fillText(text: string, x: number, y: number): void; strokeText(text: string, x: number, y: number): void;
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
      const shader = gl.createShader(type); if (!shader) throw new Error('The shader could not be created.'); shaders.push(shader);
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'The shader did not compile.');
    }
    program = gl.createProgram(); if (!program) throw new Error('The program could not be created.');
    shaders.forEach(shader => gl.attachShader(program!, shader)); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'The program did not link.');
    return { program };
  } catch (error) { if (program) gl.deleteProgram(program); return { error: error instanceof Error ? error.message : String(error) }; }
  finally { shaders.forEach(shader => gl.deleteShader(shader)); }
}
export type SurfaceFrame = { width: number; height: number; pixelRatio: number; time: number };
export type SurfacePointer = { kind: 'down' | 'move' | 'up' | 'cancel'; x: number; y: number; pointerId: number; buttons: number; pressure: number };
export type SurfaceWheel = { x: number; y: number; dx: number; dy: number; command: boolean };
type SurfaceBase = { id: string; label: string; height: number | '100%'; animated?: boolean;
  /** A picture only (a shader without pointer input): the card can be dragged by it and the wheel pans the canvas. */
  passive?: boolean; maxPixelSize?: number; onVisibilityChange?(visible: boolean): void; onPointer?(event: SurfacePointer): void; onWheel?(event: SurfaceWheel): void; onError?(message: string): void };
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
function DrawingSurface({ kind, ...props }: (CanvasSurfaceProps | GLSurfaceProps) & { kind: '2d' | 'webgl' }) {
  const ref = useRef<DrawingCanvas | null>(null), latest = useRef(props), invalidate = useRef<() => void>(() => {});
  latest.current = props; const [error, setError] = useState('');
  useEffect(() => {
    if (Platform.OS !== 'web' || !ref.current || !browser().document) return;
    const canvas = ref.current, doc = browser().document!, host = globalThis as unknown as DrawingHost;
    const report = (message: string) => { setError(message); latest.current.onError?.(message); };
    let visible = !host.IntersectionObserver, stopped = false, notified: boolean | undefined;
    if (kind === 'webgl') {
      // A WebGL drawing borrows the page's one shared context (shared-gl.ts) and keeps only a 2D canvas of its own.
      const view = canvas.getContext('2d') as Canvas2DContext | null;
      let context: GLContext | null = null, dispose: (() => void) | undefined, halted = false;
      const ready = () => !stopped && visible && !doc.hidden;
      const notify = () => { const value = ready() && !!context; if (value !== notified) { notified = value; latest.current.onVisibilityChange?.(value); } };
      const client: GLClient = { fresh: true, last: -Infinity, ready: () => ready() && !!context && !halted, animated: () => !!latest.current.animated,
        pixels() {
          const width = canvas.clientWidth, height = canvas.clientHeight; if (!width || !height) return null;
          return surfacePixels(width, height, host.devicePixelRatio ?? 1, canvas.getBoundingClientRect().width, latest.current.maxPixelSize, GL_LIMITS.floor, GL_LIMITS.edge);
        },
        start(gl) {
          context = null;
          if (!gl || !view) { report('The browser does not offer this drawing context.'); notify(); return; }
          try {
            const result = (latest.current as GLSurfaceProps).initialize?.(gl);
            dispose = result?.dispose;
            if (result?.error) { report('The drawing could not be prepared. Check the shader or its settings.'); latest.current.onError?.(result.error); }
            else { context = gl; setError(''); }
          } catch { report('The drawing could not start. Check its settings and open the block again.'); }
          notify();
        },
        lost() {
          const cleanup = dispose; dispose = undefined; context = null; notify();
          try { cleanup?.(); } finally { report('The WebGL context was lost. Waiting for it to come back.'); }
        },
        draw(gl, size, time, source) {
          if (canvas.width !== size.width || canvas.height !== size.height) { canvas.width = size.width; canvas.height = size.height; }
          try {
            (latest.current as GLSurfaceProps).draw(gl, { width: canvas.clientWidth, height: canvas.clientHeight, pixelRatio: size.pixelRatio, time });
            view!.clearRect(0, 0, size.width, size.height); view!.drawImage(source, 0, source.height - size.height, size.width, size.height, 0, 0, size.width, size.height);
          } catch { halted = true; report('The drawing could not be drawn. Check the parameters and try again.'); }
        },
      };
      const shared = joinSharedGL(client);
      const wake = () => { halted = false; shared.wake(); };
      const visibility = () => { notify(); if (!doc.hidden) wake(); else shared.update(); };
      invalidate.current = wake;
      // Coming into view draws a frame at once, playing or not; leaving it keeps the last frame on the card.
      const intersection = host.IntersectionObserver ? new host.IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting); notify(); if (visible) wake(); else shared.update(); }) : null;
      const resize = host.ResizeObserver ? new host.ResizeObserver(wake) : null;
      intersection?.observe(canvas); resize?.observe(canvas); doc.addEventListener('visibilitychange', visibility);
      notify();
      return () => {
        stopped = true; notify(); invalidate.current = () => {}; intersection?.disconnect(); resize?.disconnect(); doc.removeEventListener('visibilitychange', visibility);
        try { dispose?.(); } finally { shared.leave(); }
      };
    }
    let context: Canvas2DContext | null = null, frameId = 0;
    try { context = canvas.getContext('2d') as Canvas2DContext | null; if (!context) report('The browser does not offer this drawing context.'); }
    catch { report('The drawing could not start. Check its settings and open the block again.'); }
    const active = () => !stopped && visible && !doc.hidden && !!context;
    const notifyVisibility = () => { const value = active(); if (value !== notified) { notified = value; latest.current.onVisibilityChange?.(value); } };
    const schedule = () => { if (active() && !frameId) frameId = host.requestAnimationFrame(draw); };
    const draw = (time: number) => {
      frameId = 0; notifyVisibility(); if (!active()) return;
      const width = canvas.clientWidth, height = canvas.clientHeight; if (!width || !height) return;
      // CSS camera transforms do not change clientWidth. Sample their physical scale at redraw time.
      const { width: w, height: h, pixelRatio } = surfacePixels(width, height, host.devicePixelRatio ?? 1, canvas.getBoundingClientRect().width, latest.current.maxPixelSize);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      try {
        const ctx = context!; ctx.save();
        try { ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0); (latest.current as CanvasSurfaceProps).draw(ctx, { width, height, pixelRatio, time }); } finally { ctx.restore(); }
      } catch { report('The drawing could not be drawn. Check the parameters and try again.'); return; }
      if (latest.current.animated) schedule();
    };
    const stop = () => { if (frameId) host.cancelAnimationFrame(frameId); frameId = 0; };
    const visibility = () => { notifyVisibility(); if (doc.hidden) stop(); else schedule(); };
    invalidate.current = schedule;
    const intersection = host.IntersectionObserver ? new host.IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting); notifyVisibility(); if (visible) schedule(); else stop(); }) : null;
    const resize = host.ResizeObserver ? new host.ResizeObserver(schedule) : null;
    intersection?.observe(canvas); resize?.observe(canvas); doc.addEventListener('visibilitychange', visibility);
    notifyVisibility(); schedule();
    return () => { stopped = true; notifyVisibility(); invalidate.current = () => {}; stop(); intersection?.disconnect(); resize?.disconnect(); doc.removeEventListener('visibilitychange', visibility); };
  }, [kind, props.id, kind === 'webgl' ? (props as GLSurfaceProps).initialize : undefined]);
  useEffect(() => { invalidate.current(); });
  // A surface that reads the wheel (a world with a camera) takes it whole: the page must not scroll or zoom under it.
  const wheels = !!props.onWheel;
  useEffect(() => {
    const canvas = ref.current as unknown as (BrowserElement & { clientWidth: number; clientHeight: number; addEventListener(type: string, listener: (e: BrowserKeyEvent) => void, options?: { passive: boolean }): void }) | null; if (Platform.OS !== 'web' || !canvas || !wheels) return;
    const listener = (e: BrowserKeyEvent) => { const rect = canvas.getBoundingClientRect(); e.preventDefault(); e.stopPropagation();
      latest.current.onWheel?.({ x: (e.clientX - rect.left) * canvas.clientWidth / Math.max(1, rect.width ?? 1), y: (e.clientY - rect.top) * canvas.clientHeight / Math.max(1, rect.height ?? 1), dx: e.deltaX, dy: e.deltaY, command: e.ctrlKey || e.metaKey }); };
    canvas.addEventListener('wheel', listener, { passive: false }); return () => canvas.removeEventListener('wheel', listener);
  }, [wheels, props.id]);
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
  if (props.passive) return React.createElement('div', { id: `lienzo-surface-${props.id}`, style: { position: 'relative', width: '100%', height: props.height } },
    React.createElement('canvas', { ref, 'aria-label': props.label, role: 'img', style: { width: '100%', height: '100%', display: 'block' } }),
    error ? React.createElement('div', { role: 'status', style: { position: 'absolute', inset: 0, padding: 8, color: 'inherit', background: 'inherit' } }, error) : null);
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

/** `area`: the inside takes the pointer even when unpainted (a selected hollow shape). `opacity`: the eraser's fade. */
export type VectorPath = { d: string; color: string; weight: number; fill?: string; dash?: string; hit?: boolean; area?: boolean; opacity?: number };
/** Shape geometry uses browser SVG only here; native components render their own geometric fallback. */
export function WebVectors({ width, height, paths, label, scale = 1, onPress, onHover }: { width: number; height: number; paths: readonly VectorPath[]; label: string; scale?: number; onPress?: (point?: CanvasPointer) => void; onHover?: (inside: boolean) => void }) {
  if (Platform.OS !== 'web') return null;
  return React.createElement('svg', { width:'100%',height:'100%',viewBox:`0 0 ${width} ${height}`,role:'img','aria-label':label,style:{overflow:'visible',pointerEvents:'none'} }, ...paths.flatMap((path,i) => [
    React.createElement('path',{key:`paint-${i}`,d:path.d,fill:path.fill??'none',stroke:path.color,strokeWidth:path.weight,strokeDasharray:path.dash,strokeLinecap:'round',strokeLinejoin:'round',vectorEffect:'non-scaling-stroke',opacity:path.opacity,style:{pointerEvents:'none'}}),
    ...(path.hit===false?[]:[React.createElement('path',{key:`hit-${i}`,d:path.d,fill:path.area||path.fill&&path.fill!=='none'?'transparent':'none',stroke:'transparent',strokeWidth:16/Math.max(.01,scale),style:{pointerEvents:path.area||path.fill&&path.fill!=='none'?'all':'stroke',cursor:'inherit'},onClick:(e:{stopPropagation():void;clientX:number;clientY:number;shiftKey:boolean;ctrlKey:boolean;metaKey:boolean})=>{e.stopPropagation();onPress?.({x:e.clientX,y:e.clientY,shift:e.shiftKey,command:e.ctrlKey||e.metaKey,pointerId:0});},onPointerEnter:()=>onHover?.(true),onPointerLeave:()=>onHover?.(false)})]),
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
  const keys=listenKeys(node,down,true);doc.addEventListener('keyup',up,true);doc.addEventListener('visibilitychange',cancel);return()=>{cancel();keys();doc.removeEventListener('keyup',up,true);doc.removeEventListener('visibilitychange',cancel);};
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
export function attachZoomMenu(element: unknown, trigger: unknown, dismiss: () => void, preserveInputs = false): () => void {
  const node = element as BrowserElement | null, button = trigger as BrowserElement | null, doc = browser().document;
  if (!doc || !node?.addEventListener) return () => {};
  let prefix = '', typedAt = 0;
  const items = () => Array.from(node.querySelectorAll?.('[role="menuitem"]') ?? []).filter(item => item.getAttribute?.('aria-disabled') !== 'true');
  items()[0]?.focus?.();
  const outside = (event: BrowserKeyEvent) => { if (!node.contains?.(event.target) && !button?.contains?.(event.target)) dismiss(); };
  const key = (event: BrowserKeyEvent) => {
    if (event.key === 'Escape') { dismiss(); button?.focus?.(); event.preventDefault(); event.stopPropagation(); return; }
    if (!node.contains?.(event.target) || event.ctrlKey || event.metaKey) return;
    if (preserveInputs && pointerElement(event.target)?.closest('input,textarea,select,[contenteditable="true"]')) return;
    const rows = items(), current = rows.indexOf(pointerElement(event.target)!); let next: BrowserElement | undefined;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') next = rows[(current + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length];
    else if (event.key === 'Home' || event.key === 'End') next = rows[event.key === 'Home' ? 0 : rows.length - 1];
    else if (event.key.length === 1) { const now = Date.now(); prefix = now - typedAt > tokens.menu.typeaheadMs ? event.key : prefix + event.key; typedAt = now; next = rows.find(row => row.getAttribute?.('aria-label')?.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())); }
    if (next) { next.focus?.(); event.preventDefault(); event.stopPropagation(); }
  };
  doc.addEventListener('pointerdown', outside, true); doc.addEventListener('keydown', key, true);
  return () => { doc.removeEventListener('pointerdown', outside, true); doc.removeEventListener('keydown', key, true); };
}
/** A confirmation popover: the menu's dismissal (outside press, Escape) and focus on its safe choice. Native ignores it. */
export function attachConfirm(element: unknown, trigger: unknown, dismiss: () => void, focus = '[aria-label="Cancel"]'): () => void {
  const node = element as BrowserElement | null, stop = attachZoomMenu(element, trigger, dismiss);
  const timer = browser().document && node?.querySelector ? setTimeout(() => { try { node.querySelector(focus)?.focus(); } catch {} }, 30) : undefined;
  return () => { clearTimeout(timer); stop(); };
}
/** Arrow, Home and End inside a grid. The handler returns true when it used the key. Nothing happens on native. */
export function attachGridKeys(element: unknown, handler: (key: string) => boolean): () => void {
  const node = element as BrowserElement | null;
  if (!browser().document || !node?.addEventListener) return () => {};
  const listener = (event: BrowserKeyEvent) => { if (!event.ctrlKey && !event.metaKey && handler(event.key)) { event.preventDefault(); event.stopPropagation(); } };
  node.addEventListener('keydown', listener); return () => node.removeEventListener('keydown', listener);
}
/** Drag and drop onto an add sheet: a dropped link (from another tab) or a dropped file. Native ignores it. */
export type DroppedFile = { name: string; type: string; size: number; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> };
export function attachDrop(element: unknown, handlers: { over(active: boolean): void; text?(text: string): void; file?(file: DroppedFile, all: DroppedFile[]): void }): () => void {
  const node = element as BrowserElement | null; if (!browser().document || !node?.addEventListener) return () => {};
  type DragEvent = BrowserKeyEvent & { dataTransfer?: { types?: ArrayLike<string>; files?: ArrayLike<DroppedFile>; getData(type: string): string; dropEffect?: string } | null };
  let depth = 0;
  const accepts = (e: DragEvent) => { const types = Array.from(e.dataTransfer?.types ?? []); return types.includes('Files') ? !!handlers.file : types.some(t => t === 'text/uri-list' || t === 'text/plain') && !!handlers.text; };
  const enter = (e: DragEvent) => { if (!accepts(e)) return; e.preventDefault(); depth++; handlers.over(true); };
  const over = (e: DragEvent) => { if (!accepts(e)) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; };
  const leave = () => { depth = Math.max(0, depth - 1); if (!depth) handlers.over(false); };
  const drop = (e: DragEvent) => {
    if (!accepts(e)) return; e.preventDefault(); e.stopPropagation(); depth = 0; handlers.over(false);
    const file = e.dataTransfer?.files?.[0];
    if (file && handlers.file) { handlers.file(file, Array.from(e.dataTransfer?.files ?? [])); return; }
    const uri = e.dataTransfer?.getData('text/uri-list')?.split(/\r?\n/).find(line => line && !line.startsWith('#')), text = uri || e.dataTransfer?.getData('text/plain') || '';
    if (text && handlers.text) handlers.text(text);
  };
  const events: [string, (e: DragEvent) => void][] = [['dragenter', enter], ['dragover', over], ['dragleave', leave], ['drop', drop]];
  for (const [name, fn] of events) node.addEventListener(name, fn as (event: BrowserKeyEvent) => void);
  return () => { for (const [name, fn] of events) node.removeEventListener(name, fn as (event: BrowserKeyEvent) => void); };
}
// ---- Image files from the computer: dropped on the canvas, pasted, or chosen. They become Media blocks (media-store.ts).
type FileLike = { name: string; type: string; size: number; arrayBuffer(): Promise<ArrayBuffer> };
type FileTransfer = { types?: ArrayLike<string>; files?: ArrayLike<FileLike>; items?: ArrayLike<{ kind: string; type: string; getAsFile(): FileLike | null }>; dropEffect?: string } | null | undefined;
const hasFiles = (data: FileTransfer) => Array.from(data?.types ?? []).includes('Files');
function transferFiles(data: FileTransfer): FileLike[] {
  const files = Array.from(data?.files ?? []);
  if (files.length) return files;
  return Array.from(data?.items ?? []).filter(item => item.kind === 'file').map(item => item.getAsFile()).filter((file): file is FileLike => !!file);
}
/**
 * Files dragged from the computer onto `element`: `over` while they hover (to show the drop cue), then `drop` with
 * them and the page point they were let go at. Links and text dragged in are left alone; native ignores it.
 */
export function attachFileDrop(element: unknown, handlers: { enabled(): boolean; over(active: boolean): void; drop(files: FileLike[], page: { x: number; y: number }): void }): () => void {
  const node = element as BrowserElement | null; if (!browser().document || !node?.addEventListener) return () => {};
  type DragEvent = BrowserKeyEvent & { dataTransfer?: FileTransfer; clientX: number; clientY: number; defaultPrevented?: boolean };
  let depth = 0;
  const enter = (e: DragEvent) => { if (!hasFiles(e.dataTransfer) || !handlers.enabled()) return; e.preventDefault(); depth++; handlers.over(true); };
  const over = (e: DragEvent) => { if (!hasFiles(e.dataTransfer) || !handlers.enabled()) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; };
  const leave = (e: DragEvent) => { if (!hasFiles(e.dataTransfer)) return; depth = Math.max(0, depth - 1); if (!depth) handlers.over(false); };
  const drop = (e: DragEvent) => {
    if (!hasFiles(e.dataTransfer)) return; depth = 0; handlers.over(false);
    // A sheet with its own drop zone (Add image) took it first.
    if (e.defaultPrevented || !handlers.enabled()) { e.preventDefault(); return; }
    e.preventDefault(); const files = transferFiles(e.dataTransfer); if (files.length) handlers.drop(files, { x: e.clientX, y: e.clientY });
  };
  const events: [string, (e: DragEvent) => void][] = [['dragenter', enter], ['dragover', over], ['dragleave', leave], ['drop', drop]];
  for (const [name, fn] of events) node.addEventListener(name, fn as (event: BrowserKeyEvent) => void);
  return () => { for (const [name, fn] of events) node.removeEventListener(name, fn as (event: BrowserKeyEvent) => void); };
}
/** ⌘V with files on the clipboard (a screenshot, a copied image), outside text fields. True from `paste` takes it. */
export function attachFilePaste(paste: (files: FileLike[]) => boolean): () => void {
  const doc = browser().document; if (!doc) return () => {};
  type PasteEvent = BrowserKeyEvent & { clipboardData?: FileTransfer };
  const listener = (e: PasteEvent) => { if (isTextTarget(e.target)) return; const files = transferFiles(e.clipboardData); if (files.length && paste(files)) e.preventDefault(); };
  doc.addEventListener('paste', listener as (event: BrowserKeyEvent) => void);
  return () => doc.removeEventListener('paste', listener as (event: BrowserKeyEvent) => void);
}
/** "Choose file…": the system picker, several at once. Resolves an empty list when cancelled. */
export function pickFiles(accept: string, multiple = true): Promise<FileLike[]> {
  const host = browser(); if (!host.document) return Promise.resolve([]);
  return new Promise(resolve => {
    const input = host.document!.createElement('input') as BrowserElement & { multiple: boolean; files?: ArrayLike<FileLike> }; input.type = 'file'; input.accept = accept; input.multiple = multiple;
    input.addEventListener('cancel', () => { input.remove(); resolve([]); });
    input.addEventListener('change', () => { const files = Array.from(input.files ?? []); input.remove(); resolve(files); });
    input.click();
  });
}
/** Reads a dropped SVG file through the same limits as the file picker. */
export async function readSvgFile(file: DroppedFile): Promise<string> {
  if (!/\.svg$/i.test(file.name) && file.type !== 'image/svg+xml') throw new Error('That file is not an SVG.');
  if (file.size > SVG_LIMITS.bytes) throw new Error('The SVG is larger than 64 KB.');
  return sanitizeSvg(await file.text()).svg;
}
/** Focuses the first text field inside an element, after it has mounted. */
export function focusFirstField(element: unknown) {
  const node = element as BrowserElement | null; if (!browser().document || !node?.querySelector) return;
  setTimeout(() => { try { node.querySelector('input, textarea')?.focus(); } catch {} }, 30);
}
/** The system asks for less motion (web only; native reads AccessibilityInfo in motion.tsx). */
export function prefersReducedMotion(): boolean {
  const host = browser() as unknown as { matchMedia?: (query: string) => { matches: boolean } };
  try { return !!host.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}
/**
 * The extensions catalog (shared/marketplace.ts) on web and desktop: a bounded, credential-free download of public
 * text, SHA-256 from Web Crypto, and the last list kept in this browser's storage. Native has none of them.
 */
export async function fetchPublicText(url: string, limit: number): Promise<string> {
  if (!browser().document || !/^https:\/\//i.test(url)) throw new Error('Downloads run in the web and desktop apps.');
  type Response = { ok: boolean; headers: { get(name: string): string | null }; body?: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel(): Promise<void> } } | null };
  const host = globalThis as unknown as { fetch(url: string, options: { credentials: string; signal: unknown; cache: string }): Promise<Response>; AbortController: new () => { signal: unknown; abort(): void }; TextDecoder: new () => { decode(value: Uint8Array): string } };
  const abort = new host.AbortController(), timeout = setTimeout(() => abort.abort(), 10000), tooLarge = () => new Error(`The file is larger than ${Math.round(limit / 1048576)} MB.`);
  try {
    const response = await host.fetch(url, { credentials: 'omit', signal: abort.signal, cache: 'no-cache' });
    if (!response.ok) throw new Error('The download failed.');
    if (Number(response.headers.get('content-length')) > limit) throw tooLarge();
    const reader = response.body?.getReader(); if (!reader) throw new Error('The download could not be read.');
    const chunks: Uint8Array[] = []; let bytes = 0;
    for (;;) { const part = await reader.read(); if (part.done) break; if (!part.value) continue; bytes += part.value.byteLength; if (bytes > limit) { await reader.cancel(); throw tooLarge(); } chunks.push(part.value); }
    const content = new Uint8Array(bytes); let offset = 0; for (const chunk of chunks) { content.set(chunk, offset); offset += chunk.byteLength; }
    return new host.TextDecoder().decode(content);
  } finally { clearTimeout(timeout); }
}
export async function sha256Hex(text: string): Promise<string | null> {
  const subtle = (globalThis as unknown as { crypto?: { subtle?: { digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer> } } }).crypto?.subtle;
  if (!browser().document || !subtle) return null;
  try { const digest = new Uint8Array(await subtle.digest('SHA-256', new TextEncoder().encode(text))); return Array.from(digest, b => b.toString(16).padStart(2, '0')).join(''); } catch { return null; }
}
export function browserCache(key: string): { read(): string | null; write(text: string): void } {
  const storage = () => (browser() as unknown as { localStorage?: { getItem(k: string): string | null; setItem(k: string, v: string): void } }).localStorage;
  return { read: () => { try { return storage()?.getItem(key) ?? null; } catch { return null; } }, write: text => { try { storage()?.setItem(key, text); } catch { /* storage full or blocked */ } } };
}

// ---- Copy, cut and paste of canvas things (clipboard.ts). The browser's own clipboard events carry them, so ⌘C/⌘X/⌘V,
// the desktop app's Edit menu and a rebound key all take one path; text fields and selected text keep theirs.
type ClipboardEvent = BrowserKeyEvent & { clipboardData?: (FileTransfer & { getData?(type: string): string; setData?(type: string, text: string): void }) | null };
const selectedText = () => { try { return String((globalThis as unknown as { getSelection?: () => { toString(): string } | null }).getSelection?.() ?? ''); } catch { return ''; } };
export function attachClipboard(handlers: { copy(cut: boolean): string | null; paste(text: string, files: boolean): boolean }): () => void {
  const doc = browser().document; if (!doc) return () => {};
  const write = (cut: boolean) => (e: ClipboardEvent) => {
    if (isTextTarget(e.target) || selectedText() || !e.clipboardData?.setData) return;
    const text = handlers.copy(cut); if (text === null) return;
    e.clipboardData.setData('text/plain', text); e.preventDefault();
  };
  const read = (e: ClipboardEvent) => { if (isTextTarget(e.target)) return; if (handlers.paste(e.clipboardData?.getData?.('text/plain') ?? '', transferFiles(e.clipboardData).length > 0)) e.preventDefault(); };
  const copy = write(false), cut = write(true);
  doc.addEventListener('copy', copy as (event: BrowserKeyEvent) => void); doc.addEventListener('cut', cut as (event: BrowserKeyEvent) => void); doc.addEventListener('paste', read as (event: BrowserKeyEvent) => void);
  return () => { doc.removeEventListener('copy', copy as (event: BrowserKeyEvent) => void); doc.removeEventListener('cut', cut as (event: BrowserKeyEvent) => void); doc.removeEventListener('paste', read as (event: BrowserKeyEvent) => void); };
}
/** A rebound copy key: runs the browser's copy so the listener above writes; false where the page may not. */
export function runCopyCommand(): boolean {
  const doc = browser().document as unknown as { execCommand?(name: string): boolean } | undefined;
  try { return !!doc?.execCommand?.('copy'); } catch { return false; }
}
/** The system clipboard's text, where the page may read it (a rebound paste key); null otherwise. */
export async function readClipboardText(): Promise<string | null> {
  const clipboard = (globalThis as unknown as { navigator?: { clipboard?: { readText?(): Promise<string> } } }).navigator?.clipboard;
  try { return clipboard?.readText ? await clipboard.readText() : null; } catch { return null; }
}
/** Where the pointer last was on the page, for pasting under it; `onDown` hears every press first. */
export function trackPointer(onDown?: () => void): { last(): { x: number; y: number } | null; stop(): void } {
  const doc = browser().document; let at: { x: number; y: number } | null = null; if (!doc) return { last: () => null, stop() {} };
  const move = (e: BrowserKeyEvent) => { at = { x: e.clientX, y: e.clientY }; }, down = (e: BrowserKeyEvent) => { move(e); onDown?.(); };
  doc.addEventListener('pointermove', move, true); doc.addEventListener('pointerdown', down, true);
  return { last: () => at, stop: () => { doc.removeEventListener('pointermove', move, true); doc.removeEventListener('pointerdown', down, true); } };
}
/**
 * Alt-drag on the empty canvas (or over links): a straight cut that gathers the links it crosses into a bundle. By
 * pointer events, since react-native-web drops a press or move with Alt held. Cards, Frames, controls and the
 * bundle's own clips keep their Alt-drag (a copy) and their presses.
 */
export function attachCutGesture(element: unknown, handlers: { begin(point: CanvasPointer): boolean; move(point: CanvasPointer): void; end(point: CanvasPointer, cancelled: boolean): void }): () => void {
  const node = element as BrowserElement | null, doc = browser().document; if (!doc || !node?.addEventListener) return () => {};
  type Event = BrowserKeyEvent & { button?: number; pointerId?: number };
  let current: CanvasPointer | null = null;
  const point = (e: Event): CanvasPointer => ({ x: e.clientX, y: e.clientY, shift: e.shiftKey, command: e.ctrlKey || e.metaKey, alt: !!e.altKey, pointerId: e.pointerId ?? 0 });
  const down = (e: Event) => {
    if (e.button !== 0 || !e.altKey || pointerElement(e.target)?.closest?.('[id^="lienzo-entity-"],[id^="lienzo-bundle-"],[id^="lienzo-tools"],[id^="lienzo-interactive-"],[role="toolbar"],[role="dialog"]')) return;
    const p = point(e); if (!handlers.begin(p)) return;
    current = p; try { node.setPointerCapture?.(p.pointerId); } catch {} e.preventDefault(); e.stopPropagation();
  };
  const move = (e: Event) => { if (!current || current.pointerId !== (e.pointerId ?? 0)) return; current = point(e); handlers.move(current); e.preventDefault(); e.stopPropagation(); };
  const finish = (cancelled: boolean) => { const p = current; current = null; if (!p) return; try { node.releasePointerCapture?.(p.pointerId); } catch {} handlers.end(p, cancelled); if (!cancelled) swallowClick(); };
  const up = (e: Event) => { if (!current || current.pointerId !== (e.pointerId ?? 0)) return; current = point(e); finish(false); e.preventDefault(); e.stopPropagation(); };
  const cancel = () => finish(true), key = (e: BrowserKeyEvent) => { if (e.key === 'Escape' && current) { cancel(); e.preventDefault(); e.stopPropagation(); } };
  node.addEventListener('pointerdown', down, true); doc.addEventListener('pointermove', move, true); doc.addEventListener('pointerup', up, true); doc.addEventListener('pointercancel', cancel, true); doc.addEventListener('keydown', key, true);
  return () => { cancel(); node.removeEventListener('pointerdown', down, true); doc.removeEventListener('pointermove', move, true); doc.removeEventListener('pointerup', up, true); doc.removeEventListener('pointercancel', cancel, true); doc.removeEventListener('keydown', key, true); };
}
