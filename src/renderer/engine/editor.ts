import { AssetStore } from './assets';
import { Camera, clampZoom, type Point } from './camera';
import { History } from './history';
import { InputRouter, type InputOptions, type InputTarget } from './input';
import type {
  AssetData,
  Background,
  BoardMeta,
  Bounds,
  Item,
} from '../../shared/types';
import type { StrokeStyle } from './items';
import { Renderer } from './renderer';
import { Scene } from './scene';
import { PenTool } from './tools/pen';
import type { Tool } from './tools/tool';

export const DEFAULT_PEN: StrokeStyle = {
  kind: 'pen',
  color: '#1d2433',
  width: 4,
  opacity: 1,
};

const FIT_MARGIN_PX = 48;

interface CameraTarget {
  x: number;
  y: number;
  zoom: number;
}

/** One open board: its items, history, camera, rendering, and input. */
export class Editor implements InputTarget {
  readonly camera = new Camera();
  readonly scene = new Scene();
  readonly history = new History(this.scene);
  readonly assets = new AssetStore();
  readonly renderer: Renderer;
  readonly input: InputRouter;
  tool: Tool;

  private cameraListeners = new Set<() => void>();
  private backgroundListeners = new Set<(bg: Background) => void>();
  private animation: number | null = null;

  constructor(container: HTMLElement, options: Partial<InputOptions> = {}) {
    this.renderer = new Renderer(
      container,
      this.scene,
      this.camera,
      this.assets,
    );
    this.input = new InputRouter(this, {
      palmContactPx: null,
      ...options,
    });
    this.input.attach(container);
    this.tool = new PenTool(this, DEFAULT_PEN, 0.5);
    this.centerOn({ x: 0, y: 0 }, 1);
  }

  dispose(): void {
    this.stopAnimation();
    this.input.dispose();
    this.renderer.dispose();
  }

  /** Replace everything with a board loaded from disk. */
  load(board: { meta: BoardMeta; items: Item[]; assets: AssetData[] }): void {
    this.stopAnimation();
    this.tool.cancel();
    this.history.clear();
    this.assets.load(board.assets);
    this.scene.apply({ added: board.items, removed: this.scene.all() });
    this.renderer.background = board.meta.background;
    if (board.meta.camera) {
      this.camera.state = board.meta.camera;
      this.cameraChanged();
    } else {
      this.centerOn({ x: 0, y: 0 }, 1);
    }
  }

  /** Switch tools between interactions (an open stroke is abandoned). */
  setTool(tool: Tool): void {
    this.tool.cancel();
    this.tool.dispose?.();
    this.tool = tool;
    tool.activate?.();
  }

  get background(): Background {
    return this.renderer.background;
  }

  setBackground(bg: Background): void {
    this.renderer.background = bg;
    for (const fn of this.backgroundListeners) fn(bg);
  }

  onBackgroundChange(fn: (bg: Background) => void): () => void {
    this.backgroundListeners.add(fn);
    return () => this.backgroundListeners.delete(fn);
  }

  /** Remove everything as one undoable step. */
  clearBoard(): void {
    if (this.input.busy) return;
    this.history.commit({ added: [], removed: this.scene.all() });
  }

  // ---------- InputTarget ----------

  toolDown(p: Point): void {
    this.stopAnimation();
    this.tool.down(p);
  }

  toolMove(points: Point[]): void {
    this.tool.move(points);
  }

  toolUp(): void {
    this.tool.up();
  }

  toolCancel(): void {
    this.tool.cancel();
  }

  cameraChanged(): void {
    this.renderer.cameraChanged();
    for (const fn of this.cameraListeners) fn();
  }

  gestureStart(): void {
    this.stopAnimation();
    this.renderer.beginGesture();
  }

  gestureEnd(): void {
    this.renderer.endGesture();
  }

  // ---------- commands ----------

  undo(): void {
    if (!this.input.busy) this.history.undo();
  }

  redo(): void {
    if (!this.input.busy) this.history.redo();
  }

  /** Zoom to 100% around the middle of the screen. */
  zoomToActual(): void {
    const c = this.camera.toWorld(
      this.renderer.width / 2,
      this.renderer.height / 2,
    );
    this.animateTo(this.targetCenteredOn(c, 1));
  }

  /** Show everything on the board (never zooming in past 100%). */
  fitContent(): void {
    const b = this.scene.contentBounds();
    if (!b) {
      this.animateTo(this.targetCenteredOn({ x: 0, y: 0 }, 1));
      return;
    }
    this.fitBounds(b);
  }

  /** Bring a region into view (never zooming in past 100%). */
  fitBounds(b: Bounds): void {
    const w = Math.max(1, this.renderer.width - FIT_MARGIN_PX * 2);
    const h = Math.max(1, this.renderer.height - FIT_MARGIN_PX * 2);
    const zoom = clampZoom(
      Math.min(1, w / (b.maxX - b.minX || 1), h / (b.maxY - b.minY || 1)),
    );
    const center = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
    this.animateTo(this.targetCenteredOn(center, zoom));
  }

  onCameraChange(fn: () => void): () => void {
    this.cameraListeners.add(fn);
    return () => this.cameraListeners.delete(fn);
  }

  // ---------- camera helpers ----------

  private centerOn(world: Point, zoom: number): void {
    const t = this.targetCenteredOn(world, zoom);
    this.camera.x = t.x;
    this.camera.y = t.y;
    this.camera.zoom = t.zoom;
    this.cameraChanged();
  }

  private targetCenteredOn(world: Point, zoom: number): CameraTarget {
    return {
      x: world.x - this.renderer.width / 2 / zoom,
      y: world.y - this.renderer.height / 2 / zoom,
      zoom,
    };
  }

  /**
   * Glide the camera: zoom interpolates geometrically and the screen-center
   * point linearly, which reads as a straight, steady move.
   */
  private animateTo(target: CameraTarget, ms = 240): void {
    this.stopAnimation();
    const w2 = this.renderer.width / 2;
    const h2 = this.renderer.height / 2;
    const from = this.camera.clone();
    const c0 = from.toWorld(w2, h2);
    const c1 = {
      x: target.x + w2 / target.zoom,
      y: target.y + h2 / target.zoom,
    };
    const start = performance.now();
    this.renderer.beginGesture();

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const e = 1 - Math.pow(1 - t, 3);
      const zoom = from.zoom * Math.pow(target.zoom / from.zoom, e);
      const cx = c0.x + (c1.x - c0.x) * e;
      const cy = c0.y + (c1.y - c0.y) * e;
      this.camera.zoom = zoom;
      this.camera.x = cx - w2 / zoom;
      this.camera.y = cy - h2 / zoom;
      this.cameraChanged();
      if (t < 1) {
        this.animation = requestAnimationFrame(step);
      } else {
        this.animation = null;
        this.renderer.endGesture();
      }
    };
    this.animation = requestAnimationFrame(step);
  }

  private stopAnimation(): void {
    if (this.animation === null) return;
    cancelAnimationFrame(this.animation);
    this.animation = null;
    this.renderer.endGesture();
  }
}
