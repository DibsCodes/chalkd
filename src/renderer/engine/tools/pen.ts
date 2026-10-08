import type { Point } from '../camera';
import { inkPath } from '../ink';
import { createStroke, type StrokeStyle } from '../items';
import type { Tool, ToolContext } from './tool';

/** Draws pen and highlighter strokes; the style decides which. */
export class PenTool implements Tool {
  private points: number[] = [];
  private path: Path2D | null = null;

  constructor(
    private ctx: ToolContext,
    public style: StrokeStyle,
  ) {}

  down(p: Point): void {
    this.points = [p.x, p.y];
    this.update();
    const style = this.style;
    this.ctx.renderer.setLive((g) => {
      if (!this.path) return;
      g.globalAlpha = style.opacity;
      g.fillStyle = style.color;
      g.fill(this.path);
    });
  }

  move(points: Point[]): void {
    if (!this.points.length) return;
    for (const p of points) this.points.push(p.x, p.y);
    this.update();
  }

  up(): void {
    if (this.points.length) {
      const { scene, history } = this.ctx;
      const item = createStroke(this.points, { ...this.style }, scene.allocZ());
      history.commit({ added: [item], removed: [] });
    }
    this.finish();
  }

  cancel(): void {
    this.finish();
  }

  private update(): void {
    this.path = inkPath(this.points, this.style.width, false);
    this.ctx.renderer.invalidateLive();
  }

  private finish(): void {
    this.points = [];
    this.path = null;
    this.ctx.renderer.setLive(null);
  }
}
