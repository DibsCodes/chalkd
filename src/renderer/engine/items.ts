import type { Point } from './camera';

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type StrokeKind = 'pen' | 'highlighter';

export interface StrokeStyle {
  kind: StrokeKind;
  color: string;
  width: number;
  opacity: number;
}

export interface StrokeItem extends StrokeStyle {
  id: string;
  type: 'stroke';
  /** Stacking order within the item's layer; higher draws on top. */
  z: number;
  /** World position that `points` are relative to. */
  origin: Point;
  /** Flat x,y pairs relative to `origin`. */
  points: Float32Array;
  bounds: Bounds;
}

export type Item = StrokeItem;

/** Layers draw bottom to top: images (later), highlighters, pen ink. */
export function layerRank(item: Item): number {
  return item.kind === 'highlighter' ? 1 : 2;
}

export function compareRenderOrder(a: Item, b: Item): number {
  return layerRank(a) - layerRank(b) || a.z - b.z;
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
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < worldPoints.length; i += 2) {
    const x = worldPoints[i];
    const y = worldPoints[i + 1];
    points[i] = x - ox;
    points[i + 1] = y - oy;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const r = style.width / 2;
  return {
    id: crypto.randomUUID(),
    type: 'stroke',
    ...style,
    z,
    origin: { x: ox, y: oy },
    points,
    bounds: { minX: minX - r, minY: minY - r, maxX: maxX + r, maxY: maxY + r },
  };
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
