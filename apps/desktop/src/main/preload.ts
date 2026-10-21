import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { CAPTURE_CHANNEL, FULL_SCREEN_CHANNEL } from '../shared/chrome';
import { FILES_WAITING_CHANNEL, SAVE_FILE_CHANNEL, TAKE_FILES_CHANNEL, type OpenedFile } from '../shared/files';

// The renderer's only door to the main process: one invoke for every Lienzo RPC, plus what the window's chrome needs
// (macOS draws its traffic lights over the page, except in full screen) and .lienzo files (the Save dialog, files the
// system opens with the app). No Node, no Electron APIs.
contextBridge.exposeInMainWorld('lienzo', {
  invoke: (name: string, input: unknown): Promise<unknown> => ipcRenderer.invoke('lienzo:invoke', name, input),
  trafficLights: process.platform === 'darwin',
  onFullScreen(listener: (fullScreen: boolean) => void): () => void {
    const handler = (_event: IpcRendererEvent, fullScreen: unknown) => listener(fullScreen === true);
    ipcRenderer.on(FULL_SCREEN_CHANNEL, handler);
    return () => { ipcRenderer.removeListener(FULL_SCREEN_CHANNEL, handler); };
  },
  saveFile: (file: { name: string; mime: string; text: string }): Promise<boolean> => ipcRenderer.invoke(SAVE_FILE_CHANNEL, { name: file.name, text: file.text }),
  /** A PNG data URL of part of this window as drawn now (an extension's lienzo.view.snapshot), or null. */
  capture: (rect: { x: number; y: number; width: number; height: number }): Promise<string | null> => ipcRenderer.invoke(CAPTURE_CHANNEL, rect),
  /** Calls `listener` with every file opened with the app: those waiting now (one may have started it) and later ones. */
  onOpenFile(listener: (file: OpenedFile) => void): () => void {
    const take = async () => { for (const file of await ipcRenderer.invoke(TAKE_FILES_CHANNEL) as OpenedFile[]) listener(file); };
    const handler = () => { void take(); };
    ipcRenderer.on(FILES_WAITING_CHANNEL, handler); void take();
    return () => { ipcRenderer.removeListener(FILES_WAITING_CHANNEL, handler); };
  },
});
