import { contextBridge, ipcRenderer } from 'electron';
import type { AppSettings, BoardChanges, BoardData } from '../shared/types';

const api = {
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
    update: (patch: Partial<AppSettings>): Promise<void> =>
      ipcRenderer.invoke('settings:update', patch),
  },
  library: {
    root: (): Promise<string> => ipcRenderer.invoke('library:root'),
    /** Shows a folder picker; resolves to the chosen folder or null. */
    chooseFolder: (): Promise<string | null> =>
      ipcRenderer.invoke('library:choose-folder'),
    setRoot: (dir: string): Promise<BoardData> =>
      ipcRenderer.invoke('library:set-root', dir),
  },
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
