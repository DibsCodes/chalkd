import type { Background, Bounds, Pattern } from '../../shared/types';

/**
 * Draw the board's pattern (dots, grid, or lines) over `view`, in world
 * coordinates; the caller has set the world transform and painted the color.
 * As you zoom out, the pattern coarsens so it never turns into mush.
 */
export function drawPattern(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  bg: Background,
  view: Bounds,
  zoom: number,
): void {
  const { color, pattern } = bg;
  if (pattern === 'blank') return;
  const spacing = patternSpacing(bg, zoom);
  const x0 = Math.floor(view.minX / spacing) * spacing;
  const y0 = Math.floor(view.minY / spacing) * spacing;
  const ink = patternInk(color, pattern);
  ctx.beginPath();

  if (pattern === 'dots') {
    const r = 1.25 / zoom;
    for (let y = y0; y <= view.maxY; y += spacing) {
      for (let x = x0; x <= view.maxX; x += spacing) {
        ctx.rect(x - r, y - r, r * 2, r * 2);
      }
    }
    ctx.fillStyle = ink;
    ctx.fill();
    return;
  }

  if (pattern === 'grid') {
    for (let x = x0; x <= view.maxX; x += spacing) {
      ctx.moveTo(x, view.minY);
      ctx.lineTo(x, view.maxY);
    }
  }
  for (let y = y0; y <= view.maxY; y += spacing) {
    ctx.moveTo(view.minX, y);
    ctx.lineTo(view.maxX, y);
  }
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1 / zoom;
  ctx.stroke();
}

/** Pattern spacing in world units at this zoom (coarser when zoomed out). */
export function patternSpacing(bg: Background, zoom: number): number {
  const minScreenGap = bg.pattern === 'dots' ? 16 : 10;
  let spacing = bg.spacing;
  while (spacing * zoom < minScreenGap) spacing *= 5;
  return spacing;
}

/** Subtle pattern color that works on both light and dark boards. */
export function patternInk(background: string, pattern: Pattern): string {
  const dark = luminance(background) < 0.4;
  if (pattern === 'dots')
    return dark ? 'rgba(255,255,255,0.28)' : 'rgba(30,45,70,0.26)';
  return dark ? 'rgba(255,255,255,0.12)' : 'rgba(30,45,70,0.11)';
}

function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 1;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
