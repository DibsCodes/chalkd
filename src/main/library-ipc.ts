import { ipcMain, shell } from 'electron';
import { rm } from 'node:fs/promises';
import type { LibraryState } from '../shared/types';
import type { BoardSession } from './board-session';
import { isSameOrInside, type Library } from './library';

const NEW_NOTEBOOK_NAME = 'New notebook';

/**
 * Drawer operations. The renderer stops autosaving before calling any of
 * these and resumes afterwards, so no writes race the file moves.
 */
export function registerLibraryIpc(
  getLibrary: () => Library,
  getSession: () => BoardSession,
): void {
  const state = (
    extra: Pick<LibraryState, 'reopened' | 'moved'> = {},
  ): LibraryState => ({
    tree: getLibrary().tree(),
    current: getSession().currentPath,
    ...extra,
  });

  /** Where the open board ends up when `from` becomes `to`. */
  const remap = (current: string, from: string, to: string) =>
    isSameOrInside(current, from) ? to + current.slice(from.length) : current;

  ipcMain.handle('library:tree', () => state());

  ipcMain.handle('board:open', (_e, rel: string) => getSession().open(rel));

  ipcMain.handle('library:create-board', (_e, notebook: string) => {
    const rel = getLibrary().createBoard(notebook);
    return getSession().open(rel);
  });

  ipcMain.handle('library:create-notebook', (_e, parent: string) => {
    const library = getLibrary();
    const notebook = library.createNotebook(parent, NEW_NOTEBOOK_NAME);
    return getSession().open(library.createBoard(notebook));
  });

  ipcMain.handle('library:rename', async (_e, rel: string, name: string) => {
    const to = await getSession().around(
      () => getLibrary().rename(rel, name),
      (current, renamed) => remap(current, rel, renamed),
    );
    return state({ moved: { from: rel, to } });
  });

  ipcMain.handle(
    'library:move',
    async (_e, rel: string, parent: string, before: string | null) => {
      const to = await getSession().around(
        () => getLibrary().move(rel, parent, before),
        (current, moved) => remap(current, rel, moved),
      );
      return state({ moved: { from: rel, to } });
    },
  );

  ipcMain.handle(
    'library:delete',
    async (_e, rel: string, permanent = false) => {
      const session = getSession();
      const wasOpen =
        session.currentPath !== null &&
        isSameOrInside(session.currentPath, rel);
      const dispose = permanent
        ? (abs: string) => rm(abs, { recursive: true, force: true })
        : async (abs: string) => {
            try {
              await shell.trashItem(abs);
            } catch (err) {
              // Some filesystems (USB sticks, tmpfs) have no trash; the drawer
              // offers a permanent delete when it sees this marker.
              throw new Error(
                `TRASH_FAILED: ${err instanceof Error ? err.message : err}`,
              );
            }
          };
      await session.around(
        () => getLibrary().remove(rel, dispose),
        (current) => (isSameOrInside(current, rel) ? null : current),
      );
      // The open board went to the trash: show another one (or a fresh one).
      return wasOpen ? state({ reopened: session.openInitial() }) : state();
    },
  );
}
