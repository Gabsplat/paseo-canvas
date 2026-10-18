import { safeUrl } from './logic';
import { tokens } from './tokens';

export type MediaSource = { kind: 'image' | 'video' | 'audio' | 'reference'; url: string; embed?: string; provider?: 'YouTube' | 'Vimeo' };
const videoId = /^[\w-]{11}$/;
const seconds = (value: string | null): number => {
  if (!value) return 0;
  if (/^\d+$/.test(value)) return Math.min(604800, Number(value));
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  return match ? Math.min(604800, Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0)) : 0;
};
/** Provider URLs are rebuilt from their IDs. Query strings cannot enable autoplay or load another origin. */
export function mediaSource(raw: unknown, requested: unknown = 'reference'): MediaSource | null {
  const url = safeUrl(raw); if (!url) return null;
  const parsed = new URL(url), host = parsed.hostname.toLowerCase(), path = parsed.pathname.split('/').filter(Boolean);
  const youtube = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(host);
  const short = host === 'youtu.be' || host === 'www.youtu.be';
  if (youtube || short) {
    const id = short ? path[0] : path[0] === 'watch' ? parsed.searchParams.get('v') : ['embed', 'shorts', 'live'].includes(path[0]) ? path[1] : null;
    if (!id || !videoId.test(id)) return { kind: 'reference', url };
    const embed = new URL(`https://www.youtube-nocookie.com/embed/${id}`);
    embed.searchParams.set('playsinline', '1');
    const start = seconds(parsed.searchParams.get('start') ?? parsed.searchParams.get('t')); if (start) embed.searchParams.set('start', String(start));
    return { kind: 'video', url, provider: 'YouTube', embed: embed.href };
  }
  if (['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'].includes(host)) {
    const atVideo = Math.max(path.lastIndexOf('video'), path.lastIndexOf('videos'));
    const id = /^\d+$/.test(path[0] ?? '') ? path[0] : atVideo >= 0 ? path[atVideo + 1] : path[0] === 'channels' ? path[2] : undefined;
    if (!id || !/^\d+$/.test(id)) return { kind: 'reference', url };
    const embed = new URL(`https://player.vimeo.com/video/${id}`), at = path.indexOf(id);
    const hash = parsed.searchParams.get('h') ?? path[at + 1];
    if (hash && /^[a-zA-Z0-9]{6,64}$/.test(hash)) embed.searchParams.set('h', hash);
    embed.searchParams.set('dnt', '1');
    return { kind: 'video', url, provider: 'Vimeo', embed: embed.href };
  }
  const extension = parsed.pathname.toLowerCase().split('.').pop();
  const inferred = ['mp4', 'webm', 'ogv', 'mov', 'm4v'].includes(extension ?? '') ? 'video'
    : ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'].includes(extension ?? '') ? 'audio'
    : ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg'].includes(extension ?? '') ? 'image' : null;
  const kind = inferred ?? (['image', 'video', 'audio'].includes(String(requested)) ? requested as 'image' | 'video' | 'audio' : 'reference');
  return { kind, url };
}

/** Cross-origin apps need their own origin for storage and player APIs. A page on Paseo's origin stays opaque. */
export function frameSandbox(url: string, ownOrigin?: string): string {
  const safe = safeUrl(url); if (!safe) return tokens.preview.sandbox;
  const sameOrigin = ownOrigin && new URL(safe).origin === ownOrigin;
  return sameOrigin || !ownOrigin ? tokens.preview.sandbox : `${tokens.preview.sandbox} allow-same-origin allow-popups allow-popups-to-escape-sandbox`;
}

// ---- What a pasted link will become (docs/design.md §37.1). Pure: the add sheets show it live as the person types.
export type LinkIntent = 'page' | 'image' | 'video' | 'audio';
export type LinkKind = 'page' | 'image' | 'video' | 'audio' | 'reference';
export type LinkDescription =
  | { status: 'empty' }
  | { status: 'invalid'; message: string }
  | { status: 'ok'; url: string; kind: LinkKind; host: string; name: string; provider?: 'YouTube' | 'Vimeo'; thumbnail?: string; oembed?: string; note?: string; warning?: string };
