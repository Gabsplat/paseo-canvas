import { execFile } from 'node:child_process';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import type { NetworkInterfaceInfo, networkInterfaces } from 'node:os';

/**
 * "Let agents on other computers connect": the pieces that need no server. Tokens, which addresses Lienzo may listen
 * on (Tailscale, and the private LAN only when asked; never every interface), how a request is classified (this
 * computer or another one), the Tailscale CLI's JSON, and the failed-token limit.
 */
export const TOKEN_PREFIX = 'lz_';
/** 32 random bytes, base64url, after `lz_`: 46 characters. */
export function newToken() { return TOKEN_PREFIX + randomBytes(32).toString('base64url'); }
/** Constant time in the token's content and length: both sides are hashed to the same size first. */
export function sameToken(given: string | null, expected: string | null) {
  if (!given || !expected) return false;
  const a = createHash('sha256').update(given).digest(), b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}
/** The token from `Authorization: Bearer …`, or null. */
export function bearerToken(header: string | string[] | undefined) {
  const value = Array.isArray(header) ? header[0] : header, match = /^Bearer\s+(\S+)\s*$/i.exec(value ?? '');
  return match ? match[1] : null;
}

// ---- Addresses
const v4 = (ip: string) => { const parts = ip.split('.').map(Number); return parts.length === 4 && parts.every(n => Number.isInteger(n) && n >= 0 && n <= 255) ? parts : null; };
/** Tailscale's IPv4 range, 100.64.0.0/10 (shared address space; Tailscale gives every device one). */
export function isTailscaleV4(ip: string) { const p = v4(ip); return !!p && p[0] === 100 && p[1] >= 64 && p[1] <= 127; }
/** Tailscale's IPv6 range, fd7a:115c:a1e0::/48. */
export function isTailscaleV6(ip: string) { return /^fd7a:115c:a1e0(:|$)/i.test(ip); }
/** Private LAN IPv4: 10/8, 172.16/12, 192.168/16. */
export function isPrivateLan(ip: string) { const p = v4(ip); return !!p && (p[0] === 10 || p[0] === 172 && p[1] >= 16 && p[1] <= 31 || p[0] === 192 && p[1] === 168); }
const unmapped = (ip: string) => ip.replace(/^::ffff:/i, '');
export const isLoopback = (ip: string | undefined) => !!ip && (unmapped(ip).startsWith('127.') || ip === '::1');

export type BindKind = 'tailscale' | 'lan';
export interface BindAddress { readonly address: string; readonly family: 4 | 6; readonly kind: BindKind }
export type Interfaces = ReturnType<typeof networkInterfaces>;
/**
 * The addresses to listen on besides 127.0.0.1: the machine's Tailscale addresses, and its private LAN IPv4 addresses
 * only when `lan` is on. Never a wildcard (0.0.0.0, ::), never a public address, never a link-local one.
 */
export function bindAddresses(interfaces: Interfaces, lan: boolean): BindAddress[] {
  const out = new Map<string, BindAddress>();
  for (const list of Object.values(interfaces)) for (const entry of list ?? []) {
    const info = entry as NetworkInterfaceInfo & { family: string | number };
    if (info.internal) continue;
    const family = info.family === 'IPv6' || (info.family as unknown) === 6 ? 6 : 4, address = info.address;
    if (family === 4 && isTailscaleV4(address)) out.set(address, { address, family, kind: 'tailscale' });
    else if (family === 6 && isTailscaleV6(address) && !address.includes('%')) out.set(address, { address, family, kind: 'tailscale' });
    else if (lan && family === 4 && isPrivateLan(address)) out.set(address, { address, family, kind: 'lan' });
  }
  return [...out.values()].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'tailscale' ? -1 : 1) || a.family - b.family || a.address.localeCompare(b.address));
}

// ---- Requests
const FORWARDED = ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'tailscale-user-login', 'tailscale-user-name', 'tailscale-headers-info'];
export const localHosts = (port: number) => [`127.0.0.1:${port}`, `localhost:${port}`];
/**
 * A request from a program on this computer: it came in on the loopback listener, from a loopback address, names
 * 127.0.0.1 or localhost as its Host, and passed through no proxy. Anything else, `tailscale serve` included (it
 * connects from 127.0.0.1 but names the ts.net host and adds forwarding headers), is from another computer.
 */
export function isLocalRequest(request: IncomingMessage, port: number) {
  const socket = request.socket;
  if (!isLoopback(socket.localAddress) || !isLoopback(socket.remoteAddress)) return false;
  if (!localHosts(port).includes(String(request.headers.host ?? '').toLowerCase())) return false;
  return !FORWARDED.some(name => request.headers[name] !== undefined);
}
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
/**
 * Where a remote request comes from, for the rate limit and "Agents seen". Forwarding headers are believed only from
 * a loopback proxy (tailscale serve), and never for access: only the token grants that.
 */
export function requestSource(request: IncomingMessage): { ip: string; login: string | null } {
  const socketIp = unmapped(request.socket.remoteAddress ?? 'unknown');
  if (!isLoopback(request.socket.remoteAddress)) return { ip: socketIp, login: null };
  const forwarded = one(request.headers['x-forwarded-for'])?.split(',').map(part => part.trim()).filter(Boolean).at(-1);
  const login = one(request.headers['tailscale-user-login'])?.slice(0, 200) ?? null;
  return { ip: forwarded ? unmapped(forwarded).slice(0, 64) : socketIp, login };
}

