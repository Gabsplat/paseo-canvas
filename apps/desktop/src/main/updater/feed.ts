// The update feed: where it is, which hosts may serve it, how its latest*.yml files read, and how versions compare.
// Pure functions, no Electron, so they are tested on their own (tests/desktop-updater.test.ts).
import { FAILSAFE_SCHEMA, load } from 'js-yaml';
import { z } from 'zod';

/**
 * electron-builder's generic provider pointed at GitHub's "latest release" redirect. It resolves to the newest
 * release that is not a draft or a pre-release, so no tag name (desktop-v…) is ever parsed.
 */
export const DEFAULT_FEED = 'https://github.com/Gabsplat/paseo-canvas/releases/latest/download';
/** github.com answers the feed and redirects each file to GitHub's asset storage. */
export const GITHUB_HOSTS: readonly string[] = ['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'];
export const FIRST_CHECK_MS = 10_000;
export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

export interface Feed {
  /** Base URL; latest*.yml and the files they name are relative to it. */
  url: string;
  /** Hosts any request (and every redirect) may go to. */
  hosts: readonly string[];
  /** Plain http is allowed only for a loopback test feed set with LIENZO_UPDATE_FEED. */
  allowHttp: boolean;
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/**
 * The feed to use. LIENZO_UPDATE_FEED replaces it (for testing an update against a local server); it must be https,
 * or http on this computer. A bad override is an error in words rather than a silent fallback.
 */
export function resolveFeed(env: Record<string, string | undefined> = process.env): Feed {
  const override = env.LIENZO_UPDATE_FEED?.trim();
  if (!override) return { url: DEFAULT_FEED, hosts: GITHUB_HOSTS, allowHttp: false };
  let parsed: URL;
  try { parsed = new URL(override); } catch { throw new Error('LIENZO_UPDATE_FEED is not a URL.'); }
  const loopback = LOOPBACK.has(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) throw new Error('LIENZO_UPDATE_FEED must be https, or http on 127.0.0.1.');
  if (parsed.username || parsed.password) throw new Error('LIENZO_UPDATE_FEED must not carry credentials.');
  return { url: override.replace(/\/+$/, ''), hosts: [parsed.hostname, ...GITHUB_HOSTS], allowHttp: loopback };
}

/** Whether a request (or a redirect) may go to this URL. */
export function allowedUrl(url: string, feed: Pick<Feed, 'hosts' | 'allowHttp'>): boolean {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.username || parsed.password) return false;
  if (parsed.protocol === 'https:') return feed.hosts.includes(parsed.hostname);
  return parsed.protocol === 'http:' && feed.allowHttp && LOOPBACK.has(parsed.hostname) && feed.hosts.includes(parsed.hostname);
}

/** electron-updater's file names: latest.yml (Windows), latest-mac.yml, latest-linux.yml (latest-linux-arm64.yml…). */
export function channelFile(platform: NodeJS.Platform, arch: string): string {
  if (platform === 'darwin') return 'latest-mac.yml';
  if (platform === 'linux') return `latest-linux${arch === 'x64' ? '' : `-${arch}`}.yml`;
  return 'latest.yml';
}

// ---- Versions: major.minor.patch with an optional pre-release (1.2.0-beta.1), semver precedence. Build metadata is ignored.
const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
export interface Version { major: number; minor: number; patch: number; pre: string[] }
export function parseVersion(text: string): Version | null {
  const match = VERSION.exec(text.trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), pre: match[4] ? match[4].split('.') : [] };
}
/** Negative when a < b, 0 when equal, positive when a > b. Throws on something that is not a version. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) throw new Error(`Not a version: ${!x ? a : b}`);
  for (const key of ['major', 'minor', 'patch'] as const) if (x[key] !== y[key]) return x[key] - y[key];
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length; // 1.0.0 > 1.0.0-beta
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q);
    if (pn && qn) { if (Number(p) !== Number(q)) return Number(p) - Number(q); continue; }
    if (pn !== qn) return pn ? -1 : 1;
    if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}
export const isNewer = (candidate: string, current: string) => compareVersions(candidate, current) > 0;

// ---- latest*.yml, as electron-builder writes it.
const SHA512 = /^[A-Za-z0-9+/]{86}==$/;
const fileSchema = z.object({
  url: z.string().min(1).max(500),
  sha512: z.string().regex(SHA512, 'sha512 must be base64'),
  size: z.coerce.number().int().positive().optional(),
});
const infoSchema = z.object({
  version: z.string().refine(value => !!parseVersion(value), 'version must be x.y.z'),
  files: z.array(fileSchema).min(1),
  releaseDate: z.string().optional(),
});
export type UpdateFile = z.infer<typeof fileSchema>;
export type UpdateInfo = z.infer<typeof infoSchema>;

/**
 * Reads a latest*.yml. Every scalar stays a string (no YAML type guessing: `version: 1.10` is not 1.1), then the
 * shape is checked: a version, and at least one file with a sha512. File names must be plain names in the feed.
 */
export function parseUpdateInfo(text: string): UpdateInfo {
  let raw: unknown;
  try { raw = load(text, { schema: FAILSAFE_SCHEMA, json: false }); } catch { throw new Error('The update feed is not readable YAML.'); }
  const parsed = infoSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`The update feed is not in the expected format (${parsed.error.issues[0]?.path.join('.') || 'root'}: ${parsed.error.issues[0]?.message}).`);
  for (const file of parsed.data.files) if (!/^[A-Za-z0-9._-]+$/.test(file.url) || file.url.startsWith('.')) throw new Error(`The update feed names an unexpected file: ${file.url}`);
  return parsed.data;
}

/** The mac zip for this architecture: Lienzo-<v>-mac-arm64.zip on Apple silicon, the zip without arm64 on Intel. */
export function pickMacZip(info: UpdateInfo, arch: string): UpdateFile {
  const zips = info.files.filter(file => file.url.toLowerCase().endsWith('.zip'));
  const match = arch === 'arm64' ? zips.find(file => /arm64/i.test(file.url)) : zips.find(file => !/arm64/i.test(file.url));
  if (!match) throw new Error(`This release has no Mac download for ${arch === 'arm64' ? 'Apple silicon' : 'Intel'}.`);
  return match;
}

/** The URL of a file the feed names. */
export const fileUrl = (feed: Pick<Feed, 'url'>, name: string) => `${feed.url}/${encodeURIComponent(name)}`;
