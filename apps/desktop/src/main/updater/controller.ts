// The update state the app shows, the schedule (10 s after start, then every 6 h, when the setting allows), and
// the restart. It drives any UpdateEngine and knows nothing of Electron, so it is tested with a fake engine.
import type { UpdateState } from '../../shared/rpc';
import type { UpdateEngine } from './engine';
import { CHECK_EVERY_MS, FIRST_CHECK_MS } from './feed';

export interface ControllerOptions {
  version: string;
  /** Null when this copy does not update itself; `off` or `blocked` then says why. */
  engine: UpdateEngine | null;
  unavailable?: { kind: 'off' | 'blocked'; reason: string };
  /** The "Automatically check for updates" setting, read before every scheduled check. */
  autoCheck(): Promise<boolean>;
  /** Before installing: close the documents and the MCP port, release the single-instance lock. */
  beforeRestart(): Promise<void>;
  /** The install failed after beforeRestart closed everything: start this version again. */
  recover(): void;
  now?: () => Date;
  timers?: { setTimeout: typeof setTimeout; setInterval: typeof setInterval; clearTimeout: typeof clearTimeout; clearInterval: typeof clearInterval };
  log?: Pick<Console, 'warn'>;
}

/** An error in words a person can act on. electron-updater's errors can carry stacks and whole HTTP bodies. */
export function describeUpdateError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error ?? '');
  const code = (error as { code?: string } | null)?.code ?? '';
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_NETWORK_CHANGED|ERR_CONNECTION|did not answer in time/i.test(`${code} ${text}`)) return 'Could not reach the update server. Lienzo will try again later.';
  if (/sha512 checksum mismatch|does not match the release checksum|checksum/i.test(text)) return 'The download did not match its checksum, so it was thrown away.';
  if (/\b404\b|No release was found|Cannot find .*latest/i.test(text)) return 'No release was found on the update server.';
  if (/Refused to download|ERR_BLOCKED_BY_CLIENT/i.test(text)) return 'The update came from an unexpected address, so it was refused.';
  const first = text.split('\n')[0].trim().replace(/\s+/g, ' ');
  return first ? (first.length > 160 ? `${first.slice(0, 157)}…` : first) : 'The update failed.';
}

export class UpdateController {
  private current: UpdateState;
  private checkedAt: string | null = null;
  private target = '';
  private first?: ReturnType<typeof setTimeout>;
  private every?: ReturnType<typeof setInterval>;
  private checking: Promise<void> | null = null;
  private restarting = false;
  private readonly timers: NonNullable<ControllerOptions['timers']>;
  private readonly now: () => Date;

  constructor(private readonly options: ControllerOptions) {
    this.timers = options.timers ?? { setTimeout, setInterval, clearTimeout, clearInterval };
    this.now = options.now ?? (() => new Date());
    this.current = options.engine ? { kind: 'idle', checkedAt: null } : options.unavailable ?? { kind: 'off', reason: 'Updates are off.' };
    const engine = options.engine;
    if (!engine) return;
    engine.autoDownload = true;
    engine.autoInstallOnAppQuit = true;
    engine.on('checking-for-update', () => { this.set({ kind: 'checking' }); });
    engine.on('update-available', info => { this.target = info.version; this.set({ kind: 'downloading', version: info.version, percent: 0 }); });
    engine.on('download-progress', progress => { if (this.current.kind === 'downloading' || this.current.kind === 'checking') this.set({ kind: 'downloading', version: this.target, percent: clampPercent(progress.percent) }); });
    engine.on('update-not-available', () => { this.checkedAt = this.now().toISOString(); this.set({ kind: 'idle', checkedAt: this.checkedAt }); });
    engine.on('update-downloaded', info => { this.checkedAt = this.now().toISOString(); this.set({ kind: 'ready', version: info.version }); });
    engine.on('error', error => { this.fail(error); });
  }

  get state(): UpdateState { return this.current; }
  get version() { return this.options.version; }
  status() { return { version: this.options.version, state: this.current }; }

  /** First check 10 s after start, then every 6 h; each one only if the setting is on. Errors never escape. */
  start() {
    if (!this.options.engine) return;
    const tick = () => { void this.options.autoCheck().then(on => { if (on) return this.check(); }).catch(error => this.options.log?.warn('Lienzo update check skipped', error)); };
    this.first = this.timers.setTimeout(tick, FIRST_CHECK_MS);
    this.every = this.timers.setInterval(tick, CHECK_EVERY_MS);
  }
  stop() { this.timers.clearTimeout(this.first); this.timers.clearInterval(this.every); }

  /** Checks now (the button, or the schedule). While checking, downloading or ready, it returns what is happening. */
  async check(): Promise<UpdateState> {
    const engine = this.options.engine;
    if (!engine || this.restarting) return this.current;
    if (this.current.kind === 'ready' || this.current.kind === 'downloading') return this.current;
    if (!this.checking) {
      this.set({ kind: 'checking' });
      this.checking = (async () => {
        try {
          await engine.checkForUpdates();
          // An engine that decided not to check (electron-updater outside a packaged app) sends no event.
          if (this.current.kind === 'checking') { this.checkedAt = this.now().toISOString(); this.set({ kind: 'idle', checkedAt: this.checkedAt }); }
        } catch (error) { if (this.current.kind !== 'error') this.fail(error); }
        finally { this.checking = null; }
      })();
    }
    return this.current;
  }

  /** Installs and restarts. Returns false (with the state saying why) when there is nothing to install or it failed. */
  async restart(): Promise<boolean> {
    const engine = this.options.engine;
    if (!engine || this.current.kind !== 'ready' || this.restarting) return false;
    this.restarting = true;
    try {
      await engine.prepareInstall?.();
      await this.options.beforeRestart();
      // Silent (no installer pages on Windows), then start the new version.
      engine.quitAndInstall(true, true);
      // electron-updater installs inside quitAndInstall and reports a failure as an error event, not a throw.
      if ((this.current.kind as UpdateState['kind']) === 'error') { this.options.recover(); return false; }
      return true;
    } catch (error) {
      this.restarting = false;
      this.fail(error);
      return false;
    }
  }

  private fail(error: unknown) { this.set({ kind: 'error', message: describeUpdateError(error), checkedAt: this.checkedAt }); }
  private set(state: UpdateState) { this.current = state; }
}
const clampPercent = (value: number) => Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
