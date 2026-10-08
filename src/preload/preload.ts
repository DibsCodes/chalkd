import { contextBridge, ipcRenderer } from 'electron';

const api = {
  spike: {
    env: () => ipcRenderer.invoke('spike:env'),
    log: (entry: unknown) => ipcRenderer.send('spike:log', entry),
  },
};

export type ChalkdApi = typeof api;

contextBridge.exposeInMainWorld('chalkd', api);
