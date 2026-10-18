// The parts of the Mac updater that touch the app bundle on disk: where the running app is, whether it can be
// replaced there, what a downloaded bundle claims to be, and the swap itself. Filesystem calls are injected, so the
// whole sequence is tested on Linux with fake bundles (tests/desktop-updater.test.ts).
import { execFileSync } from 'node:child_process';
import { accessSync, constants, cpSync, existsSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

export const BUNDLE_ID = 'dev.gabsplat.lienzo';
export const MOVE_TO_APPLICATIONS = 'Move Lienzo to Applications to get updates.';

/** /Applications/Lienzo.app from /Applications/Lienzo.app/Contents/MacOS/Lienzo; null outside a bundle. */
export function bundleFromExecutable(executable: string): string | null {
  const match = /^(.*\.app)\/Contents\/MacOS\/[^/]+$/.exec(executable);
  return match ? match[1] : null;
}

export type BlockReason = 'not-bundle' | 'translocated' | 'volume' | 'unwritable';
export interface PathProbe { writable(path: string): boolean }
export const realProbe: PathProbe = { writable: path => { try { accessSync(path, constants.W_OK); return true; } catch { return false; } } };

/**
 * Why this copy cannot replace itself, or null when it can. A quarantined app opened from Downloads runs from a
 * read-only random path (App Translocation); one opened from the .dmg runs from /Volumes; and the app and the
 * folder it sits in must both be writable to move the old bundle aside and the new one in.
 */
export function installBlocker(bundle: string | null, probe: PathProbe = realProbe): BlockReason | null {
  if (!bundle) return 'not-bundle';
  if (bundle.includes('/AppTranslocation/')) return 'translocated';
  if (bundle.startsWith('/Volumes/')) return 'volume';
  if (!probe.writable(dirname(bundle)) || !probe.writable(bundle)) return 'unwritable';
  return null;
}
export function blockerMessage(reason: BlockReason): string {
  return reason === 'not-bundle' ? 'This copy of Lienzo is not an app bundle, so it cannot update itself.' : MOVE_TO_APPLICATIONS;
}

// ---- Info.plist
const plistString = (xml: string, key: string) => new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(xml)?.[1] ?? null;
/** The bundle ID and version an app bundle declares. XML plists are read directly; a binary one goes through plutil. */
export function readBundleInfo(bundle: string, plutil = '/usr/bin/plutil'): { id: string | null; version: string | null } {
  const file = join(bundle, 'Contents', 'Info.plist');
  let data = readFileSync(file);
  if (data.subarray(0, 6).toString('latin1') === 'bplist') data = execFileSync(plutil, ['-convert', 'xml1', '-o', '-', file]);
  const xml = data.toString('utf8');
  return { id: plistString(xml, 'CFBundleIdentifier'), version: plistString(xml, 'CFBundleShortVersionString') };
}

/**
 * The one .app a verified zip unpacked into `folder`, checked to be Lienzo at exactly `version`. Anything else
 * (no app, two apps, another bundle ID, another version) is refused.
 */
export function checkExtracted(folder: string, version: string, plutil?: string): string {
  const apps = readdirSync(folder).filter(name => name.endsWith('.app'));
  if (apps.length !== 1) throw new Error('The update does not hold exactly one app.');
  const bundle = join(folder, apps[0]);
  if (!statSync(bundle).isDirectory()) throw new Error('The update does not hold an app.');
  const info = readBundleInfo(bundle, plutil);
  if (info.id !== BUNDLE_ID) throw new Error('The update is not Lienzo.');
  if (info.version !== version) throw new Error(`The update says version ${info.version ?? 'unknown'}, not ${version}.`);
  return bundle;
}

// ---- The swap
export interface SwapOps {
  exists(path: string): boolean;
  /** Moves a folder. Falls back to copy-and-delete across volumes. */
  move(from: string, to: string): void;
  remove(path: string): void;
}
export const realOps: SwapOps = {
  exists: existsSync,
  move(from, to) {
    try { renameSync(from, to); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
      cpSync(from, to, { recursive: true, verbatimSymlinks: true, preserveTimestamps: true, errorOnExist: true, force: false });
      rmSync(from, { recursive: true, force: true });
    }
  },
  remove: path => rmSync(path, { recursive: true, force: true }),
};

/**
 * Replaces the app at `current` with the bundle at `next`: the old one moves aside (Lienzo.app.old-<stamp>, in the
 * same folder, so it is a rename), the new one moves in, the old one is removed. If moving the new one in fails, the
 * old one goes back and the error is thrown, so the app is never left missing. Failing to remove the old copy is not
 * an error: it is left beside the app and removed on the next update.
 */
export function swapBundle(current: string, next: string, ops: SwapOps = realOps, stamp = Date.now().toString(36)): { leftover: string | null } {
  if (!ops.exists(current)) throw new Error('The running app is not where it was.');
  if (!ops.exists(next)) throw new Error('The downloaded app is missing.');
  const aside = join(dirname(current), `${basename(current)}.old-${stamp}`);
  ops.move(current, aside);
  try { ops.move(next, current); }
  catch (error) {
    try { if (ops.exists(current)) ops.remove(current); ops.move(aside, current); }
    catch { throw new Error(`The update failed and the old app could not be put back. It is at ${aside}.`); }
    throw error;
  }
  try { ops.remove(aside); return { leftover: null }; } catch { return { leftover: aside }; }
}

/** Old copies a previous swap could not remove (Lienzo.app.old-*), next to the app. */
export function leftovers(bundle: string, list: (folder: string) => string[] = folder => readdirSync(folder)): string[] {
  const prefix = `${basename(bundle)}.old-`;
  try { return list(dirname(bundle)).filter(name => name.startsWith(prefix)).map(name => join(dirname(bundle), name)); } catch { return []; }
}
