import { BrowserWindow, ipcMain } from 'electron';
import { existsSync } from 'node:fs';
import type { BoardData } from '../shared/types';
import type { BoardSession } from './board-session';
import { parentOf, type Library } from './library';
import { printedBoardName, type PrintInbox } from './print-inbox';

/**
 * Printing to the Chalkd printer. The renderer pulls jobs one at a time
 * (`print:take`), makes each a board, and then reports it `print:done`.
 */
export function registerPrintIpc(
  getLibrary: () => Library,
  getSession: () => BoardSession,
  inbox: PrintInbox,
): void {
  /**
   * Which board each job became. If the window reloads partway through a
   * job, the job is handed out again and must land on the same board.
   */
  const boards = new Map<string, string>();

  inbox.watch(() => {
    for (const win of BrowserWindow.getAllWindows())
      win.webContents.send('print:waiting');
  });

  ipcMain.handle('print:take', (event) => {
    const job = inbox.take();
    if (job) BrowserWindow.fromWebContents(event.sender)?.focus();
    return job;
  });

  /**
   * Open the board for a printout: a new one next to the open board, or the
   * one this job already made. `imported` says whether its pages are on it.
   */
  ipcMain.handle(
    'print:open-board',
    (
      _e,
      id: string,
      title: string,
    ): { board: BoardData; imported: boolean } => {
      const library = getLibrary();
      const session = getSession();
      const made = boards.get(id);
      if (made !== undefined && existsSync(library.abs(made))) {
        const board = session.open(made);
        return { board, imported: board.items.length > 0 };
      }
      const current = session.currentPath;
      const rel = library.createBoard(
        current ? parentOf(current) : '',
        new Date(),
        printedBoardName(title) ?? undefined,
      );
      boards.set(id, rel);
      return { board: session.open(rel), imported: false };
    },
  );

  ipcMain.handle('print:done', (_e, id: string) => {
    boards.delete(id);
    inbox.done(id);
  });
}
