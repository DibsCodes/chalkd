import type { Camera } from './camera';
import type { AssetStore } from './assets';
import { drawPattern } from './background';
import { drawItem } from './draw';
import {
  DEFAULT_BACKGROUND,
  type Background,
  type Bounds,
} from '../../shared/types';
import type { Scene, SceneChange } from './scene';

/** Above this full-redraw cost, pan/zoom moves a bitmap snapshot instead. */
const SNAPSHOT_THRESHOLD_MS = 6;
/** How often a snapshot is refreshed during a long gesture. */
const SNAPSHOT_REFRESH_MS = 250;

export interface RenderStats {
  contentMs: number;
  visible: number;
  usingSnapshot: boolean;
}

export type LiveDrawer = (ctx: CanvasRenderingContext2D) => void;

interface Snapshot {
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  zoom: number;
  at: number;
}

/**
 * Three stacked canvases: background pattern, finished items, and the stroke
 * being drawn right now. Each redraws only when invalidated.
 */
export class Renderer {
  readonly stats: RenderStats = {
    contentMs: 0,
    visible: 0,
    usingSnapshot: false,
  };

  private bg: CanvasRenderingContext2D;
  private content: CanvasRenderingContext2D;
  private live: CanvasRenderingContext2D;
  private snapCanvas = document.createElement('canvas');
  private snapshot: Snapshot | null = null;

  private cssWidth = 0;
  private cssHeight = 0;
  private dpr = 1;
  private dirtyBg = true;
  private dirtyContent = true;
  private dirtyLive = true;
  private inGesture = false;
  private liveDrawer: LiveDrawer | null = null;
  private hidden = new Set<string>();
  private frameId = 0;
  private resizeObserver: ResizeObserver;
  private unsubscribe: () => void;
  private _background = DEFAULT_BACKGROUND;

  constructor(
    private container: HTMLElement,
    private scene: Scene,
    private camera: Camera,
    private assets: AssetStore,
  ) {
    assets.onReady = () => (this.dirtyContent = true);
    this.bg = this.addLayer({ alpha: false });
    this.content = this.addLayer({});
    this.live = this.addLayer({});
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.unsubscribe = scene.onChange((c) => this.sceneChanged(c));
    this.resize();
    this.frameId = requestAnimationFrame(this.frame);
  }

  get width(): number {
    return this.cssWidth;
  }

  get height(): number {
    return this.cssHeight;
  }

  get background(): Background {
    return this._background;
  }

  set background(bg: Background) {
    this._background = bg;
    this.dirtyBg = true;
  }

  /** World-space rectangle currently on screen. */
  viewBounds(): Bounds {
    const tl = this.camera.toWorld(0, 0);
    const br = this.camera.toWorld(this.cssWidth, this.cssHeight);
    return { minX: tl.x, minY: tl.y, maxX: br.x, maxY: br.y };
  }

  setLive(drawer: LiveDrawer | null): void {
    this.liveDrawer = drawer;
    this.dirtyLive = true;
  }

  /**
   * Leave these items out of the finished-items layer (a tool is previewing
   * them, moved, on the live layer).
   */
  setHidden(ids: Iterable<string>): void {
    this.hidden = new Set(ids);
    this.dirtyContent = true;
  }

  invalidateLive(): void {
    this.dirtyLive = true;
  }

  invalidateContent(): void {
    this.dirtyContent = true;
  }

  cameraChanged(): void {
    this.dirtyBg = this.dirtyContent = this.dirtyLive = true;
  }

  beginGesture(): void {
    this.inGesture = true;
    if (!this.dirtyContent && this.stats.contentMs > SNAPSHOT_THRESHOLD_MS) {
      this.takeSnapshot();
    }
  }

  endGesture(): void {
    this.inGesture = false;
    this.snapshot = null;
    this.dirtyContent = true;
  }

  dispose(): void {
    cancelAnimationFrame(this.frameId);
    this.resizeObserver.disconnect();
    this.unsubscribe();
  }

  // ---------- internals ----------

  private addLayer(
    opts: CanvasRenderingContext2DSettings,
  ): CanvasRenderingContext2D {
    const canvas = document.createElement('canvas');
    canvas.className = 'board-layer';
    this.container.appendChild(canvas);
    return canvas.getContext('2d', opts)!;
  }

