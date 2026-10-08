import type { EraserSettings } from '../../../shared/types';
import type { Point } from '../camera';
import {
  cutPolyline,
  findLoop,
  mostlyInside,
  pointInPolygon,
  polylineHits,
} from '../geometry';
import { createStroke, isStroke, type Item, type StrokeItem } from '../items';
import type { Tool, ToolContext } from './tool';

/** A loop's ends must come this close to count as closed (screen px). */
const LOOP_CLOSE_PX = 40;
/** A loop must be at least this wide and tall (screen px). */
const LOOP_MIN_PX = 60;
/** A finger that moves less than this is tapping, not erasing (screen px). */
const TAP_SLOP_PX = 10;
/** How long a loop waits for its tap. */
const LOOP_WAIT_MS = 6000;
const LOOP_COLOR = 'rgba(214, 51, 64, 0.9)';
const LOOP_FILL = 'rgba(214, 51, 64, 0.08)';

/**
 * Partial mode rubs out exactly what the finger passes over, splitting
 * strokes; stroke mode removes any stroke it touches. The board updates
 * live, and the whole gesture becomes one undo step.
 *
 * Drawing a loop around ink outlines it; tapping inside the loop then
 * erases every stroke it encloses, also as one undo step.
 */
export class EraserTool implements Tool {
  private prev: Point | null = null;
  /** The path of the current gesture, flat x,y pairs. */
  private path: number[] = [];
  /** A finger came down inside the loop and hasn't moved yet. */
  private tapStart: Point | null = null;
  /** A closed loop waiting for a tap inside it. */
  private loop: number[] | null = null;
  private loopTimer: ReturnType<typeof setTimeout> | null = null;
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
    this.removed.clear();
    this.added.clear();
    if (this.loop && pointInPolygon(p.x, p.y, this.loop)) {
      // Maybe the tap that erases the loop; wait and see if it moves.
      this.tapStart = p;
      this.stopLoopTimer();
      return;
    }
    this.clearLoop();
    this.startErasing(p);
  }

  move(points: Point[]): void {
    if (this.tapStart) {
      const last = points[points.length - 1];
      if (!last) return;
      const zoom = this.ctx.camera.zoom;
      const d = Math.hypot(last.x - this.tapStart.x, last.y - this.tapStart.y);
      if (d * zoom < TAP_SLOP_PX) return;
      // It's ordinary erasing after all.
      const start = this.tapStart;
      this.tapStart = null;
      this.clearLoop();
      this.startErasing(start);
    }
    if (!this.prev) return;
    for (const p of points) {
      this.eraseAlong(this.prev, p);
      this.path.push(p.x, p.y);
      this.prev = p;
    }
  }

  up(): void {
    if (this.tapStart) {
      this.tapStart = null;
      this.eraseLoop();
      return;
    }
    if (!this.prev) return;
    this.ctx.history.record({
      added: [...this.added.values()],
      removed: [...this.removed.values()],
    });
    const path = this.path;
    this.finish();
    this.armLoop(path);
  }

  cancel(): void {
    if (this.tapStart) {
      // A second finger: pan or zoom, so the loop keeps waiting.
      this.tapStart = null;
      this.startLoopTimer();
      this.ctx.renderer.invalidateLive();
      return;
    }
    if (!this.prev) return;
    // Put the board back exactly as it was.
    this.ctx.scene.apply({
      added: [...this.removed.values()],
      removed: [...this.added.values()],
    });
    this.finish();
  }

  dispose(): void {
    this.clearLoop();
    this.ctx.renderer.setLive(null);
  }

  /** Whether a loop is waiting for its tap. */
  get armed(): boolean {
    return this.loop !== null;
  }

  private startErasing(p: Point): void {
    this.ctx.renderer.setLive((g) => this.drawLive(g));
    this.prev = p;
    this.path = [p.x, p.y];
    this.eraseAlong(p, p);
  }

  /** Strokes enclosed by a loop. */
  private enclosed(loop: number[]): StrokeItem[] {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < loop.length; i += 2) {
      minX = Math.min(minX, loop[i]);
      maxX = Math.max(maxX, loop[i]);
      minY = Math.min(minY, loop[i + 1]);
      maxY = Math.max(maxY, loop[i + 1]);
    }
    // Images are only removed with Select (PLAN.md › Tools › Eraser).
    return this.ctx.scene
      .query({ minX, minY, maxX, maxY })
      .filter(isStroke)
      .filter((item) => mostlyInside(item.points, item.origin, loop));
  }

  /** Outline the gesture's loop, if it made one around some ink. */
  private armLoop(path: number[]): void {
    const zoom = this.ctx.camera.zoom;
    const loop = findLoop(path, LOOP_CLOSE_PX / zoom, LOOP_MIN_PX / zoom);
    if (!loop || !this.enclosed(loop).length) return;
    this.loop = loop;
    this.ctx.renderer.setLive((g) => this.drawLive(g));
    this.startLoopTimer();
  }

  private eraseLoop(): void {
    const loop = this.loop!;
    this.clearLoop();
    this.ctx.history.commit({ added: [], removed: this.enclosed(loop) });
  }

  private clearLoop(): void {
    this.stopLoopTimer();
    if (!this.loop) return;
    this.loop = null;
    if (this.prev || this.tapStart) this.ctx.renderer.invalidateLive();
    else this.ctx.renderer.setLive(null);
  }

  private startLoopTimer(): void {
    this.stopLoopTimer();
    this.loopTimer = setTimeout(() => this.clearLoop(), LOOP_WAIT_MS);
  }

  private stopLoopTimer(): void {
    if (this.loopTimer) clearTimeout(this.loopTimer);
    this.loopTimer = null;
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

  private drawLive(g: CanvasRenderingContext2D): void {
    const zoom = this.ctx.camera.zoom;
    if (this.loop) {
      const loop = this.loop;
      g.save();
      g.beginPath();
      g.moveTo(loop[0], loop[1]);
      for (let i = 2; i < loop.length; i += 2) g.lineTo(loop[i], loop[i + 1]);
      g.closePath();
      g.fillStyle = LOOP_FILL;
      g.fill();
      g.setLineDash([8 / zoom, 6 / zoom]);
      g.lineWidth = 2 / zoom;
      g.strokeStyle = LOOP_COLOR;
      g.stroke();
      g.restore();
    }
    if (!this.cursor) return;
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
    this.path = [];
    this.removed.clear();
    this.added.clear();
    if (this.loop) this.ctx.renderer.invalidateLive();
    else this.ctx.renderer.setLive(null);
  }
}
