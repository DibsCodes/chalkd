import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { BoardData } from '../shared/types';
import { BoardFile } from './board-file';
import { boardDisplayName, type Library } from './library';
import type { SettingsStore } from './settings';

/**
 * Saving exports. The renderer draws the board (PNG bytes, or HTML for
 * PDF); this side asks where to save, prints PDFs, and writes the file.
 */
export function registerExportIpc(
  getLibrary: () => Library,
  settings: SettingsStore,
): void {
  /** Read a board without opening it for editing (for exporting from the drawer). */
  ipcMain.handle('board:read', (_e, rel: string): BoardData => {
    const file = BoardFile.open(getLibrary().abs(rel));
    try {
      return { path: rel, name: boardDisplayName(rel), ...file.read() };
    } finally {
      file.close();
    }
  });

  ipcMain.handle(
    'export:png',
    async (event, name: string, bytes: Uint8Array) => {
      const target = await chooseTarget(event.sender, name, 'png');
      if (!target) return null;
      await writeFile(target, bytes);
      return friendlyPath(target);
    },
  );

  ipcMain.handle('export:pdf', async (event, name: string, html: string) => {
    const target = await chooseTarget(event.sender, name, 'pdf');
    if (!target) return null;
    await writeFile(target, await printHtml(html));
    return friendlyPath(target);
  });

  async function chooseTarget(
    sender: Electron.WebContents,
    name: string,
    ext: 'png' | 'pdf',
  ): Promise<string | null> {
    // Self-tests can't click a save dialog; they export into a folder instead.
    const testDir = process.env.CHALKD_EXPORT_DIR;
    if (testDir)
      return path.join(
        testDir,
        `${safeFileName(name)}-${++testExports}.${ext}`,
      );
    const win = BrowserWindow.fromWebContents(sender)!;
    const dir = settings.get('lastExportDir') ?? app.getPath('documents');
    const result = await dialog.showSaveDialog(win, {
      title: ext === 'pdf' ? 'Export as PDF' : 'Export as picture',
      defaultPath: path.join(dir, `${safeFileName(name)}.${ext}`),
      filters: [
        ext === 'pdf'
          ? { name: 'PDF', extensions: ['pdf'] }
          : { name: 'PNG image', extensions: ['png'] },
      ],
    });
    if (result.canceled || !result.filePath) return null;
    let file = result.filePath;
    if (path.extname(file).toLowerCase() !== `.${ext}`) file += `.${ext}`;
    settings.set('lastExportDir', path.dirname(file));
    return file;
  }
}

let testExports = 0;

/** Print an HTML page to PDF in a hidden window, honoring its @page sizes. */
async function printHtml(html: string): Promise<Buffer> {
  // A temp file rather than a data: URL — boards with pictures get big.
  const dir = await mkdtemp(path.join(os.tmpdir(), 'chalkd-export-'));
  const file = path.join(dir, 'board.html');
  const win = new BrowserWindow({
    show: false,
    webPreferences: { javascript: false },
  });
  try {
    await writeFile(file, html);
    await win.loadFile(file);
    return await win.webContents.printToPDF({
      preferCSSPageSize: true,
      printBackground: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    });
  } finally {
    win.destroy();
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * For messages: "~/Documents/Lesson.pdf" rather than the full home path, or
 * "Documents\Lesson.pdf" on Windows, where "~" means nothing to people.
 */
function friendlyPath(file: string): string {
  const home = os.homedir();
  if (!file.startsWith(home + path.sep)) return file;
  return process.platform === 'win32'
    ? file.slice(home.length + 1)
    : '~' + file.slice(home.length);
}

function safeFileName(name: string): string {
  // oxlint-disable-next-line no-control-regex -- stripping them is the point
  return name.replace(/[/\\:*?"<>|\u0000-\u001f]/g, '-').trim() || 'Board';
}
