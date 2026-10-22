import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppSettings,
  BoardChanges,
  BoardData,
  ImportFile,
  LibraryState,
  PrintJob,
} from '../shared/types';

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
    tree: (): Promise<LibraryState> => ipcRenderer.invoke('library:tree'),
    createBoard: (notebook: string): Promise<BoardData> =>
      ipcRenderer.invoke('library:create-board', notebook),
    createNotebook: (parent: string): Promise<BoardData> =>
      ipcRenderer.invoke('library:create-notebook', parent),
    /** Copies a board next to itself and opens the copy. */
    duplicate: (rel: string): Promise<BoardData> =>
      ipcRenderer.invoke('library:duplicate', rel),
    rename: (rel: string, name: string): Promise<LibraryState> =>
      ipcRenderer.invoke('library:rename', rel, name),
    /** Move into `parent`, just before sibling `before` (or at the end). */
    move: (
      rel: string,
      parent: string,
      before: string | null,
    ): Promise<LibraryState> =>
      ipcRenderer.invoke('library:move', rel, parent, before),
    /** Moves to the system trash, or deletes outright if `permanent`. */
    delete: (rel: string, permanent = false): Promise<LibraryState> =>
      ipcRenderer.invoke('library:delete', rel, permanent),
  },
  import: {
    /** Shows a file picker; resolves to the chosen files (empty if cancelled). */
    chooseFiles: (): Promise<ImportFile[]> =>
      ipcRenderer.invoke('import:choose-files'),
    clipboardHasImage: (): Promise<boolean> =>
      ipcRenderer.invoke('clipboard:has-image'),
    clipboardImage: (): Promise<ImportFile | null> =>
      ipcRenderer.invoke('clipboard:read-image'),
  },
  export: {
    /** Asks where to save; resolves to where it went (for display), or null if cancelled. */
    png: (name: string, bytes: Uint8Array): Promise<string | null> =>
      ipcRenderer.invoke('export:png', name, bytes),
    pdf: (name: string, html: string): Promise<string | null> =>
      ipcRenderer.invoke('export:pdf', name, html),
  },
  print: {
    /** The oldest job from the Chalkd printer, or null. */
    take: (): Promise<PrintJob | null> => ipcRenderer.invoke('print:take'),
    /** Open the board for a printout (made next to the open one the first time). */
    openBoard: (
      id: string,
      title: string,
    ): Promise<{ board: BoardData; imported: boolean }> =>
      ipcRenderer.invoke('print:open-board', id, title),
    done: (id: string): Promise<void> => ipcRenderer.invoke('print:done', id),
    /** Called when a new job may have arrived. */
    onWaiting: (fn: () => void): void => {
      ipcRenderer.on('print:waiting', () => fn());
    },
    /** Whether Chalkd can add its printer here (Windows), and if it has. */
    status: (): Promise<{ manageable: boolean; installed: boolean }> =>
      ipcRenderer.invoke('printer:status'),
    /** Add or remove the printer (Windows asks for permission). Resolves to an error message or null. */
    setInstalled: (on: boolean): Promise<string | null> =>
      ipcRenderer.invoke('printer:set', on),
  },
  system: {
    platform: process.platform,
    /** Windows Settings › Bluetooth & devices › Touch. */
    openTouchSettings: (): Promise<void> =>
      ipcRenderer.invoke('system:open-touch-settings'),
  },
  board: {
    /** Read a board without opening it for editing. */
    read: (rel: string): Promise<BoardData> =>
      ipcRenderer.invoke('board:read', rel),
    openInitial: (): Promise<BoardData> =>
      ipcRenderer.invoke('board:open-initial'),
    open: (rel: string): Promise<BoardData> =>
      ipcRenderer.invoke('board:open', rel),
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
