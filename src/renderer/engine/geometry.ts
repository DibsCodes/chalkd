import type { Point } from './camera';

/** Squared distance from point p to segment ab. */
export function distSqToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  let t = len > 0 ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + t * dx - px;
  const cy = ay + t * dy - py;
  return cx * cx + cy * cy;
}

/** Squared distance between segments ab and cd. */
export function segmentDistSq(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): number {
  if (segmentsCross(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
  return Math.min(
    distSqToSegment(ax, ay, cx, cy, dx, dy),
    distSqToSegment(bx, by, cx, cy, dx, dy),
    distSqToSegment(cx, cy, ax, ay, bx, by),
    distSqToSegment(dx, dy, ax, ay, bx, by),
  );
}

function segmentsCross(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): boolean {
  const d1 = cross(cx, cy, dx, dy, ax, ay);
  const d2 = cross(cx, cy, dx, dy, bx, by);
  const d3 = cross(ax, ay, bx, by, cx, cy);
  const d4 = cross(ax, ay, bx, by, dx, dy);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function cross(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  px: number,
  py: number,
): number {
  return (bx - ax) * (py - ay) - (by - ay) * (px - ax);
}

/**
 * Exponential smoothing that takes the wobble out of finger strokes. Each
 * point moves only part-way toward the next raw sample. `strength` 0 = raw.
 */
export class Smoother {
  private factor: number;
  private last: Point | null = null;

  constructor(strength: number) {
    this.factor = 1 - 0.8 * Math.min(1, Math.max(0, strength));
  }

  /** Feed a raw sample; returns the smoothed point, or null if it barely moved. */
  push(p: Point): Point | null {
    const last = this.last;
    if (!last) {
      this.last = { x: p.x, y: p.y };
      return this.last;
    }
    const next = {
      x: last.x + (p.x - last.x) * this.factor,
      y: last.y + (p.y - last.y) * this.factor,
    };
    const dx = next.x - last.x;
    const dy = next.y - last.y;
    if (dx * dx + dy * dy < 0.25 * 0.25) return null;
    this.last = next;
    return next;
  }
}

/**
 * Remove the parts of a polyline (flat x,y pairs) within `radius` of the
 * eraser segment ab. Returns the surviving runs, or null if nothing was hit.
 * The line is resampled first so cuts land close to the eraser's edge.
 */
export function cutPolyline(
  pts: ArrayLike<number>,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  radius: number,
): number[][] | null {
  const step = Math.max(0.5, radius / 3);
  const r2 = radius * radius;
  const runs: number[][] = [];
  let run: number[] = [];
  let hit = false;

  const visit = (x: number, y: number) => {
    if (distSqToSegment(x, y, ax, ay, bx, by) <= r2) {
      hit = true;
      if (run.length) runs.push(run);
      run = [];
    } else {
      run.push(x, y);
    }
  };

  visit(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) {
    const x0 = pts[i - 2];
    const y0 = pts[i - 1];
    const x1 = pts[i];
    const y1 = pts[i + 1];
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step);
    // Only resample segments that come near the eraser; elsewhere keep the
    // original points so untouched ink is preserved exactly.
    const near =
      segmentDistSq(x0, y0, x1, y1, ax, ay, bx, by) <= (radius + step) ** 2;
    if (near && n > 1) {
      for (let k = 1; k <= n; k++) {
        visit(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n);
      }
    } else {
      visit(x1, y1);
    }
  }
  if (run.length) runs.push(run);
  return hit ? runs : null;
}

/** Does a polyline (flat x,y pairs) come within `radius` of segment ab? */
export function polylineHits(
  pts: ArrayLike<number>,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  radius: number,
): boolean {
  const r2 = radius * radius;
  if (pts.length === 2)
    return distSqToSegment(pts[0], pts[1], ax, ay, bx, by) <= r2;
  for (let i = 2; i < pts.length; i += 2) {
    if (
      segmentDistSq(
        pts[i - 2],
        pts[i - 1],
        pts[i],
        pts[i + 1],
        ax,
        ay,
        bx,
        by,
      ) <= r2
    ) {
      return true;
    }
  }
  return false;
}
