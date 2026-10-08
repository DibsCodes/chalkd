import type { Point } from '../camera';
import { Smoother } from '../geometry';
import { inkShape, paintInk } from '../ink';
import { createStroke, type StrokeStyle } from '../items';
import type { Tool, ToolContext } from './tool';

/** Draws pen and highlighter strokes; the style decides which. */
export class PenTool implements Tool {
  private points: number[] = [];
  private smoother: Smoother | null = null;
  private last: Point | null = null;

  constructor(
    private ctx: ToolContext,
    readonly style: StrokeStyle,
    private smoothing: number,
  ) {}

  down(p: Point): void {
    this.smoother = new Smoother(this.smoothing);
    this.points = [];
    this.add(p);
    const { color, width, opacity } = this.style;
    this.ctx.renderer.setLive((g) => {
      if (this.points.length)
        paintInk(g, inkShape(this.points, width), color, width, opacity);
    });
  }

  move(points: Point[]): void {
    if (!this.smoother) return;
    for (const p of points) this.add(p);
    this.ctx.renderer.invalidateLive();
  }

  up(): void {
    if (!this.smoother) return;
    // Smoothing trails the finger slightly; finish exactly where it lifted.
    const last = this.last!;
    const n = this.points.length;
    if (
      n >= 2 &&
      (this.points[n - 2] !== last.x || this.points[n - 1] !== last.y)
    ) {
      this.points.push(last.x, last.y);
    }
    const { scene, history } = this.ctx;
    history.commit({
      added: [createStroke(this.points, { ...this.style }, scene.allocZ())],
      removed: [],
    });
    this.finish();
  }

  cancel(): void {
    this.finish();
  }

  private add(p: Point): void {
    this.last = p;
    const s = this.smoother!.push(p);
    if (s) this.points.push(s.x, s.y);
  }

  private finish(): void {
    this.points = [];
    this.smoother = null;
    this.last = null;
    this.ctx.renderer.setLive(null);
  }
}
