import type { EraserSettings } from '../../../shared/types';
import type { Point } from '../camera';
import { cutPolyline, polylineHits } from '../geometry';
import { createStroke, isStroke, type Item } from '../items';
import type { Tool, ToolContext } from './tool';

/**
 * Partial mode rubs out exactly what the finger passes over, splitting
 * strokes; stroke mode removes any stroke it touches. The board updates
 * live, and the whole gesture becomes one undo step.
 */
export class EraserTool implements Tool {
  private prev: Point | null = null;
  private cursor: Point | null = null;
  /** Items that existed before this gesture and are now gone. */
  private removed = new Map<string, Item>();
  /** Pieces created during this gesture that are still on the board. */
  private added = new Map<string, Item>();

  constructor(
    private ctx: ToolContext,
    readonly settings: EraserSettings,
  ) {}

  down(p: Point): void {
    this.prev = p;
    this.removed.clear();
    this.added.clear();
    this.ctx.renderer.setLive((g) => this.drawCursor(g));
    this.eraseAlong(p, p);
  }

  move(points: Point[]): void {
    if (!this.prev) return;
    for (const p of points) {
      this.eraseAlong(this.prev, p);
      this.prev = p;
    }
  }

  up(): void {
    if (!this.prev) return;
    this.ctx.history.record({
      added: [...this.added.values()],
      removed: [...this.removed.values()],
    });
    this.finish();
  }

  cancel(): void {
    if (!this.prev) return;
    // Put the board back exactly as it was.
    this.ctx.scene.apply({
      added: [...this.removed.values()],
      removed: [...this.added.values()],
    });
    this.finish();
  }

  private eraseAlong(a: Point, b: Point): void {
    const { scene, camera, renderer } = this.ctx;
    this.cursor = b;
    renderer.invalidateLive();

    const r = this.settings.size / 2 / camera.zoom;
    const area = {
      minX: Math.min(a.x, b.x) - r,
      minY: Math.min(a.y, b.y) - r,
      maxX: Math.max(a.x, b.x) + r,
      maxY: Math.max(a.y, b.y) + r,
    };
    const gone: Item[] = [];
    const pieces: Item[] = [];
    // Images are only removed with Select (PLAN.md › Tools › Eraser).
    for (const item of scene.query(area).filter(isStroke)) {
      // Measure from the ink's edge, not its centerline.
      const reach = r + item.width / 2;
      const ax = a.x - item.origin.x;
      const ay = a.y - item.origin.y;
      const bx = b.x - item.origin.x;
      const by = b.y - item.origin.y;
      if (this.settings.mode === 'stroke') {
        if (polylineHits(item.points, ax, ay, bx, by, reach)) gone.push(item);
        continue;
      }
      const runs = cutPolyline(item.points, ax, ay, bx, by, reach);
      if (!runs) continue;
      gone.push(item);
      const { kind, color, width, opacity } = item;
      for (const run of runs) {
        const world = run.map(
          (v, i) => v + (i % 2 ? item.origin.y : item.origin.x),
        );
        pieces.push(
          createStroke(world, { kind, color, width, opacity }, item.z),
        );
      }
    }
    if (!gone.length) return;

    for (const item of gone) {
      if (this.added.has(item.id)) this.added.delete(item.id);
      else this.removed.set(item.id, item);
    }
    for (const piece of pieces) this.added.set(piece.id, piece);
    scene.apply({ added: pieces, removed: gone });
  }

  private drawCursor(g: CanvasRenderingContext2D): void {
    if (!this.cursor) return;
    const zoom = this.ctx.camera.zoom;
    g.beginPath();
    g.arc(
      this.cursor.x,
      this.cursor.y,
      this.settings.size / 2 / zoom,
      0,
      Math.PI * 2,
    );
    g.lineWidth = 1.5 / zoom;
    g.strokeStyle = 'rgba(40, 48, 64, 0.55)';
    g.fillStyle = 'rgba(255, 255, 255, 0.35)';
    g.fill();
    g.stroke();
  }

  private finish(): void {
    this.prev = null;
    this.cursor = null;
    this.removed.clear();
    this.added.clear();
    this.ctx.renderer.setLive(null);
  }
}
