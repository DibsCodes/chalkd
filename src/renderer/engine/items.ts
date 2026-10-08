import type {
  Bounds,
  ImageItem,
  Item,
  StrokeItem,
  StrokeStyle,
} from '../../shared/types';

export type {
  Bounds,
  ImageItem,
  Item,
  StrokeItem,
  StrokeKind,
  StrokeStyle,
} from '../../shared/types';

/** Layers draw bottom to top: images, highlighters, pen ink. */
export function layerRank(item: Item): number {
  if (item.type === 'image') return 0;
  return item.kind === 'highlighter' ? 1 : 2;
}

export function compareRenderOrder(a: Item, b: Item): number {
  return layerRank(a) - layerRank(b) || a.z - b.z;
}

export function isStroke(item: Item): item is StrokeItem {
  return item.type === 'stroke';
}

/** Build a stroke from flat world-space x,y pairs. */
export function createStroke(
  worldPoints: readonly number[],
  style: StrokeStyle,
  z: number,
): StrokeItem {
  const ox = worldPoints[0];
  const oy = worldPoints[1];
  const points = new Float32Array(worldPoints.length);
  for (let i = 0; i < worldPoints.length; i += 2) {
    points[i] = worldPoints[i] - ox;
    points[i + 1] = worldPoints[i + 1] - oy;
  }
  return withStrokeBounds({
    id: crypto.randomUUID(),
    type: 'stroke',
    ...style,
    z,
    origin: { x: ox, y: oy },
    points,
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  });
}

export function createImage(
  asset: string,
  x: number,
  y: number,
  w: number,
  h: number,
  z: number,
): ImageItem {
  return {
    id: crypto.randomUUID(),
    type: 'image',
    z,
    asset,
    x,
    y,
    w,
    h,
    bounds: { minX: x, minY: y, maxX: x + w, maxY: y + h },
  };
}

/** Recompute a stroke's bounds: its points, padded by half the ink width. */
function withStrokeBounds(item: StrokeItem): StrokeItem {
  const p = item.points;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < p.length; i += 2) {
    if (p[i] < minX) minX = p[i];
    if (p[i + 1] < minY) minY = p[i + 1];
    if (p[i] > maxX) maxX = p[i];
    if (p[i + 1] > maxY) maxY = p[i + 1];
  }
  const r = item.width / 2;
  const { x, y } = item.origin;
  item.bounds = {
    minX: x + minX - r,
    minY: y + minY - r,
    maxX: x + maxX + r,
    maxY: y + maxY + r,
  };
  return item;
}

/** Uniform scale `s` about (ox, oy), then a shift by (dx, dy). */
export interface Transform {
  dx: number;
  dy: number;
  s: number;
  ox: number;
  oy: number;
}

export const IDENTITY: Transform = { dx: 0, dy: 0, s: 1, ox: 0, oy: 0 };

export function isIdentity(t: Transform): boolean {
  return t.dx === 0 && t.dy === 0 && t.s === 1;
}

export function applyTransform(t: Transform, x: number, y: number) {
  return {
    x: (x - t.ox) * t.s + t.ox + t.dx,
    y: (y - t.oy) * t.s + t.oy + t.dy,
  };
}

/** A moved/scaled copy with the same id (so it replaces the original). */
export function transformItem(item: Item, t: Transform): Item {
  if (item.type === 'image') {
    const p = applyTransform(t, item.x, item.y);
    const w = item.w * t.s;
    const h = item.h * t.s;
    return {
      ...item,
      x: p.x,
      y: p.y,
      w,
      h,
      bounds: { minX: p.x, minY: p.y, maxX: p.x + w, maxY: p.y + h },
    };
  }
  const origin = applyTransform(t, item.origin.x, item.origin.y);
  const points = new Float32Array(item.points.length);
  for (let i = 0; i < points.length; i++) points[i] = item.points[i] * t.s;
  return withStrokeBounds({ ...item, origin, points, width: item.width * t.s });
}

export function unionBounds(a: Bounds | null, b: Bounds): Bounds {
  if (!a) return { ...b };
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export function boundsOf(items: Item[]): Bounds | null {
  let b: Bounds | null = null;
  for (const item of items) b = unionBounds(b, item.bounds);
  return b;
}
