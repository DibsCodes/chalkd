import { contextBridge, ipcRenderer } from 'electron';

const api = {
  dev: {
    env: () => ipcRenderer.invoke('dev:env'),
    log: (entry: unknown) => ipcRenderer.send('dev:log', entry),
  },
};

export type ChalkdApi = typeof api;

contextBridge.exposeInMainWorld('chalkd', api);
