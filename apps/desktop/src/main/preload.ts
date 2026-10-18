import { contextBridge, ipcRenderer } from 'electron';

// The renderer's only door to the main process: one invoke for every Lienzo RPC. No Node, no Electron APIs.
contextBridge.exposeInMainWorld('lienzo', {
  invoke: (name: string, input: unknown): Promise<unknown> => ipcRenderer.invoke('lienzo:invoke', name, input),
});