/** At most `limit` failed tokens per source in `windowMs`; then 429 until the window passes. */
export class FailureLimiter {
  private readonly failures = new Map<string, number[]>();
  constructor(private readonly limit = 10, private readonly windowMs = 60_000, private readonly now: () => number = Date.now) {}
  private recent(key: string) { const at = this.now(), list = (this.failures.get(key) ?? []).filter(time => at - time < this.windowMs); if (list.length) this.failures.set(key, list); else this.failures.delete(key); return list; }
  blocked(key: string) { return this.recent(key).length >= this.limit; }
  fail(key: string) {
    const list = this.recent(key); list.push(this.now()); this.failures.set(key, list);
    // Bounded: the oldest sources go first.
    if (this.failures.size > 4096) this.failures.delete(this.failures.keys().next().value!);
  }
  clear() { this.failures.clear(); }
}

// ---- Tailscale CLI
export interface TailscaleInfo { readonly found: boolean; readonly running: boolean; readonly dnsName: string | null; readonly ips: readonly string[]; readonly serveUrl: string | null }
export const noTailscale: TailscaleInfo = { found: false, running: false, dnsName: null, ips: [], serveUrl: null };
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
/** `tailscale status --json`: this device's MagicDNS name (without the trailing dot) and its Tailscale addresses. */
export function parseTailscaleStatus(text: string): Pick<TailscaleInfo, 'running' | 'dnsName' | 'ips'> | null {
  let data: unknown; try { data = JSON.parse(text); } catch { return null; }
  const root = record(data), self = record(root?.Self);
  if (!root || !self) return null;
  const dns = typeof self.DNSName === 'string' ? self.DNSName.replace(/\.$/, '').toLowerCase() : '';
  const ips = Array.isArray(self.TailscaleIPs) ? self.TailscaleIPs.filter((ip): ip is string => typeof ip === 'string' && (isTailscaleV4(ip) || isTailscaleV6(ip))) : [];
  return { running: root.BackendState === undefined || root.BackendState === 'Running', dnsName: /^[a-z0-9.-]+$/.test(dns) && dns.includes('.') ? dns : null, ips };
}
/**
 * `tailscale serve status --json`: the https address that proxies to this port on this computer, or null. Handles
 * look like `"Web": { "mac.tailnet.ts.net:443": { "Handlers": { "/": { "Proxy": "http://127.0.0.1:7421" } } } }`.
 */
export function parseServeStatus(text: string, port: number): string | null {
  let data: unknown; try { data = JSON.parse(text); } catch { return null; }
  const web = record(record(data)?.Web);
  if (!web) return null;
  for (const [hostPort, config] of Object.entries(web)) {
    const handlers = record(record(config)?.Handlers);
    const match = /^([a-z0-9.-]+):(\d+)$/i.exec(hostPort);
    if (!handlers || !match) continue;
    for (const [mount, handler] of Object.entries(handlers)) {
      const proxy = record(handler)?.Proxy;
      if (typeof proxy !== 'string') continue;
      let target: URL; try { target = new URL(/^[a-z]+:\/\//i.test(proxy) ? proxy : `http://${proxy}`); } catch { continue; }
      const local = ['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) || /^\d+$/.test(proxy);
      const targetPort = /^\d+$/.test(proxy) ? Number(proxy) : Number(target.port || (target.protocol === 'https:' ? 443 : 80));
      if (!local || targetPort !== port || target.protocol !== 'http:' || (target.pathname !== '/' && target.pathname !== '')) continue;
      const host = match[1].toLowerCase(), httpsPort = match[2], path = mount === '/' ? '' : mount.replace(/\/$/, '');
      return `https://${host}${httpsPort === '443' ? '' : `:${httpsPort}`}${path}`;
    }
  }
  return null;
}
/** Where the CLI may be: the Mac app bundles it; elsewhere it is on PATH (Electron on macOS does not get the shell's). */
export function tailscaleCandidates(platform = process.platform): string[] {
  if (platform === 'darwin') return ['/Applications/Tailscale.app/Contents/MacOS/Tailscale', '/opt/homebrew/bin/tailscale', '/usr/local/bin/tailscale', 'tailscale'];
  if (platform === 'win32') return ['C:\\Program Files\\Tailscale\\tailscale.exe', 'tailscale'];
  return ['tailscale', '/usr/bin/tailscale', '/usr/local/bin/tailscale'];
}
export type RunCommand = (file: string, args: readonly string[]) => Promise<string>;
const runCommand: RunCommand = (file, args) => new Promise((resolve, reject) => {
  execFile(file, [...args], { timeout: 2500, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (error, stdout) => error ? reject(error) : resolve(String(stdout)));
});
/** Asks the Tailscale CLI, when there is one, for this device's name and whether `tailscale serve` proxies `port`. */
export async function detectTailscale(port: number, run: RunCommand = runCommand, candidates = tailscaleCandidates()): Promise<TailscaleInfo> {
  for (const file of candidates) {
    if (file.includes('/') || file.includes('\\')) { if (run === runCommand && !existsSync(file)) continue; }
    let status: ReturnType<typeof parseTailscaleStatus>;
    try { status = parseTailscaleStatus(await run(file, ['status', '--json'])); }
    catch (error) {
      // Not installed here: try the next place. Installed but stopped or logged out: it answers with an error.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      return { ...noTailscale, found: true };
    }
    if (!status) return { ...noTailscale, found: true };
    let serveUrl: string | null = null;
    try { serveUrl = parseServeStatus(await run(file, ['serve', 'status', '--json']), port); } catch { /* no serve config */ }
    return { found: true, ...status, serveUrl };
  }
  return noTailscale;
}
