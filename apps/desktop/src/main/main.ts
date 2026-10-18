import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, shell, type MenuItemConstructorOptions } from 'electron';
import { join } from 'node:path';
import { startDesktop, type Desktop } from './core';
import { createAppUpdates } from './updater';
import type { UpdateController } from './updater/controller';
import { registerUpdateRpcs } from './updater/rpc';

const isMac = process.platform === 'darwin';
const safeExternal = (url: string) => /^https?:\/\//i.test(url);
let desktop: Desktop | null = null;
let window: BrowserWindow | null = null;
let quitting = false;
let updates: UpdateController | null = null;

function createWindow() {
  window = new BrowserWindow({
    width: 1280, height: 820, minWidth: 560, minHeight: 420, title: 'Lienzo', show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#141311' : '#F4F1EA',
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true },
  });
  window.once('ready-to-show', () => window?.show());
  // The app never navigates away or opens windows: links go to the system browser.
  window.webContents.setWindowOpenHandler(({ url }) => { if (safeExternal(url)) void shell.openExternal(url); return { action: 'deny' }; });
  window.webContents.on('will-navigate', (event, url) => { if (url !== window?.webContents.getURL()) { event.preventDefault(); if (safeExternal(url)) void shell.openExternal(url); } });
  window.on('closed', () => { window = null; });
  void window.loadFile(join(__dirname, 'renderer', 'index.html'));
}

function buildMenu() {
  const copyCommand: MenuItemConstructorOptions = { label: 'Copy the Claude Code MCP Command', click: () => { if (desktop) clipboard.writeText(`claude mcp add lienzo --transport http ${desktop.mcp.url}`); } };
  // Undo and redo show their keys but leave them to the page, where they undo text or the canvas as appropriate.
  const page = { registerAccelerator: false };
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    { label: 'File', submenu: [copyCommand, { type: 'separator' }, isMac ? { role: 'close' } : { role: 'quit' }] },
    { label: 'Edit', submenu: [
      { role: 'undo', ...page }, { role: 'redo', ...page }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, ...(isMac ? [{ role: 'pasteAndMatchStyle' as const }] : []), { role: 'selectAll' },
    ] },
    { label: 'View', submenu: [
      { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' },
    ] },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function start() {
  try {
    desktop = await startDesktop({
      dataDirectory: app.getPath('userData'), version: app.getVersion(),
      shell: {
        openExternal: async url => { if (!safeExternal(url)) return false; await shell.openExternal(url); return true; },
        writeClipboard: async text => { clipboard.writeText(text); return true; },
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox('Lienzo could not open its documents', `${message}\n\nIf another Lienzo is running, use that one. Nothing was overwritten.`);
    app.exit(1); return;
  }
  // Updates never block the app: a copy that cannot update says why in Settings → About.
  updates = await createAppUpdates({
    autoCheck: () => desktop ? desktop.autoCheckUpdates() : Promise.resolve(false),
    // The new version starts while this one exits: it needs the documents, the MCP port and the instance lock free.
    async beforeRestart() {
      quitting = true;
      await desktop?.close().catch(error => console.error('Lienzo did not close cleanly', error));
      app.releaseSingleInstanceLock();
    },
  });
  registerUpdateRpcs(desktop.host, updates);
  updates.start();
  ipcMain.handle('lienzo:invoke', (event, name: unknown, input: unknown) => {
    // Only the app's own page may call in.
    if (!window || event.sender !== window.webContents) return { ok: false, message: 'FORBIDDEN: Unknown caller.' };
    return desktop!.settle(name, input);
  });
  buildMenu();
  createWindow();
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  app.whenReady().then(start);
  app.on('activate', () => { if (!window && desktop) createWindow(); });
  app.on('window-all-closed', () => { if (!isMac) app.quit(); });
  // Close the store (flushing deferred writes and releasing its lock) and the MCP port before exiting.
  app.on('before-quit', event => {
    if (quitting || !desktop) return;
    event.preventDefault(); quitting = true; updates?.stop();
    void desktop.close().catch(error => console.error('Lienzo did not close cleanly', error)).finally(() => app.quit());
  });
}
