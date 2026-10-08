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
