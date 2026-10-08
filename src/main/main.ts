import { app, BrowserWindow, dialog, ipcMain, screen } from 'electron';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AppSettings, BoardChanges } from '../shared/types';
import { BoardSession } from './board-session';
import { Library } from './library';
import { registerExportIpc } from './export-ipc';
import { registerImportIpc } from './import-ipc';
import { registerLibraryIpc } from './library-ipc';
import { PrintInbox } from './print-inbox';
import { registerPrintIpc } from './print-ipc';
import { runSelfTest } from './selftest';
import { SettingsStore } from './settings';

// Benchmarks and self-tests must never touch the real library, so they run
// in a throwaway sandbox unless CHALKD_SANDBOX names one to reuse.
const isDevRun = Boolean(
  process.env.CHALKD_BENCH || process.env.CHALKD_SELFTEST,
);
const sandbox =
  process.env.CHALKD_SANDBOX ??
  (isDevRun ? mkdtempSync(path.join(os.tmpdir(), 'chalkd-')) : null);

const configDir = sandbox
  ? path.join(sandbox, 'config')
  : path.join(app.getPath('appData'), 'chalkd');
app.setPath('userData', configDir);

// One Chalkd per profile: a second launch (from the app launcher, or the
// print watcher in packaging/systemd) brings the open window forward and
// quits. The lock lives in userData, so sandboxed runs don't collide.
if (!app.requestSingleInstanceLock()) app.exit(0);

const settings = new SettingsStore(configDir);
const defaultRoot = sandbox
  ? path.join(sandbox, 'library')
  : path.join(app.getPath('documents'), 'Chalkd');

function makeLibrary(): Library {
  return new Library(settings.get('rootDir') ?? defaultRoot, () =>
    settings.get('defaultBackground'),
  );
}
let library = makeLibrary();
let session = new BoardSession(library, settings);

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    title: 'Chalkd',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
    const selfTestDir = process.env.CHALKD_SELFTEST;
    if (selfTestDir) {
      runSelfTest(win, selfTestDir, printInbox.dir).finally(() => app.quit());
    }
  });

  // Pinch must reach our canvas, not zoom the page itself.
  win.webContents.on('did-finish-load', () => {
    win.webContents.setVisualZoomLevelLimits(1, 1);
  });

  const page = process.env.CHALKD_SPIKE ? 'spike.html' : 'index.html';
  const search = process.env.CHALKD_BENCH
    ? 'bench=1'
    : process.env.CHALKD_SELFTEST
      ? 'selftest=1'
      : '';
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    win.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}/${page}?${search}`);
  } else {
    win.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/${page}`),
      { search },
    );
  }
};

// Dev diagnostics (input spike, benchmark): the renderer reports what it
// sees and we print it to stdout so a session can be read back later.
ipcMain.handle('dev:env', () => ({
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  ozonePlatform:
    app.commandLine.getSwitchValue('ozone-platform') ||
    app.commandLine.getSwitchValue('ozone-platform-hint') ||
    '(default)',
  sessionType: process.env.XDG_SESSION_TYPE ?? '',
  waylandDisplay: process.env.WAYLAND_DISPLAY ?? '',
  displays: screen.getAllDisplays().map((d) => ({
    id: d.id,
    size: `${d.size.width}x${d.size.height}`,
    scale: d.scaleFactor,
    touchSupport: d.touchSupport,
  })),
}));

ipcMain.on('dev:log', (_event, entry: unknown) => {
  console.log(`[chalkd] ${JSON.stringify(entry)}`);
  if (
    process.env.CHALKD_BENCH &&
    (entry as { benchDone?: boolean })?.benchDone
  ) {
    app.quit();
  }
});

ipcMain.handle('settings:get', () => settings.all());

ipcMain.handle('settings:update', (_event, patch: Partial<AppSettings>) => {
  // The library location changes only through library:set-root.
  const { rootDir: _r, lastBoard: _l, ...rest } = patch;
  settings.update(rest);
});

ipcMain.handle('library:root', () => library.root);

ipcMain.handle('library:choose-folder', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)!;
  const result = await dialog.showOpenDialog(win, {
    title: 'Choose where Chalkd keeps your notebooks',
    defaultPath: library.root,
    properties: ['openDirectory', 'createDirectory'],
  });
  return result.canceled ? null : (result.filePaths[0] ?? null);
});

/** Switch to another library folder and open a board from it. */
ipcMain.handle('library:set-root', (_event, dir: string) => {
  session.close();
  settings.update({
    rootDir: dir === defaultRoot ? null : dir,
    lastBoard: null,
  });
  library = makeLibrary();
  session = new BoardSession(library, settings);
  return session.openInitial();
});

ipcMain.handle('board:open-initial', () => session.openInitial());

registerLibraryIpc(
  () => library,
  () => session,
);
registerImportIpc();
registerExportIpc(() => library, settings);

// Where the Chalkd printer leaves jobs (see scripts/printer/chalkd-backend).
const printInbox = new PrintInbox(
  process.env.CHALKD_PRINT_INBOX ??
    (sandbox
      ? path.join(sandbox, 'printed')
      : path.join(os.homedir(), '.local', 'share', 'chalkd', 'printed')),
);
registerPrintIpc(
  () => library,
  () => session,
  printInbox,
);

ipcMain.handle('board:write', (_event, changes: BoardChanges) => {
  session.write(changes);
});

// Used only while the window is closing, when async IPC may never land.
ipcMain.on('board:write-sync', (event, changes: BoardChanges) => {
  try {
    session.write(changes);
    event.returnValue = null;
  } catch (err) {
    event.returnValue = String(err);
  }
});

app.whenReady().then(createWindow);

app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

app.on('will-quit', () => session.close());

app.on('window-all-closed', () => {
  app.quit();
});
