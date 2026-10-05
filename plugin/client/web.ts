// The only browser/DOM adapter. Loading this module never touches the DOM on native.
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { safeUrl } from './logic';
import { tokens } from './tokens';
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
  document?: BrowserEventTarget & { body: BrowserElement; createElement(tag: string): BrowserElement };
  Blob: new (parts: string[], options: { type: string }) => unknown;
  URL: { createObjectURL(blob: unknown): string; revokeObjectURL(url: string): void };
}
const browser = () => globalThis as unknown as BrowserHost;
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
export function WebFrame({ url, title, border, height, surface, onLoaded, onTimeout }: { url: string; title: string; border: string; height: number; surface: string; onLoaded?: () => void; onTimeout?: () => void }) {
  const safe = safeUrl(url), [loaded, setLoaded] = useState(false);
  useEffect(() => { setLoaded(false); const timer = setTimeout(() => onTimeout?.(), 8000); return () => clearTimeout(timer); }, [safe]);
  if (!safe) return null;
  return React.createElement('div', { style: { position: 'relative', height, width: '100%', border: `1px solid ${border}`, borderRadius: 6, overflow: 'hidden', backgroundColor: surface } },
    React.createElement('iframe', { key: safe, src: safe, title, sandbox: tokens.preview.sandbox, referrerPolicy: 'no-referrer', loading: 'lazy', onLoad: () => { setLoaded(true); onLoaded?.(); }, style: { width: '100%', height: '100%', border: 0, opacity: loaded ? 1 : 0 }, 'aria-label': loaded ? title : `Cargando ${title}` }));
}
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
  const listener = (e: BrowserKeyEvent) => { const origin = node.getBoundingClientRect(); handler({ x: e.clientX - origin.left, y: e.clientY - origin.top, dx: e.deltaX, dy: e.deltaY, command: e.ctrlKey || e.metaKey }); e.preventDefault(); };
  node.addEventListener('wheel', listener); return () => node.removeEventListener('wheel', listener);
}
export function keyboard(element: unknown, handler: (event: { key: string; shift: boolean; command: boolean }) => boolean): () => void {
  const node = element as BrowserElement | null;
  if (!browser().document || !node?.addEventListener) return () => {};
  const listener = (event: BrowserKeyEvent) => {
    const target = event.target;
    if (target?.closest('input,textarea,[contenteditable="true"],iframe')) return;
    if (handler({ key: event.key, shift: event.shiftKey, command: event.ctrlKey || event.metaKey })) { event.preventDefault(); event.stopPropagation(); }
  };
  node.addEventListener('keydown', listener); return () => node.removeEventListener('keydown', listener);
}
export function focusInput(element: unknown) {
  const node = element as BrowserElement | null;
  if (browser().document) node?.querySelector?.('input,textarea')?.focus();
}
