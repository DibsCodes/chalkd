import { app, BrowserWindow, ipcMain, screen } from 'electron';
import path from 'node:path';

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
  });

  // Pinch must reach our canvas, not zoom the page itself.
  win.webContents.on('did-finish-load', () => {
    win.webContents.setVisualZoomLevelLimits(1, 1);
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
};

// Phase 0 spike: the renderer reports what input it sees; we print it to
// stdout so a test session can be read back from the terminal.
ipcMain.handle('spike:env', () => ({
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

ipcMain.on('spike:log', (_event, entry: unknown) => {
  console.log(`[spike] ${JSON.stringify(entry)}`);
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});