/** Sites that refuse to be shown inside another page (X-Frame-Options or frame-ancestors), as far as we know. */
export const FRAME_REFUSING_HOSTS = ['github.com', 'gitlab.com', 'google.com', 'mail.google.com', 'docs.google.com', 'drive.google.com', 'twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'linkedin.com', 'reddit.com', 'amazon.com', 'stackoverflow.com', 'apple.com', 'microsoft.com', 'notion.so', 'medium.com', 'chatgpt.com', 'claude.ai'] as const;
const refuses = (host: string) => FRAME_REFUSING_HOSTS.some(h => host === h || host.endsWith('.' + h));
const KIND_WORD: Record<LinkKind, string> = { page: 'a web page', image: 'an image', video: 'a video', audio: 'a sound', reference: 'a link' };
/** Typed without a scheme ("example.com/a"), a link is read as https. Anything else that is not http(s) is refused. */
export function normaliseLink(raw: string): string | null {
  const text = raw.trim(); if (!text) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : /^[\w-]+(\.[\w-]+)+(:\d+)?(\/|$|\?|#)/.test(text) ? 'https://' + text : text;
  return safeUrl(candidate);
}
export function describeLink(raw: string, intent: LinkIntent): LinkDescription {
  if (!raw.trim()) return { status: 'empty' };
  const url = normaliseLink(raw);
  if (!url) return { status: 'invalid', message: /^\s*(data|file|javascript|blob):/i.test(raw) ? 'Only web links (https://…) can be added. Files on this computer are not supported here yet.' : 'That is not a web link. Paste one that starts with https://.' };
  const parsed = new URL(url), host = parsed.hostname.replace(/^www\./, ''), file = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() ?? '');
  const source = mediaSource(url, intent === 'page' ? 'reference' : intent)!;
  const name = file && /\.[a-z0-9]{2,5}$/i.test(file) ? file : host;
  if (source.provider) {
    const id = source.provider === 'YouTube' ? /\/embed\/([\w-]{11})/.exec(source.embed!)?.[1] : undefined;
    const oembed = source.provider === 'YouTube' ? `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}` : `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`;
    return { status: 'ok', url, kind: 'video', host, name: source.provider + ' video', provider: source.provider, thumbnail: id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : undefined, oembed,
      note: intent === 'video' ? 'Loads only when you press play, without cookies.' : `This is a ${source.provider} video, so it becomes a video player. It loads only when you press play.` };
  }
  if (source.kind === 'reference' && /(^|\.)(youtube\.com|youtu\.be|vimeo\.com)$/.test(host))
    return { status: 'ok', url, kind: 'reference', host, name: host, warning: `This ${host.includes('vimeo') ? 'Vimeo' : 'YouTube'} link is not a single video, so it cannot play here. It will be added as a link you can open.` };
  const extension = /\.([a-z0-9]+)$/i.exec(parsed.pathname)?.[1]?.toLowerCase();
  const typed = !!extension && ['mp4', 'webm', 'ogv', 'mov', 'm4v', 'mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg'].includes(extension);
  if (intent === 'page' && !typed) {
    return { status: 'ok', url, kind: 'page', host, name: host, note: 'Shown live inside the Lienzo, in its own sandbox.',
      warning: refuses(host) ? `${host} does not let other apps show its pages, so the Window will stay blank. You can still open it from the Window’s bar.` : parsed.protocol === 'http:' ? 'This page is not secure (http). It may be blocked inside the app; use https if the site has it.' : undefined };
  }
  const kind = source.kind as LinkKind;
  if (intent !== 'page' && typed && kind !== intent) return { status: 'ok', url, kind, host, name, note: `This is ${KIND_WORD[kind]} file, so it is added as ${KIND_WORD[kind]}.` };
  if (intent !== 'page' && !typed) return { status: 'ok', url, kind, host, name, warning: `This link does not end in ${intent === 'image' ? '.png, .jpg, .webp or .svg' : intent === 'video' ? '.mp4 or .webm' : '.mp3, .m4a or .ogg'}. If it is a page rather than the file itself, it will not play; it will show as a link you can open.` };
  return { status: 'ok', url, kind, host, name, note: kind === 'image' ? undefined : intent === 'page' ? `This is ${KIND_WORD[kind]} file, so it becomes a player. It never starts on its own.` : 'It never starts on its own.' };
}
/** The block a described link becomes: a Window for a page, Media for the rest. */
export function linkBlock(link: Extract<LinkDescription, { status: 'ok' }>, caption: string, fetchedTitle?: string | null): { renderer: 'preview-frame' | 'image-ref'; title: string; data: Record<string, string> } {
  const text = caption.trim().slice(0, 300);
  if (link.kind === 'page') return { renderer: 'preview-frame', title: text, data: { url: link.url, description: text || link.url } };
  return { renderer: 'image-ref', title: (fetchedTitle ?? '').slice(0, 300), data: { url: link.url, caption: text, mediaKind: link.kind } };
}
/** A video's title and thumbnail from its provider's oEmbed answer. Best effort: errors read as nothing found. */
export async function fetchLinkPreview(oembed: string, fetcher: ((url: string, init: { credentials: 'omit' }) => Promise<{ ok: boolean; json(): Promise<unknown> }>) | undefined = (globalThis as unknown as { fetch?: (url: string, init: { credentials: 'omit' }) => Promise<{ ok: boolean; json(): Promise<unknown> }> }).fetch): Promise<{ title: string | null; thumbnail: string | null }> {
  const none = { title: null, thumbnail: null };
  if (!fetcher) return none;
  try {
    const response = await fetcher(oembed, { credentials: 'omit' }); if (!response.ok) return none;
    const body = await response.json() as { title?: unknown; thumbnail_url?: unknown };
    const title = typeof body?.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 300) : null;
    const thumbnail = typeof body?.thumbnail_url === 'string' && /^https:\/\//.test(body.thumbnail_url) ? safeUrl(body.thumbnail_url) : null;
    return { title, thumbnail };
  } catch { return none; }
}
