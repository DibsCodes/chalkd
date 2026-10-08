import { BrowserWindow, clipboard, dialog, ipcMain } from 'electron';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ImportFile } from '../shared/types';

export const IMPORT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.pdf': 'application/pdf',
};

export function registerImportIpc(): void {
  ipcMain.handle(
    'import:choose-files',
    async (event): Promise<ImportFile[]> => {
      const win = BrowserWindow.fromWebContents(event.sender)!;
      const result = await dialog.showOpenDialog(win, {
        title: 'Import images or PDFs',
        properties: ['openFile', 'multiSelections'],
        filters: [
          {
            name: 'Images and PDFs',
            extensions: Object.keys(IMPORT_TYPES).map((e) => e.slice(1)),
          },
        ],
      });
      if (result.canceled) return [];
      return Promise.all(
        result.filePaths.map(async (file) => ({
          name: path.basename(file),
          mime:
            IMPORT_TYPES[path.extname(file).toLowerCase()] ??
            'application/octet-stream',
          bytes: new Uint8Array(await readFile(file)),
        })),
      );
    },
  );

  ipcMain.handle(
    'clipboard:has-image',
    async () => (await clipboardImageType()) !== null,
  );

  ipcMain.handle(
    'clipboard:read-image',
    async (): Promise<ImportFile | null> => {
      const found = await clipboardImageType();
      if (!found) return null;
      const blob = await found.item.getType(found.type);
      if (!(blob instanceof Blob)) return null;
      return {
        name: 'Pasted image',
        mime: found.type,
        bytes: new Uint8Array(await blob.arrayBuffer()),
      };
    },
  );
}

/** The first image on the clipboard (PNG preferred), or null. */
async function clipboardImageType() {
  for (const item of await clipboard.read()) {
    const types = item.types.filter((t) => t.startsWith('image/'));
    const type = types.includes('image/png') ? 'image/png' : types[0];
    if (type) return { item, type };
  }
  return null;
}
