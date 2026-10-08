import type { AssetData } from '../../shared/types';

/**
 * Image data for the open board. Bitmaps are decoded on first use; when one
 * finishes decoding, `onReady` fires so the board can redraw.
 */
export class AssetStore {
  private data = new Map<string, AssetData>();
  private bitmaps = new Map<string, ImageBitmap | 'loading' | 'failed'>();
  private unsaved = new Set<string>();
  onReady: () => void = () => {};

  /** Replace everything with a freshly opened board's assets. */
  load(assets: AssetData[]): void {
    for (const b of this.bitmaps.values())
      if (b instanceof ImageBitmap) b.close();
    this.data = new Map(assets.map((a) => [a.hash, a]));
    this.bitmaps.clear();
    this.unsaved.clear();
  }

  has(hash: string): boolean {
    return this.data.has(hash);
  }

  /** Add new image data; it will be saved with the next autosave. */
  add(asset: AssetData): void {
    if (this.data.has(asset.hash)) return;
    this.data.set(asset.hash, asset);
    this.unsaved.add(asset.hash);
  }

  /** The decoded image, or null while it's still loading (or broken). */
  bitmap(hash: string): ImageBitmap | null {
    const b = this.bitmaps.get(hash);
    if (b instanceof ImageBitmap) return b;
    if (b) return null;
    const asset = this.data.get(hash);
    if (!asset) return null;
    this.bitmaps.set(hash, 'loading');
    createImageBitmap(new Blob([asset.bytes as BlobPart], { type: asset.mime }))
      .then((bitmap) => {
        this.bitmaps.set(hash, bitmap);
        this.onReady();
      })
      .catch(() => this.bitmaps.set(hash, 'failed'));
    return null;
  }

  takeUnsaved(): AssetData[] {
    const out = [...this.unsaved].map((h) => this.data.get(h)!).filter(Boolean);
    this.unsaved.clear();
    return out;
  }

  /** A save failed: these still need writing. */
  restoreUnsaved(assets: AssetData[]): void {
    for (const a of assets) this.unsaved.add(a.hash);
  }
}
