import { useEffect, useState } from 'react';
import { MEDIA_LIMITS, MEDIA_TYPES, inlineImage, parseMediaRef, prepareImage, toBase64 } from '../shared/media';

/**
 * Images from the person's computer, on the client side. The panel hands this module the host's two media RPCs
 * (`provideMediaHost`); storing an image sends its bytes there, and showing one reads them back once per session into
 * a blob URL (a data URL where blobs are not available or not allowed). See shared/media.ts for the format.
 */
export type MediaHost = {
  put(input: { data: string; name?: string }): Promise<{ url: string; mime: string; bytes: number; existed: boolean }>;
  read(input: { url: string }): Promise<{ mime: string; data: string }>;
};
let host: MediaHost | null = null;
const waiting = new Set<() => void>();
export function provideMediaHost(next: MediaHost | null) { host = next; if (next) { waiting.forEach(wake => wake()); waiting.clear(); } }

/** Read as bytes: a File, a Blob or anything with arrayBuffer(). */
export type ImageFile = { name: string; type?: string; size: number; arrayBuffer(): Promise<ArrayBuffer> };
export const IMAGE_NAME = /\.(png|jpe?g|webp|gif|svg)$/i;
/** Files a drop or a paste may hold that look like images; the bytes decide in the end. */
export const imageFiles = <F extends { name: string; type?: string }>(files: readonly F[]): F[] => files.filter(f => /^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(f.type ?? '') || IMAGE_NAME.test(f.name));

export type StoredImage = { url: string; name: string; bytes: number; existed: boolean; inline: boolean };
/** Why a host could not keep a file at all (an older server, a host without the RPC): then a small one goes inline. */
const unsupported = (error: unknown) => /NOT_FOUND: Unknown method|does not implement|Unknown method|not available|UNAVAILABLE/i.test(error instanceof Error ? error.message : String(error));
export class MediaError extends Error { constructor(message: string) { super(message); this.name = 'LienzoPlainError'; } }

/**
 * Keeps one image: checked and cleaned here first (sniffed type, size, SVG sanitizer) so a refusal reads plainly, then
 * stored by the host. When the host cannot store files, an image up to MEDIA_LIMITS.inlineBytes goes into the block
 * itself as a data URL; a larger one is refused with that reason.
 */
export async function storeImage(file: ImageFile, using: MediaHost | null = host): Promise<StoredImage> {
  if (file.size > MEDIA_LIMITS.bytes) throw new MediaError(`“${file.name}” is over ${MEDIA_LIMITS.bytes / 1024 / 1024} MB. Make it smaller and try again.`);
  let image;
  try { image = prepareImage(new Uint8Array(await file.arrayBuffer())); }
  catch (error) { throw new MediaError(`“${file.name}”: ${(error as Error).message}`); }
  const data = toBase64(image.bytes), name = file.name.slice(0, 300) || 'image';
  if (using) {
    try { const stored = await using.put({ data, name }); return { url: stored.url, name, bytes: stored.bytes, existed: stored.existed, inline: false }; }
    catch (error) { if (!unsupported(error)) throw error; }
  }
  if (image.bytes.length > MEDIA_LIMITS.inlineBytes) throw new MediaError(`This host cannot store image files, and “${name}” is too large to keep inside the Lienzo (up to ${MEDIA_LIMITS.inlineBytes / 1024} KB).`);
  return { url: `data:${image.mime};base64,${data}`, name, bytes: image.bytes.length, existed: false, inline: true };
}

/** The title an image block gets from its file: the name without its extension. */
export const imageTitle = (name: string) => { const text = name.replace(IMAGE_NAME, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300); return text ? text[0].toLocaleUpperCase() + text.slice(1) : 'Image'; };

// ---- Showing one: a reference becomes a URL the <Image> can load, once per session.
type Shown = { uri: string; data: string };
const shown = new Map<string, Promise<Shown>>();
function makeUri(mime: string, data: string): string {
  const g = globalThis as unknown as { Blob?: new (parts: unknown[], options: { type: string }) => unknown; URL?: { createObjectURL?(blob: unknown): string }; atob?(text: string): string };
  if (!g.Blob || !g.URL?.createObjectURL || !g.atob) return `data:${mime};base64,${data}`;
  const text = g.atob(data), bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return g.URL.createObjectURL(new g.Blob([bytes], { type: mime }));
}
const waitForHost = () => host ? Promise.resolve(host) : new Promise<MediaHost>(resolve => waiting.add(() => resolve(host!)));
export function resolveMedia(url: string): Promise<Shown> {
  const ref = parseMediaRef(url);
  if (!ref) { const inline = inlineImage(url); return inline ? Promise.resolve({ uri: url, data: url }) : Promise.reject(new MediaError('Not an image Lienzo keeps.')); }
  let pending = shown.get(url);
  if (!pending) {
    pending = waitForHost().then(h => h.read({ url })).then(result => ({ uri: makeUri(MEDIA_TYPES[ref.extension], result.data), data: `data:${MEDIA_TYPES[ref.extension]};base64,${result.data}` }));
    shown.set(url, pending);
    pending.catch(() => shown.delete(url));
  }
  return pending;
}
export type MediaView = { uri: string | null; state: 'loading' | 'ready' | 'missing'; retry(): void };
/**
 * The address to draw a block's image from. http(s) links pass through; a stored image loads from the host. When the
 * blob URL does not draw (a host that forbids blob: images), `retry` switches to the data URL.
 */
export function useMediaUri(url: string | undefined | null, local: boolean): MediaView {
  const [view, setView] = useState<{ url: string | null | undefined; uri: string | null; data: string | null; state: MediaView['state']; fallback: boolean }>({ url, uri: local ? null : url ?? null, data: null, state: local ? 'loading' : 'ready', fallback: false });
  useEffect(() => {
    if (!local || !url) { setView({ url, uri: url ?? null, data: null, state: 'ready', fallback: false }); return; }
    let live = true; setView({ url, uri: null, data: null, state: 'loading', fallback: false });
    resolveMedia(url).then(result => { if (live) setView({ url, uri: result.uri, data: result.data, state: 'ready', fallback: false }); }, () => { if (live) setView({ url, uri: null, data: null, state: 'missing', fallback: false }); });
    return () => { live = false; };
  }, [url, local]);
  const current = view.url === url ? view : { uri: local ? null : url ?? null, data: null, state: local ? 'loading' as const : 'ready' as const, fallback: false };
  return { uri: current.uri, state: current.state, retry: () => setView(v => !v.fallback && v.data && v.data !== v.uri ? { ...v, uri: v.data, fallback: true } : { ...v, state: 'missing' }) };
}
