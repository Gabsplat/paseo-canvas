// Updates in the Electron app: picks the engine for this platform, keeps every request on the feed's hosts, and
// hands the controller what it needs from the app. See docs/desktop.md, "Updates".
import { app, session } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { UpdateController } from './controller';
import type { UpdateEngine } from './engine';
import { allowedUrl, resolveFeed, type Feed } from './feed';
import { blockerMessage, bundleFromExecutable } from './mac-bundle';
import { clearStaging, MacZipUpdater } from './mac';

/**
 * Squirrel.Mac, which electron-updater uses on macOS, installs only code-signed apps. Lienzo is not signed, so the
 * Mac uses MacZipUpdater. Once releases are signed with a Developer ID, set this to true and the Mac uses
 * electron-updater like Windows and Linux.
 */
export const MAC_IS_SIGNED = false;

export interface AppUpdatesOptions {
  autoCheck(): Promise<boolean>;
  beforeRestart(): Promise<void>;
}

/** electron-updater's own downloads run in this session; every request in it must go to the feed's hosts. */
function guardSession(feed: Feed) {
  session.fromPartition('electron-updater', { cache: false }).webRequest.onBeforeRequest((details, callback) => {
    const allowed = allowedUrl(details.url, feed);
    if (!allowed) console.warn('Lienzo update: refused a request outside the update hosts');
    callback({ cancel: !allowed });
  });
}

async function electronUpdater(feed: Feed): Promise<UpdateEngine> {
  guardSession(feed);
  const { autoUpdater } = await import('electron-updater');
  autoUpdater.logger = { info: () => {}, debug: () => {}, warn: (message: unknown) => console.warn('Lienzo update:', message), error: (message: unknown) => console.error('Lienzo update:', message) };
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.setFeedURL({ provider: 'generic', url: feed.url });
  return autoUpdater as unknown as UpdateEngine;
}

/** Builds the controller for this copy of the app. Nothing here throws: a copy that cannot update says why. */
export async function createAppUpdates(options: AppUpdatesOptions): Promise<UpdateController> {
  const version = app.getVersion();
  const make = (engine: UpdateEngine | null, unavailable?: { kind: 'off' | 'blocked'; reason: string }) => new UpdateController({
    version, engine, unavailable, autoCheck: options.autoCheck, beforeRestart: options.beforeRestart,
    recover: () => { app.relaunch(); app.exit(0); }, log: console,
  });
  if (!app.isPackaged) return make(null, { kind: 'off', reason: 'Updates are off in development builds.' });
  let feed: Feed;
  try { feed = resolveFeed(); } catch (error) { return make(null, { kind: 'off', reason: (error as Error).message }); }
  try {
    if (process.platform === 'darwin' && !MAC_IS_SIGNED) {
      const staging = join(app.getPath('userData'), 'updates');
      await clearStaging(staging);
      const engine = new MacZipUpdater({
        currentVersion: version, bundle: bundleFromExecutable(process.execPath), arch: process.arch, feed, stagingRoot: staging,
        quit: () => app.quit(), onQuit: handler => app.on('quit', handler),
      });
      const blocked = engine.blocker();
      return blocked ? make(null, { kind: 'blocked', reason: blockerMessage(blocked) }) : make(engine);
    }
    if (process.platform === 'linux' && !process.env.APPIMAGE && !existsSync(join(process.resourcesPath, 'package-type'))) {
      return make(null, { kind: 'off', reason: 'This copy cannot update itself. Get new versions from GitHub.' });
    }
    return make(await electronUpdater(feed));
  } catch (error) {
    console.error('Lienzo update: the updater did not start', error);
    return make(null, { kind: 'off', reason: 'The updater could not start.' });
  }
}
