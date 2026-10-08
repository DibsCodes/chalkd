import type { StrokeItem } from './items';

/**
 * Uniform-width ink (PLAN.md › Ink): stored points are already smoothed, so
 * drawing is a round-capped line through their midpoints. Splitting a stroke
 * (partial erase) therefore never changes how the remaining pieces look.
 */
export interface InkShape {
  path: Path2D;
  /** A single point: filled as a round dot instead of stroked. */
  dot: boolean;
}

export function inkShape(points: ArrayLike<number>, width: number): InkShape {
  const path = new Path2D();
  const n = points.length / 2;
  if (n === 0) return { path, dot: true };
  if (isDot(points, width)) {
    path.arc(points[0], points[1], width / 2, 0, Math.PI * 2);
    return { path, dot: true };
  }
  path.moveTo(points[0], points[1]);
  if (n === 2) {
    path.lineTo(points[2], points[3]);
    return { path, dot: false };
  }
  for (let i = 1; i < n - 1; i++) {
    const x = points[i * 2];
    const y = points[i * 2 + 1];
    path.quadraticCurveTo(
      x,
      y,
      (x + points[i * 2 + 2]) / 2,
      (y + points[i * 2 + 3]) / 2,
    );
  }
  path.lineTo(points[(n - 1) * 2], points[(n - 1) * 2 + 1]);
  return { path, dot: false };
}

/**
 * A tap, or a stroke that never left a tiny circle, is a round dot —
 * periods and decimal points matter.
 */
function isDot(points: ArrayLike<number>, width: number): boolean {
  const limit = Math.max(0.75, width * 0.25);
  for (let i = 2; i < points.length; i += 2) {
    if (
      Math.abs(points[i] - points[0]) > limit ||
      Math.abs(points[i + 1] - points[1]) > limit
    ) {
      return false;
    }
  }
  return true;
}

export function paintInk(
  ctx: CanvasRenderingContext2D,
  shape: InkShape,
  color: string,
  width: number,
  opacity: number,
): void {
  ctx.globalAlpha = opacity;
  if (shape.dot) {
    ctx.fillStyle = color;
    ctx.fill(shape.path);
  } else {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // One stroke() call paints the whole path once, so a highlighter
    // crossing itself doesn't get darker where it overlaps.
    ctx.stroke(shape.path);
  }
}

const shapeCache = new WeakMap<StrokeItem, InkShape>();

export function drawStroke(
  ctx: CanvasRenderingContext2D,
  item: StrokeItem,
): void {
  let shape = shapeCache.get(item);
  if (!shape) {
    shape = inkShape(item.points, item.width);
    shapeCache.set(item, shape);
  }
  ctx.save();
  ctx.translate(item.origin.x, item.origin.y);
  paintInk(ctx, shape, item.color, item.width, item.opacity);
  ctx.restore();
}
