import type { BoardChanges, BoardData } from '../shared/types';
import { BoardFile } from './board-file';
import { boardDisplayName, FIRST_NOTEBOOK, type Library } from './library';
import type { SettingsStore } from './settings';

/** The one board currently open in the window. */
export class BoardSession {
  private current: { rel: string; file: BoardFile } | null = null;

  constructor(
    private library: Library,
    private settings: SettingsStore,
  ) {}

  /**
   * Reopen the last board. If it's gone or can't be read, fall back to the
   * first board in the library, and failing that, a brand-new one — a broken
   * file must never stop the app from starting.
   */
  openInitial(): BoardData {
    this.library.ensure();
    const candidates = [
      this.settings.get('lastBoard'),
      this.library.firstBoard(),
    ];
    for (const rel of candidates) {
      if (!this.library.isBoard(rel)) continue;
      try {
        return this.open(rel);
      } catch (err) {
        console.error(`Couldn't open ${rel}:`, err);
      }
    }
    const notebook = this.library.isNotebook(FIRST_NOTEBOOK)
      ? FIRST_NOTEBOOK
      : this.library.createNotebook('', FIRST_NOTEBOOK);
    return this.open(this.library.createBoard(notebook));
  }

  open(rel: string): BoardData {
    const file = BoardFile.open(this.library.abs(rel));
    let data;
    try {
      data = file.read();
    } catch (err) {
      file.close();
      throw err;
    }
    this.close();
    this.current = { rel, file };
    this.settings.set('lastBoard', rel);
    return { path: rel, name: boardDisplayName(rel), ...data };
  }

  write(changes: BoardChanges): void {
    if (!this.current) throw new Error('No board is open');
    this.current.file.write(changes);
  }

  close(): void {
    this.current?.file.close();
    this.current = null;
  }
}
