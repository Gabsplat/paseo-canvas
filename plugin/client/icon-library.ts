/**
 * The icon library (docs/design.md §37.2): a curated Lucide set that ships offline, and a search over Iconify's public
 * API (https://api.iconify.design) limited to open-licence sets, so every icon carries its set and licence when it is
 * inserted as an SVG drawing. Pure logic: no React and no DOM; the network goes through an injectable `fetch`.
 */
import { sanitizeSvg } from '../shared/svg';
import { LUCIDE_CATEGORIES, LUCIDE_ICONS } from './icon-set';

export type IconEntry = {
  /** `lucide:server` offline, `iconify:<prefix>:<name>` online. */
  id: string; name: string; label: string; category?: string; keywords: string;
  svg: string; set: string; source: string; license: string; online: boolean;
};
export const ICON_CATEGORIES = LUCIDE_CATEGORIES;
export const LUCIDE_LICENSE = 'ISC · Lucide';
const words = (text: string) => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter(Boolean);
export const iconLabel = (name: string) => { const text = name.replace(/[-_]+/g, ' ').replace(/\s+\d+$/, '').trim(); return text.charAt(0).toUpperCase() + text.slice(1); };
export const lucideSvg = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

let offline: IconEntry[] | undefined;
/** The offline set, built once on first use. */
export function offlineIcons(): readonly IconEntry[] {
  return offline ??= LUCIDE_ICONS.map(([name, category, extra, inner]) => ({ id: 'lucide:' + name, name, label: iconLabel(name), category, keywords: [name.replace(/-/g, ' '), extra, category].join(' '), svg: lucideSvg(inner), set: 'Lucide', source: 'lucide:' + name, license: LUCIDE_LICENSE, online: false }));
}
export const offlineIcon = (id: string) => offlineIcons().find(entry => entry.id === id);

/** Every query word must start a word of the icon's name, keywords or category. Name matches rank first. */
export function searchIcons(entries: readonly IconEntry[], query: string, category?: string): IconEntry[] {
  const wanted = words(query), pool = category ? entries.filter(entry => entry.category === category) : [...entries];
  if (!wanted.length) return pool;
  const scored: [IconEntry, number][] = [];
  for (const entry of pool) {
    const name = words(entry.name), all = words(entry.name + ' ' + entry.keywords);
    if (!wanted.every(word => all.some(w => w.startsWith(word)))) continue;
    const exact = name.join(' ') === wanted.join(' ') ? 0 : 1, inName = wanted.every(word => name.some(w => w.startsWith(word))) ? 0 : 1;
    scored.push([entry, exact * 4 + inName * 2 + name.length / 100]);
  }
  return scored.sort((a, b) => a[1] - b[1]).map(([entry]) => entry);
}

/** Paging for a long grid: the first `page` icons, then one more page each time. */
export const ICON_PAGE = 96;
export const visibleIcons = <T,>(list: readonly T[], pages: number) => list.slice(0, Math.max(1, pages) * ICON_PAGE);

// ---- Recent icons, kept in the host's interface settings (shared/preferences.ts). Offline ones by id only.
export type RecentIcon = { id: string; label: string; svg?: string; source?: string; license?: string };
export const RECENT_MAX = 16, RECENT_SVG_MAX = 4096;
export function rememberIcon(list: readonly RecentIcon[], entry: IconEntry): RecentIcon[] {
  const item: RecentIcon = entry.online ? { id: entry.id, label: entry.label, svg: entry.svg, source: entry.source, license: entry.license } : { id: entry.id, label: entry.label };
  if (item.svg && item.svg.length > RECENT_SVG_MAX) return list.filter(r => r.id !== entry.id).slice(0, RECENT_MAX);
  return [item, ...list.filter(r => r.id !== entry.id)].slice(0, RECENT_MAX);
}
export function recentEntries(list: readonly RecentIcon[] | undefined): IconEntry[] {
  const out: IconEntry[] = [];
  for (const item of list ?? []) {
    const known = offlineIcon(item.id);
    if (known) { out.push(known); continue; }
    if (!item.svg || !item.id.startsWith('iconify:')) continue;
    try { sanitizeSvg(item.svg); } catch { continue; }
    const [, prefix = '', name = ''] = item.id.split(':');
    out.push({ id: item.id, name, label: item.label, keywords: '', svg: item.svg, set: setName(prefix), source: item.source ?? item.id, license: item.license ?? '', online: true });
  }
  return out;
}

