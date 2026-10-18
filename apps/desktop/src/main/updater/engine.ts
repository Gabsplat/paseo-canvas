// The part of electron-updater's AppUpdater that Lienzo uses. electron-updater's own updaters (NSIS on Windows,
// AppImage and deb on Linux) are used as they are; the Mac updater (mac.ts) implements the same surface, so the
// controller cannot tell them apart.

export type EngineEvent = 'checking-for-update' | 'update-available' | 'update-not-available' | 'download-progress' | 'update-downloaded' | 'error';
export interface UpdateEngine {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  setFeedURL(options: { provider: 'generic'; url: string }): void;
  /** Resolves when the check (and, with autoDownload, the download) has finished; events say what happened. */
  checkForUpdates(): Promise<unknown>;
  /** Installs the downloaded update, quits, and starts the new version. */
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: 'update-available' | 'update-downloaded', listener: (info: { version: string }) => void): unknown;
  on(event: 'download-progress', listener: (progress: { percent: number }) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'checking-for-update' | 'update-not-available', listener: () => void): unknown;
  /**
   * Mac only: puts the new app in place while this one still runs, so a failure is reported and the app keeps
   * running. electron-updater installs inside quitAndInstall instead.
   */
  prepareInstall?(): Promise<void>;
}
