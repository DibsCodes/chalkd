import type { Bounds, Item, StrokeItem, StrokeStyle } from '../../shared/types';

export type {
  Bounds,
  Item,
  StrokeItem,
  StrokeKind,
  StrokeStyle,
} from '../../shared/types';

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
