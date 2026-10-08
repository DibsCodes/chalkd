import type { Scene, SceneChange } from './scene';

const LIMIT = 500;

/** Undo/redo over scene changes. Every board edit goes through `commit`. */
export class History {
  private undoStack: SceneChange[] = [];
  private redoStack: SceneChange[] = [];
  private listeners = new Set<() => void>();

  constructor(private scene: Scene) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  commit(change: SceneChange): void {
    if (!change.added.length && !change.removed.length) return;
    this.scene.apply(change);
    this.undoStack.push(change);
    if (this.undoStack.length > LIMIT) this.undoStack.shift();
    this.redoStack.length = 0;
    this.notify();
  }

  undo(): boolean {
    const change = this.undoStack.pop();
    if (!change) return false;
    this.scene.apply({ added: change.removed, removed: change.added });
    this.redoStack.push(change);
    this.notify();
    return true;
  }

  redo(): boolean {
    const change = this.redoStack.pop();
    if (!change) return false;
    this.scene.apply(change);
    this.undoStack.push(change);
    this.notify();
    return true;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.notify();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }
}