// ---- Iconify. Only these sets are searched: open licences, suited to diagrams. Brand logos keep their owners'
// trademarks; the licence covers the drawing.
export const ICONIFY_API = 'https://api.iconify.design';
export const ICONIFY_SETS: Readonly<Record<string, { name: string; license: string }>> = {
  lucide: { name: 'Lucide', license: 'ISC' }, tabler: { name: 'Tabler Icons', license: 'MIT' }, ph: { name: 'Phosphor', license: 'MIT' },
  mdi: { name: 'Material Design Icons', license: 'Apache-2.0' }, 'material-symbols': { name: 'Material Symbols', license: 'Apache-2.0' },
  carbon: { name: 'Carbon', license: 'Apache-2.0' }, ri: { name: 'Remix Icon', license: 'Apache-2.0' }, heroicons: { name: 'HeroIcons', license: 'MIT' },
  fluent: { name: 'Fluent UI System Icons', license: 'MIT' }, logos: { name: 'SVG Logos', license: 'CC0-1.0' }, 'simple-icons': { name: 'Simple Icons', license: 'CC0-1.0' },
  devicon: { name: 'Devicon', license: 'MIT' }, 'vscode-icons': { name: 'VSCode Icons', license: 'MIT' }, 'skill-icons': { name: 'Skill Icons', license: 'MIT' },
};
const setName = (prefix: string) => ICONIFY_SETS[prefix]?.name ?? prefix;
export const ICONIFY_PAGE = 64;
export function iconifySearchUrl(query: string, page = 0): string | null {
  const q = query.trim().slice(0, 64); if (q.length < 2) return null;
  // Iconify's `limit` is the end of the window, not its length.
  const url = new URL('/search', ICONIFY_API);
  url.searchParams.set('query', q); url.searchParams.set('start', String(page * ICONIFY_PAGE)); url.searchParams.set('limit', String((page + 1) * ICONIFY_PAGE));
  url.searchParams.set('prefixes', Object.keys(ICONIFY_SETS).join(','));
  return url.href;
}
type Collection = { name?: unknown; author?: { name?: unknown }; license?: { title?: unknown; spdx?: unknown } };
export type IconifyHit = { prefix: string; name: string; set: string; license: string };
const iconName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** The search answer, keeping only well-formed names from the sets above, with each set's licence in words. */
export function parseIconifySearch(raw: unknown): { hits: IconifyHit[]; more: boolean } {
  const body = raw as { icons?: unknown; collections?: Record<string, Collection>; total?: unknown; limit?: unknown } | null;
  if (!body || !Array.isArray(body.icons)) throw new Error('Iconify answered in an unexpected way.');
  const hits: IconifyHit[] = [];
  for (const id of body.icons) {
    if (typeof id !== 'string') continue;
    const [prefix, name, extra] = id.split(':');
    if (extra !== undefined || !prefix || !name || !ICONIFY_SETS[prefix] || !iconName.test(name)) continue;
    const info = body.collections?.[prefix], known = ICONIFY_SETS[prefix];
    const spdx = typeof info?.license?.spdx === 'string' ? info.license.spdx : typeof info?.license?.title === 'string' ? info.license.title : known.license;
    const set = typeof info?.name === 'string' ? info.name : known.name, author = typeof info?.author?.name === 'string' ? info.author.name : '';
    hits.push({ prefix, name, set, license: `${spdx} · ${set}${author && author !== set ? ` (${author})` : ''}`.slice(0, 200) });
  }
  return { hits, more: body.icons.length >= ICONIFY_PAGE };
}
export const iconifyIconsUrl = (prefix: string, names: readonly string[]) => `${ICONIFY_API}/${encodeURIComponent(prefix)}.json?icons=${names.map(encodeURIComponent).join(',')}`;
type IconifyJson = { prefix?: unknown; width?: number; height?: number; icons?: Record<string, { body?: unknown; width?: number; height?: number; left?: number; top?: number }>; aliases?: Record<string, { parent?: string }> };
/** Builds static SVG from one set's icon data. Icons the static dialect refuses (animation, images) are left out. */
export function iconifySvgs(raw: unknown, names: readonly string[]): Map<string, string> {
  const data = raw as IconifyJson | null, out = new Map<string, string>();
  if (!data || typeof data !== 'object' || !data.icons) return out;
  for (const name of names) {
    let key = name; for (let hops = 0; !data.icons[key] && data.aliases?.[key]?.parent && hops < 4; hops++) key = data.aliases[key].parent!;
    const icon = data.icons[key]; if (!icon || typeof icon.body !== 'string') continue;
    const w = icon.width ?? data.width ?? 16, h = icon.height ?? data.height ?? 16, left = icon.left ?? 0, top = icon.top ?? 0;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${left} ${top} ${w} ${h}">${icon.body}</svg>`;
    try { out.set(name, sanitizeSvg(svg).svg); } catch { /* not static: skip it */ }
  }
  return out;
}
export type FetchLike = (url: string, init: { credentials: 'omit'; signal?: unknown }) => Promise<{ ok: boolean; status?: number; json(): Promise<unknown> }>;
const defaultFetch = (): FetchLike | undefined => (globalThis as unknown as { fetch?: FetchLike }).fetch;
async function getJson(url: string, fetcher: FetchLike, timeoutMs: number): Promise<unknown> {
  const Abort = (globalThis as unknown as { AbortController?: new () => { signal: unknown; abort(): void } }).AbortController;
  const abort = Abort ? new Abort() : undefined, timer = setTimeout(() => abort?.abort(), timeoutMs);
  try {
    const response = await fetcher(url, { credentials: 'omit', signal: abort?.signal });
    if (!response.ok) throw new Error(`Iconify answered ${response.status ?? 'with an error'}.`);
    return await response.json();
  } finally { clearTimeout(timer); }
}
/** One page of online results, with their SVG: one search request, then one request per set on the page. */
export async function searchIconify(query: string, page = 0, fetcher: FetchLike | null = defaultFetch() ?? null, timeoutMs = 8000): Promise<{ entries: IconEntry[]; more: boolean }> {
  const url = iconifySearchUrl(query, page); if (!url) return { entries: [], more: false };
  if (!fetcher) throw new Error('This device cannot reach the internet from here.');
  const { hits, more } = parseIconifySearch(await getJson(url, fetcher, timeoutMs));
  const byPrefix = new Map<string, IconifyHit[]>();
  for (const hit of hits) byPrefix.set(hit.prefix, [...(byPrefix.get(hit.prefix) ?? []), hit]);
  const svgs = new Map<string, string>();
  await Promise.all([...byPrefix].map(async ([prefix, list]) => {
    const names = list.map(hit => hit.name);
    try { for (const [name, svg] of iconifySvgs(await getJson(iconifyIconsUrl(prefix, names), fetcher, timeoutMs), names)) svgs.set(prefix + ':' + name, svg); } catch { /* that set's icons stay out of this page */ }
  }));
  const entries = hits.flatMap(hit => { const svg = svgs.get(hit.prefix + ':' + hit.name); return svg ? [{ id: `iconify:${hit.prefix}:${hit.name}`, name: hit.name, label: iconLabel(hit.name), keywords: '', svg, set: hit.set, source: `iconify:${hit.prefix}:${hit.name}`, license: hit.license, online: true }] : []; });
  return { entries, more };
}
/** What an inserted icon carries on its block. */
export const insertMeta = (entry: IconEntry) => ({ caption: entry.label.slice(0, 200), source: entry.source.slice(0, 200), license: entry.license.slice(0, 200) });
