import { getStroke, type StrokeOptions } from 'perfect-freehand';
import type { StrokeItem } from './items';

/** Uniform-width ink with smoothing (PLAN.md › Ink). */
const INK: StrokeOptions = {
  thinning: 0,
  smoothing: 0.5,
  streamline: 0.45,
  simulatePressure: false,
};

/**
 * Outline of a stroke as a fillable path, in the stroke's local coordinates.
 * `points` are flat x,y pairs.
 */
export function inkPath(
  points: ArrayLike<number>,
  width: number,
  complete: boolean,
): Path2D {
  const dot = dotCenter(points, width);
  if (dot) {
    const path = new Path2D();
    path.arc(dot[0], dot[1], width / 2, 0, Math.PI * 2);
    return path;
  }
  const input: [number, number][] = [];
  for (let i = 0; i < points.length; i += 2)
    input.push([points[i], points[i + 1]]);
  const outline = getStroke(input, { ...INK, size: width, last: complete });
  return new Path2D(svgPath(outline));
}

/**
 * A tap (or a stroke that never left a tiny circle) should be a round dot —
 * periods and decimal points matter. Returns its center, or null.
 */
function dotCenter(
  points: ArrayLike<number>,
  width: number,
): [number, number] | null {
  const limit = Math.max(1, width * 0.35);
  const x0 = points[0];
  const y0 = points[1];
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < points.length; i += 2) {
    if (
      Math.abs(points[i] - x0) > limit ||
      Math.abs(points[i + 1] - y0) > limit
    ) {
      return null;
    }
    sx += points[i];
    sy += points[i + 1];
  }
  const n = points.length / 2;
  return [sx / n, sy / n];
}

function svgPath(outline: number[][]): string {
  const n = outline.length;
  if (n === 0) return '';
  const parts: (string | number)[] = ['M', outline[0][0], outline[0][1], 'Q'];
  for (let i = 0; i < n; i++) {
    const [x0, y0] = outline[i];
    const [x1, y1] = outline[(i + 1) % n];
    parts.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  parts.push('Z');
  return parts.join(' ');
}

const pathCache = new WeakMap<StrokeItem, Path2D>();

/** Cached outline for a finished stroke. */
export function strokePath(item: StrokeItem): Path2D {
  let path = pathCache.get(item);
  if (!path) {
    path = inkPath(item.points, item.width, true);
    pathCache.set(item, path);
  }
  return path;
}

export function drawStroke(
  ctx: CanvasRenderingContext2D,
  item: StrokeItem,
): void {
  ctx.save();
  ctx.translate(item.origin.x, item.origin.y);
  ctx.globalAlpha = item.opacity;
  ctx.fillStyle = item.color;
  ctx.fill(strokePath(item));
  ctx.restore();
}
