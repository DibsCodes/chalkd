import RBush from 'rbush';
import {
  compareRenderOrder,
  unionBounds,
  type Bounds,
  type Item,
} from './items';

interface Entry extends Bounds {
  item: Item;
}

export interface SceneChange {
  added: Item[];
  removed: Item[];
}

export type SceneListener = (change: SceneChange) => void;

/** All items on a board, indexed by id and by position. */
export class Scene {
  private entries = new Map<string, Entry>();
  private tree = new RBush<Entry>();
  private listeners = new Set<SceneListener>();
  private nextZ = 1;

  get size(): number {
    return this.entries.size;
  }

  allocZ(): number {
    return this.nextZ++;
  }

  get(id: string): Item | undefined {
    return this.entries.get(id)?.item;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  apply(change: SceneChange): void {
    for (const item of change.removed) {
      const entry = this.entries.get(item.id);
      if (!entry) continue;
      this.tree.remove(entry);
      this.entries.delete(item.id);
    }
    const fresh: Entry[] = [];
    for (const item of change.added) {
      if (this.entries.has(item.id)) continue;
      const entry: Entry = { ...item.bounds, item };
      this.entries.set(item.id, entry);
      fresh.push(entry);
      if (item.z >= this.nextZ) this.nextZ = item.z + 1;
    }
    if (fresh.length === 1) this.tree.insert(fresh[0]);
    else if (fresh.length > 1) this.tree.load(fresh);

    for (const fn of this.listeners) fn(change);
  }

  all(): Item[] {
    return [...this.entries.values()].map((e) => e.item);
  }

  /** Items overlapping `bounds`, in render order (bottom first). */
  query(bounds: Bounds): Item[] {
    return this.tree
      .search(bounds)
      .map((e) => e.item)
      .sort(compareRenderOrder);
  }

  /** Bounding box of everything on the board, or null when empty. */
  contentBounds(): Bounds | null {
    let b: Bounds | null = null;
    for (const { item } of this.entries.values())
      b = unionBounds(b, item.bounds);
    return b;
  }

  onChange(fn: SceneListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
