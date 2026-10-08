import { contextBridge, ipcRenderer } from 'electron';
import type { BoardChanges, BoardData } from '../shared/types';

const api = {
  board: {
    openInitial: (): Promise<BoardData> =>
      ipcRenderer.invoke('board:open-initial'),
    write: (changes: BoardChanges): Promise<void> =>
      ipcRenderer.invoke('board:write', changes),
    /** Blocking write for the window's last moments. Returns an error or null. */
    writeSync: (changes: BoardChanges): string | null =>
      ipcRenderer.sendSync('board:write-sync', changes),
  },
  dev: {
    env: () => ipcRenderer.invoke('dev:env'),
    log: (entry: unknown) => ipcRenderer.send('dev:log', entry),
  },
};

export type ChalkdApi = typeof api;

contextBridge.exposeInMainWorld('chalkd', api);
