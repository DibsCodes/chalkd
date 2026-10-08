import type { BoardChanges, BoardMeta, Item } from '../../shared/types';
import type { Editor } from '../engine/editor';
import type { SceneChange } from '../engine/scene';

/** Edits are written in batches this long after the first unsaved change. */
export const SAVE_DELAY_MS = 500;
/** The view position matters less; save it at most this often. */
export const CAMERA_SAVE_DELAY_MS = 1000;
/** After a failed write, try again this much later. */
export const RETRY_DELAY_MS = 5000;

export interface SaveBackend {
  write(changes: BoardChanges): Promise<void>;
  /** Blocking write for when the window is closing; returns an error or null. */
  writeSync(changes: BoardChanges): string | null;
}

/**
 * Watches the editor and writes every change to the open board file.
 * There's no Save button: a crash loses at most the last half-second.
 */
export class Autosave {
  private upserts = new Map<string, Item>();
  private deletes = new Set<string>();
  private meta: Partial<BoardMeta> = {};
  private timer: ReturnType<typeof setTimeout> | null = null;
  private deadline = Infinity;
  private writing: Promise<void> = Promise.resolve();
  private unsubscribe: (() => void)[];

  constructor(
    private editor: Editor,
    private backend: SaveBackend,
    private onError: (err: unknown) => void,
  ) {
    this.unsubscribe = [
      editor.scene.onChange((c) => this.sceneChanged(c)),
      editor.onCameraChange(() => {
        this.meta.camera = editor.camera.state;
        this.schedule(CAMERA_SAVE_DELAY_MS);
      }),
      editor.onBackgroundChange((bg) => {
        this.meta.background = bg;
        this.schedule(SAVE_DELAY_MS);
      }),
    ];
  }

  get hasPending(): boolean {
    return (
      this.upserts.size > 0 ||
      this.deletes.size > 0 ||
      Object.keys(this.meta).length > 0
    );
  }

  /** Write everything pending now. Resolves once it's on disk. */
  flush(): Promise<void> {
    this.clearTimer();
    const changes = this.take();
    if (changes) {
      this.writing = this.writing
        .then(() => this.backend.write(changes))
        .catch((err) => {
          this.restore(changes);
          this.schedule(RETRY_DELAY_MS);
          this.onError(err);
        });
    }
    return this.writing;
  }

  /** Last-chance save while the window closes. */
  flushSync(): void {
    this.clearTimer();
    const changes = this.take();
    if (!changes) return;
    const err = this.backend.writeSync(changes);
    if (err) this.onError(new Error(err));
  }

  async dispose(): Promise<void> {
    for (const off of this.unsubscribe) off();
    await this.flush();
  }

  private sceneChanged(change: SceneChange): void {
    for (const item of change.removed) {
      this.upserts.delete(item.id);
      this.deletes.add(item.id);
    }
    for (const item of change.added) {
      this.deletes.delete(item.id);
      this.upserts.set(item.id, item);
    }
    this.schedule(SAVE_DELAY_MS);
  }

  /** Save within `delay` ms, without postponing an earlier deadline. */
  private schedule(delay: number): void {
    const deadline = performance.now() + delay;
    if (this.timer && deadline >= this.deadline) return;
    this.clearTimer();
    this.deadline = deadline;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.deadline = Infinity;
      void this.flush();
    }, delay);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.deadline = Infinity;
  }

  private take(): BoardChanges | null {
    if (!this.hasPending) return null;
    const changes: BoardChanges = {
      upserts: [...this.upserts.values()],
      deletes: [...this.deletes],
    };
    if (Object.keys(this.meta).length) changes.meta = this.meta;
    this.upserts = new Map();
    this.deletes = new Set();
    this.meta = {};
    return changes;
  }

  /** Put a failed batch back, unless newer edits have superseded parts of it. */
  private restore(changes: BoardChanges): void {
    for (const item of changes.upserts) {
      if (!this.upserts.has(item.id) && !this.deletes.has(item.id)) {
        this.upserts.set(item.id, item);
      }
    }
    for (const id of changes.deletes) {
      if (!this.upserts.has(id)) this.deletes.add(id);
    }
    this.meta = { ...changes.meta, ...this.meta };
  }
}
