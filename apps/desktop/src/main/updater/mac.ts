// Lienzo's own updater for macOS. electron-updater's MacUpdater hands the zip to Squirrel.Mac, which refuses an app
// that is not code-signed, and Lienzo is not. This one does the same job without Squirrel: it reads latest-mac.yml,
// downloads the zip for this architecture with Node (so it gets no quarantine flag), checks its sha512, unpacks it
// with ditto, checks the bundle ID and version, and swaps the bundle in place when the person restarts or quits.
// When the app is signed, engine selection in index.ts switches the Mac to electron-updater (docs/desktop.md).
import { execFile, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { UpdateEngine } from './engine';
import { channelFile, fileUrl, isNewer, parseUpdateInfo, pickMacZip, type Feed } from './feed';
import { downloadVerified, fetchText } from './download';
import { blockerMessage, checkExtracted, installBlocker, leftovers, realOps, swapBundle, type BlockReason } from './mac-bundle';

const run = promisify(execFile);

export interface MacUpdaterOptions {
  currentVersion: string;
  /** The running app bundle (…/Lienzo.app), or null when not in one. */
  bundle: string | null;
  arch: string;
  feed: Feed;
  /** A private folder for downloads and unpacked bundles (it is emptied before each download). */
  stagingRoot: string;
  quit(): void;
  /** Registers a handler run synchronously as the app quits (Electron's `quit` event). */
  onQuit(handler: () => void): void;
  log?: Pick<Console, 'info' | 'warn' | 'error'>;
  /** Unpacks a verified zip into a folder. ditto by default; tests on Linux pass their own. */
  extract?(zip: string, destination: string): Promise<void>;
  /** Reads a bundle's Info.plist (plutil for binary plists). */
  plutil?: string;
}
const ditto = async (zip: string, destination: string) => { await run('/usr/bin/ditto', ['-x', '-k', zip, destination]); };

export class MacZipUpdater extends EventEmitter implements UpdateEngine {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  private feed: Feed;
  private staged: { bundle: string; version: string } | null = null;
  private installed = false;
  private running: Promise<unknown> | null = null;
  private readonly log: Pick<Console, 'info' | 'warn' | 'error'>;
  constructor(private readonly options: MacUpdaterOptions) {
    super();
    this.feed = options.feed;
    this.log = options.log ?? console;
    options.onQuit(() => this.installOnQuit());
    // Old copies a previous swap could not remove.
    if (options.bundle) for (const old of leftovers(options.bundle)) { try { realOps.remove(old); } catch { /* next time */ } }
  }

  /** Why this copy cannot update itself (translocated, on a disk image, not writable), or null. */
  blocker(): BlockReason | null { return installBlocker(this.options.bundle); }

  setFeedURL(options: { provider: 'generic'; url: string }) { this.feed = { ...this.feed, url: options.url.replace(/\/+$/, '') }; }

  checkForUpdates(): Promise<unknown> {
    // One check at a time; a second call joins the first.
    if (!this.running) this.running = this.check().finally(() => { this.running = null; });
    return this.running;
  }

  private async check() {
    try {
      const blocked = this.blocker();
      if (blocked) throw new Error(blockerMessage(blocked));
      this.emit('checking-for-update');
      const info = parseUpdateInfo(await fetchText(fileUrl(this.feed, channelFile('darwin', this.options.arch)), this.feed));
      if (!isNewer(info.version, this.options.currentVersion)) { this.emit('update-not-available'); return; }
      this.emit('update-available', { version: info.version });
      if (this.staged?.version === info.version) { this.emit('update-downloaded', { version: info.version }); return; }
      if (!this.autoDownload) return;
      const file = pickMacZip(info, this.options.arch);
      const folder = join(this.options.stagingRoot, info.version);
      await rm(this.options.stagingRoot, { recursive: true, force: true });
      await mkdir(join(folder, 'app'), { recursive: true, mode: 0o700 });
      const zip = join(folder, 'update.zip');
      await downloadVerified(fileUrl(this.feed, file.url), zip, file, this.feed, fraction => this.emit('download-progress', { percent: fraction * 100 }));
      // Only a zip whose sha512 matched reaches this line.
      await (this.options.extract ?? ditto)(zip, join(folder, 'app'));
      await rm(zip, { force: true });
      const bundle = checkExtracted(join(folder, 'app'), info.version, this.options.plutil);
      this.staged = { bundle, version: info.version };
      this.emit('update-downloaded', { version: info.version });
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      this.emit('error', failure);
      throw failure;
    }
  }

  /** Swaps the new bundle in while this one runs. On failure the old app is back in place and this throws. */
  async prepareInstall() {
    if (this.installed) return;
    if (!this.staged || !this.options.bundle) throw new Error('No update is ready.');
    const blocked = this.blocker();
    if (blocked) throw new Error(blockerMessage(blocked));
    const { leftover } = swapBundle(this.options.bundle, this.staged.bundle);
    if (leftover) this.log.warn('Lienzo update: the old app could not be removed; it will be next time.');
    this.installed = true;
  }

  /** Opens the new app once this process has exited, then quits. Call prepareInstall first. */
  quitAndInstall() {
    if (!this.installed) {
      try { if (this.staged && this.options.bundle) { swapBundle(this.options.bundle, this.staged.bundle); this.installed = true; } }
      catch (error) { this.emit('error', error instanceof Error ? error : new Error(String(error))); return; }
    }
    if (this.options.bundle) {
      // Positional arguments, no interpolation: the shell only ever sees "$1" and "$2".
      spawn('/bin/sh', ['-c', 'while kill -0 "$1" 2>/dev/null; do sleep 0.2; done; exec /usr/bin/open "$2"', 'lienzo-relaunch', String(process.pid), this.options.bundle], { detached: true, stdio: 'ignore' }).unref();
    }
    this.options.quit();
  }

  /** "Or on next quit": a downloaded update goes in place as the app quits, without reopening it. */
  private installOnQuit() {
    if (!this.autoInstallOnAppQuit || this.installed || !this.staged || !this.options.bundle || this.blocker()) return;
    try { swapBundle(this.options.bundle, this.staged.bundle); this.installed = true; }
    catch (error) { this.log.error('Lienzo update was not installed on quit', error); }
  }
}

/** Removes the staging folder when nothing is staged (at startup). */
export async function clearStaging(root: string) {
  try { if ((await readdir(root)).length) await rm(root, { recursive: true, force: true }); } catch { /* absent */ }
}