  private resize(): void {
    this.dpr = window.devicePixelRatio || 1;
    this.cssWidth = this.container.clientWidth;
    this.cssHeight = this.container.clientHeight;
    const w = Math.round(this.cssWidth * this.dpr);
    const h = Math.round(this.cssHeight * this.dpr);
    for (const ctx of [this.bg, this.content, this.live]) {
      ctx.canvas.width = w;
      ctx.canvas.height = h;
    }
    this.snapshot = null;
    this.cameraChanged();
  }

  private frame = (): void => {
    this.frameId = requestAnimationFrame(this.frame);
    if ((window.devicePixelRatio || 1) !== this.dpr) this.resize();
    if (this.dirtyBg) {
      this.dirtyBg = false;
      this.drawBackground();
    }
    if (this.dirtyContent) {
      this.dirtyContent = false;
      this.drawContent();
    }
    if (this.dirtyLive) {
      this.dirtyLive = false;
      this.drawLive();
    }
  };

  private setWorldTransform(ctx: CanvasRenderingContext2D): void {
    const z = this.camera.zoom * this.dpr;
    ctx.setTransform(z, 0, 0, z, -this.camera.x * z, -this.camera.y * z);
  }

  private clear(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }

  private sceneChanged(change: SceneChange): void {
    // Fast path: new pen ink always lands on top, so it can be painted
    // straight onto the existing content without a full redraw.
    const appendOnly =
      !this.dirtyContent &&
      !this.snapshot &&
      change.removed.length === 0 &&
      change.added.every(
        (item) => item.type === 'stroke' && item.kind === 'pen',
      );
    if (!appendOnly) {
      this.dirtyContent = true;
      return;
    }
    const view = this.viewBounds();
    this.setWorldTransform(this.content);
    for (const item of change.added) {
      if (intersects(item.bounds, view))
        drawItem(this.content, item, this.assets);
    }
  }

  private drawContent(): void {
    const now = performance.now();
    const ctx = this.content;
    this.clear(ctx);

    const snap = this.snapshot;
    if (this.inGesture && snap && now - snap.at < SNAPSHOT_REFRESH_MS) {
      const scale = this.camera.zoom / snap.zoom;
      const dx = (snap.x - this.camera.x) * this.camera.zoom * this.dpr;
      const dy = (snap.y - this.camera.y) * this.camera.zoom * this.dpr;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(
        snap.canvas,
        dx,
        dy,
        snap.canvas.width * scale,
        snap.canvas.height * scale,
      );
      this.stats.usingSnapshot = true;
      return;
    }

    this.setWorldTransform(ctx);
    const items = this.scene.query(this.viewBounds());
    for (const item of items) {
      if (!this.hidden.has(item.id)) drawItem(ctx, item, this.assets);
    }

    this.stats.contentMs = performance.now() - now;
    this.stats.visible = items.length;
    this.stats.usingSnapshot = false;
    if (this.inGesture && this.stats.contentMs > SNAPSHOT_THRESHOLD_MS) {
      this.takeSnapshot();
    }
  }

  private takeSnapshot(): void {
    const src = this.content.canvas;
    const snap = this.snapCanvas;
    if (snap.width !== src.width || snap.height !== src.height) {
      snap.width = src.width;
      snap.height = src.height;
    }
    const sctx = snap.getContext('2d')!;
    sctx.clearRect(0, 0, snap.width, snap.height);
    sctx.drawImage(src, 0, 0);
    this.snapshot = {
      canvas: snap,
      x: this.camera.x,
      y: this.camera.y,
      zoom: this.camera.zoom,
      at: performance.now(),
    };
  }

  private drawLive(): void {
    const ctx = this.live;
    this.clear(ctx);
    if (!this.liveDrawer) return;
    this.setWorldTransform(ctx);
    this.liveDrawer(ctx);
  }

  private drawBackground(): void {
    const ctx = this.bg;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this._background.color;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    this.setWorldTransform(ctx);
    drawPattern(ctx, this._background, this.viewBounds(), this.camera.zoom);
  }
}

function intersects(a: Bounds, b: Bounds): boolean {
  return (
    a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY
  );
}
