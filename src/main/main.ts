import { app, BrowserWindow, ipcMain, screen } from 'electron';
import path from 'node:path';
import { runSelfTest } from './selftest';

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
      runSelfTest(win, selfTestDir).finally(() => app.quit());
    }
  });

  // Pinch must reach our canvas, not zoom the page itself.
  win.webContents.on('did-finish-load', () => {
    win.webContents.setVisualZoomLevelLimits(1, 1);
  });

  const page = process.env.CHALKD_SPIKE ? 'spike.html' : 'index.html';
  const search = process.env.CHALKD_BENCH ? 'bench=1' : '';
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

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});
