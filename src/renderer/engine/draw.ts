import type { AssetStore } from './assets';
import { drawStroke } from './ink';
import type { ImageItem, Item } from './items';

/** Draw any board item in world coordinates. */
export function drawItem(
  ctx: CanvasRenderingContext2D,
  item: Item,
  assets: AssetStore,
): void {
  if (item.type === 'stroke') drawStroke(ctx, item);
  else drawImageItem(ctx, item, assets);
}

function drawImageItem(
  ctx: CanvasRenderingContext2D,
  item: ImageItem,
  assets: AssetStore,
): void {
  const bitmap = assets.bitmap(item.asset);
  ctx.globalAlpha = 1;
  if (!bitmap) {
    // Still decoding (or unreadable): a soft placeholder of the right size.
    ctx.fillStyle = 'rgba(128, 140, 160, 0.15)';
    ctx.fillRect(item.x, item.y, item.w, item.h);
    return;
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, item.x, item.y, item.w, item.h);
}
