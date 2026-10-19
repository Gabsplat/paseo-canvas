import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, shell, type MenuItemConstructorOptions } from 'electron';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { FULL_SCREEN_CHANNEL, TRAFFIC_LIGHTS } from '../shared/chrome';
import { FILES_WAITING_CHANNEL, LIENZO_FILE_MAX_BYTES, SAVE_FILE_CHANNEL, TAKE_FILES_CHANNEL, isLienzoPath, type OpenedFile } from '../shared/files';
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
/** Papel and Tinta's background, shown before the page paints and behind the title area. */
const windowBackground = () => nativeTheme.shouldUseDarkColors ? '#141311' : '#F4F1EA';

function createWindow() {
  window = new BrowserWindow({
    width: 1280, height: 820, minWidth: 560, minHeight: 420, title: 'Lienzo', show: false,
    backgroundColor: windowBackground(),
    // On macOS there is no title bar: the traffic lights float over the panel's top row, which keeps clear of them.
    ...(isMac ? { titleBarStyle: 'hidden' as const, trafficLightPosition: TRAFFIC_LIGHTS } : {}),
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true },
  });
  window.once('ready-to-show', () => window?.show());
  // The app never navigates away or opens windows: links go to the system browser.
  window.webContents.setWindowOpenHandler(({ url }) => { if (safeExternal(url)) void shell.openExternal(url); return { action: 'deny' }; });
  window.webContents.on('will-navigate', (event, url) => { if (url !== window?.webContents.getURL()) { event.preventDefault(); if (safeExternal(url)) void shell.openExternal(url); } });
  // Full screen hides the traffic lights, so the panel gives their corner back; also told after every (re)load.
  const fullScreen = () => window?.webContents.send(FULL_SCREEN_CHANNEL, window.isFullScreen());
  window.on('enter-full-screen', fullScreen); window.on('leave-full-screen', fullScreen); window.webContents.on('did-finish-load', fullScreen);
  window.on('closed', () => { window = null; });
  void window.loadFile(join(__dirname, 'renderer', 'index.html'));
}

// ---- .lienzo files. One opened with the app (double-click, "Open with", a drop on the icon) waits here until the page
// takes it: on macOS it arrives through open-file, possibly before the app is ready; on Windows and Linux as an argument
// of this process or, when Lienzo is already running, of the second instance, forwarded through the instance lock.
const waitingFiles: string[] = [];
function openFiles(paths: readonly string[]) {
  if (!paths.length) return;
  waitingFiles.push(...paths);
  if (window) { if (window.isMinimized()) window.restore(); window.focus(); window.webContents.send(FILES_WAITING_CHANNEL); }
  else if (desktop && app.isReady()) createWindow();
}
const filesIn = (argv: readonly string[], cwd = process.cwd()) => argv.slice(1).filter(isLienzoPath).map(path => resolve(cwd, path));
async function takeFiles(): Promise<OpenedFile[]> {
  const paths = waitingFiles.splice(0);
  return Promise.all(paths.map(async (path): Promise<OpenedFile> => {
    const name = basename(path);
    try {
      if ((await stat(path)).size > LIENZO_FILE_MAX_BYTES) return { name, text: '', error: `“${name}” is larger than ${LIENZO_FILE_MAX_BYTES / 1024 / 1024} MB, the most a .lienzo file can be.` };
      return { name, text: await readFile(path, 'utf8') };
    } catch { return { name, text: '', error: `“${name}” could not be read.` }; }
  }));
}
async function saveFile(file: unknown): Promise<boolean> {
  const { name, text } = (file ?? {}) as { name?: unknown; text?: unknown };
  if (typeof name !== 'string' || typeof text !== 'string' || Buffer.byteLength(text) > LIENZO_FILE_MAX_BYTES || !window) return false;
  const choice = await dialog.showSaveDialog(window, { title: 'Export this Lienzo', defaultPath: join(app.getPath('documents'), basename(name)), filters: [{ name: 'Lienzo', extensions: ['lienzo'] }], properties: ['createDirectory', 'showOverwriteConfirmation'] });
  if (choice.canceled || !choice.filePath) return false;
  await writeFile(isLienzoPath(choice.filePath) ? choice.filePath : choice.filePath + '.lienzo', text, 'utf8');
  return true;
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
        // Settings → Appearance: the page switches itself; the native parts (title area, menus, background) follow here.
        setAppearance: appearance => { nativeTheme.themeSource = appearance; window?.setBackgroundColor(windowBackground()); },
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
  ipcMain.handle(SAVE_FILE_CHANNEL, (event, file: unknown) => window && event.sender === window.webContents ? saveFile(file) : false);
  ipcMain.handle(TAKE_FILES_CHANNEL, event => window && event.sender === window.webContents ? takeFiles() : []);
  nativeTheme.themeSource = await desktop.appearance();
  nativeTheme.on('updated', () => window?.setBackgroundColor(windowBackground()));
  buildMenu();
  createWindow();
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_event, argv, workingDirectory) => {
    if (window) { if (window.isMinimized()) window.restore(); window.focus(); }
    openFiles(filesIn(argv, workingDirectory));
  });
  // macOS: before ready (the file that launched the app) and after (one opened while it runs).
  app.on('open-file', (event, path) => { event.preventDefault(); if (isLienzoPath(path)) openFiles([path]); });
  waitingFiles.push(...filesIn(process.argv));
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
