import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { FULL_SCREEN_CHANNEL } from '../shared/chrome';

// The renderer's only door to the main process: one invoke for every Lienzo RPC, plus what the window's chrome needs
// (macOS draws its traffic lights over the page, except in full screen). No Node, no Electron APIs.
contextBridge.exposeInMainWorld('lienzo', {
  invoke: (name: string, input: unknown): Promise<unknown> => ipcRenderer.invoke('lienzo:invoke', name, input),
  trafficLights: process.platform === 'darwin',
  onFullScreen(listener: (fullScreen: boolean) => void): () => void {
    const handler = (_event: IpcRendererEvent, fullScreen: unknown) => listener(fullScreen === true);
    ipcRenderer.on(FULL_SCREEN_CHANNEL, handler);
    return () => { ipcRenderer.removeListener(FULL_SCREEN_CHANNEL, handler); };
  },
});
