import { networkInterfaces } from 'node:os';
import { z } from 'zod';
import type { RemoteStatus } from '../shared/rpc';
import type { McpHttpServer } from './mcp-http';
import { bindAddresses, detectTailscale, newToken, noTailscale, type Interfaces, type TailscaleInfo } from './remote';

export const REMOTE_SETTINGS_ID = 'desktop-remote';
const settingsSchema = z.object({ enabled: z.boolean().default(false), lan: z.boolean().default(false), token: z.string().regex(/^lz_[A-Za-z0-9_-]{43,}$/).nullable().default(null) });
export type RemoteSettings = z.infer<typeof settingsSchema>;
export interface RemoteStore { readPrivate(id: string): Promise<unknown>; writePrivate(id: string, values: unknown): Promise<void> }
export interface RemoteAccessOptions {
  mcp: McpHttpServer;
  store: RemoteStore;
  /** Injectable for tests; os.networkInterfaces by default. */
  interfaces?: () => Interfaces;
  tailscale?: (port: number) => Promise<TailscaleInfo>;
  /** How often to look for new or gone addresses (Tailscale may start after Lienzo). */
  intervalMs?: number;
  now?: () => number;
}
const TAILSCALE_TTL = 20_000;

/**
 * "Let agents on other computers connect": the saved choice and token, the extra listeners that follow this
 * computer's addresses while it is on, and what the Tailscale CLI says about this device. Off by default.
 */
export class RemoteAccess {
  private settings: RemoteSettings = { enabled: false, lan: false, token: null };
  private timer: ReturnType<typeof setInterval> | undefined;
  private tailscale: TailscaleInfo = noTailscale;
  private tailscaleAt = 0;
  private detecting: Promise<TailscaleInfo> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly interfaces: () => Interfaces;
  private readonly detect: (port: number) => Promise<TailscaleInfo>;
  private readonly now: () => number;
  constructor(private readonly options: RemoteAccessOptions) {
    this.interfaces = options.interfaces ?? networkInterfaces;
    this.detect = options.tailscale ?? (port => detectTailscale(port));
    this.now = options.now ?? Date.now;
  }

  async start() {
    const parsed = settingsSchema.safeParse(await this.options.store.readPrivate(REMOTE_SETTINGS_ID) ?? {});
    if (parsed.success) this.settings = parsed.data;
    else console.error('Lienzo sharing settings are unreadable; sharing stays off.');
    await this.apply();
  }
  async stop() {
    clearInterval(this.timer); this.timer = undefined;
    await this.serial(async () => { await this.options.mcp.setSharing({ enabled: false, token: null }); await this.options.mcp.setAddresses([]); });
  }
  private serial<T>(run: () => Promise<T>): Promise<T> { const next = this.queue.then(run); this.queue = next.catch(() => {}); return next; }

  /** Applies the saved choice: listeners, token, the periodic address check. */
  private apply() {
    return this.serial(async () => {
      const { mcp } = this.options, on = this.settings.enabled && !!this.settings.token && mcp.listening;
      await mcp.setSharing({ enabled: on, token: on ? this.settings.token : null });
      await mcp.setAddresses(on ? bindAddresses(this.interfaces(), this.settings.lan) : []);
      clearInterval(this.timer); this.timer = undefined;
      if (on) { this.timer = setInterval(() => { void this.refreshAddresses(); }, this.options.intervalMs ?? 10_000); (this.timer as { unref?(): void }).unref?.(); }
    });
  }
  /** New Tailscale or Wi-Fi addresses open, gone ones close. */
  refreshAddresses() {
    return this.serial(async () => {
      if (!this.settings.enabled || !this.options.mcp.sharingEnabled) return;
      await this.options.mcp.setAddresses(bindAddresses(this.interfaces(), this.settings.lan));
    });
  }
  private async save(next: RemoteSettings) {
    await this.options.store.writePrivate(REMOTE_SETTINGS_ID, next);
    this.settings = next;
    await this.apply();
  }
  async set(change: { enabled?: boolean; lan?: boolean }) {
    const enabled = change.enabled ?? this.settings.enabled;
    // The first time it is turned on, a token is made; it stays across off and on, so set-up agents keep working.
    await this.save({ enabled, lan: change.lan ?? this.settings.lan, token: this.settings.token ?? (enabled ? newToken() : null) });
    if (enabled) this.tailscaleAt = 0;
    return this.status();
  }
  async regenerate() {
    await this.save({ ...this.settings, token: newToken() });
    return this.status();
  }

  private async tailscaleInfo(refresh: boolean) {
    if (!this.settings.enabled) return this.tailscale;
    if (!refresh && this.now() - this.tailscaleAt < TAILSCALE_TTL) return this.tailscale;
    this.detecting ??= this.detect(this.options.mcp.port).catch(() => noTailscale).then(info => { this.tailscale = info; this.tailscaleAt = this.now(); this.detecting = null; return info; });
    return this.detecting;
  }
  async status(refresh = false): Promise<RemoteStatus> {
    const { mcp } = this.options, tailscale = await this.tailscaleInfo(refresh), port = mcp.port, listeners = mcp.listeners();
    const open = listeners.filter(entry => entry.listening), host = (address: string) => address.includes(':') ? `[${address}]` : address;
    const addresses: RemoteStatus['addresses'] = [];
    if (this.settings.enabled) {
      if (tailscale.serveUrl) addresses.push({ url: `${tailscale.serveUrl}/mcp`, kind: 'serve' });
      if (tailscale.dnsName && open.some(entry => entry.kind === 'tailscale')) addresses.push({ url: `http://${tailscale.dnsName}:${port}/mcp`, kind: 'magicdns' });
      for (const entry of open) addresses.push({ url: `http://${host(entry.address)}:${port}/mcp`, kind: entry.kind });
    }
    return {
      enabled: this.settings.enabled, lan: this.settings.lan, token: this.settings.token, port, listening: mcp.listening,
      addresses, listeners: listeners.map(({ address, kind, listening, error }) => ({ address, kind, listening, error })),
      tailscale: { found: tailscale.found, running: tailscale.running, dnsName: tailscale.dnsName, serveUrl: tailscale.serveUrl },
    };
  }
}
