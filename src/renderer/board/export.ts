import type {
  Background,
  Bounds,
  ExportOptions,
  Item,
} from '../../shared/types';
import { AssetStore } from '../engine/assets';
import { drawPattern, patternInk } from '../engine/background';
import { drawItem } from '../engine/draw';
import { boundsOf, compareRenderOrder, type StrokeItem } from '../engine/items';

/** Everything needed to draw a board, whether or not it's the open one. */
export interface ExportSource {
  name: string;
  items: Item[];
  assets: AssetStore;
  background: Background;
}

/** Breathing room around the content, in board units. */
const MARGIN = 40;
/** PNG pixels per board unit (sharp on hi-dpi screens and projectors). */
const PNG_SCALE = 2;
/** Chromium's canvas limits. */
const MAX_CANVAS_SIDE = 16384;
const MAX_CANVAS_AREA = 200_000_000;
/** PDF pages can't be bigger than 200 inches; 1 board unit = 1/96 inch. */
const MAX_PDF_SIDE = 200 * 96;
const PAPER = {
  letter: { w: 8.5 * 96, h: 11 * 96, css: 'letter' },
  a4: { w: (210 / 25.4) * 96, h: (297 / 25.4) * 96, css: 'A4' },
};
const PAGE_MARGIN = 0.5 * 96;

export function contentArea(items: Item[]): Bounds | null {
  const b = boundsOf(items);
  if (!b) return null;
  return {
    minX: b.minX - MARGIN,
    minY: b.minY - MARGIN,
    maxX: b.maxX + MARGIN,
    maxY: b.maxY + MARGIN,
  };
}

// ---------- PNG ----------

/** Render `area` to a PNG at 2× (less if the board is enormous). */
export async function renderPng(
  src: ExportSource,
  area: Bounds,
  withBackground: boolean,
): Promise<Uint8Array> {
  const w = area.maxX - area.minX;
  const h = area.maxY - area.minY;
  const scale = Math.min(
    PNG_SCALE,
    MAX_CANVAS_SIDE / w,
    MAX_CANVAS_SIDE / h,
    Math.sqrt(MAX_CANVAS_AREA / (w * h)),
  );
  const canvas = new OffscreenCanvas(
    Math.max(1, Math.round(w * scale)),
    Math.max(1, Math.round(h * scale)),
  );
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = withBackground ? src.background.color : '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale, 0, 0, scale, -area.minX * scale, -area.minY * scale);
  if (withBackground) drawPattern(ctx, src.background, area, 1);

  const items = visible(src.items, area);
  await src.assets.decode(
    items.flatMap((i) => (i.type === 'image' ? [i.asset] : [])),
  );
  for (const item of items) {
    drawItem(ctx as unknown as CanvasRenderingContext2D, item, src.assets);
  }
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await blob.arrayBuffer());
}

// ---------- PDF (as printable HTML) ----------

/**
 * A self-contained HTML page that Chromium prints to PDF. The board is
 * drawn once as SVG, so ink stays vector-sharp; printable pages each show a
 * window onto it.
 */
export function pdfHtml(
  src: ExportSource,
  area: Bounds,
  opts: ExportOptions,
): string {
  const board = boardSvg(src, area, opts.background);
  const w = area.maxX - area.minX;
  const h = area.maxY - area.minY;

  if (opts.layout === 'fit') {
    // One page the size of the content (shrunk if it's beyond what PDF allows).
    const k = Math.min(1, MAX_PDF_SIDE / w, MAX_PDF_SIDE / h);
    const pw = w * k;
    const ph = h * k;
    return page(
      `@page { size: ${n(pw)}px ${n(ph)}px; margin: 0 }`,
      `<svg width="${n(pw)}" height="${n(ph)}" viewBox="${n(area.minX)} ${n(area.minY)} ${n(w)} ${n(h)}">${board}</svg>`,
    );
  }

  const paper = PAPER[opts.paper];
  const t = tiling(area, opts.paper);
  const orientation = t.landscape ? 'landscape' : 'portrait';

  const pages: string[] = [];
  for (let r = 0; r < t.rows; r++) {
    for (let c = 0; c < t.cols; c++) {
      const x = area.minX + c * t.cw;
      const y = area.minY + r * t.ch;
      pages.push(
        `<div class="page"><svg width="${n(t.cw)}" height="${n(t.ch)}" viewBox="${n(x)} ${n(y)} ${n(t.cw)} ${n(t.ch)}"><use href="#board"/></svg></div>`,
      );
    }
  }
  return page(
    `@page { size: ${paper.css} ${orientation}; margin: 0 }
     .page { width: ${n(t.pw)}px; height: ${n(t.ph)}px; padding: ${PAGE_MARGIN}px; box-sizing: border-box; break-after: page; overflow: hidden }
     .page:last-child { break-after: auto }`,
    `<svg width="0" height="0" style="position:absolute"><defs><g id="board">${board}</g></defs></svg>${pages.join('')}`,
  );
}

/**
 * How real-size content splits across paper: portrait or landscape,
 * whichever needs fewer pages.
 */
export function tiling(area: Bounds, paperName: ExportOptions['paper']) {
  const paper = PAPER[paperName];
  const w = area.maxX - area.minX;
  const h = area.maxY - area.minY;
  const tiles = (pw: number, ph: number, landscape: boolean) => {
    const cw = pw - PAGE_MARGIN * 2;
    const ch = ph - PAGE_MARGIN * 2;
    const cols = Math.ceil(w / cw);
    const rows = Math.ceil(h / ch);
    return { pw, ph, cw, ch, cols, rows, pages: cols * rows, landscape };
  };
  const portrait = tiles(paper.w, paper.h, false);
  const landscape = tiles(paper.h, paper.w, true);
  return landscape.pages < portrait.pages ? landscape : portrait;
}

function page(css: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; padding: 0 }
    svg { display: block; overflow: hidden }
    ${css}
  </style></head><body>${body}</body></html>`;
}

/** The board as SVG markup in world coordinates, clipped to `area`'s items. */
function boardSvg(
  src: ExportSource,
  area: Bounds,
  withBackground: boolean,
): string {
  const out: string[] = [];
  const bg = src.background;
  const x = n(area.minX);
  const y = n(area.minY);
  const w = n(area.maxX - area.minX);
  const h = n(area.maxY - area.minY);
  out.push(
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${withBackground ? bg.color : '#ffffff'}"/>`,
  );
  if (withBackground && bg.pattern !== 'blank') {
    out.push(
      patternSvg(bg),
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#bg-pattern)"/>`,
    );
  }
  for (const item of visible(src.items, area)) {
    if (item.type === 'image') {
      const asset = src.assets.get(item.asset);
      if (!asset) continue;
      out.push(
        `<image x="${n(item.x)}" y="${n(item.y)}" width="${n(item.w)}" height="${n(item.h)}" preserveAspectRatio="none" href="data:${asset.mime};base64,${base64(asset.bytes)}"/>`,
      );
    } else {
      out.push(strokeSvg(item));
    }
  }
  return out.join('');
}

function patternSvg(bg: Background): string {
  // Shapes sit in the middle of each tile and the tiles are shifted by half
  // a tile, so lines and dots land on multiples of the spacing (as on
  // screen) without being clipped by the tile edges.
  const s = bg.spacing;
  const c = n(s / 2);
  const ink = patternInk(bg.color, bg.pattern);
  const shape =
    bg.pattern === 'dots'
      ? `<rect x="${n(s / 2 - 1.25)}" y="${n(s / 2 - 1.25)}" width="2.5" height="2.5" fill="${ink}"/>`
      : bg.pattern === 'grid'
        ? `<path d="M0 ${c}H${n(s)}M${c} 0V${n(s)}" stroke="${ink}" stroke-width="1" fill="none"/>`
        : `<path d="M0 ${c}H${n(s)}" stroke="${ink}" stroke-width="1" fill="none"/>`;
  return `<defs><pattern id="bg-pattern" patternUnits="userSpaceOnUse" x="${n(-s / 2)}" y="${n(-s / 2)}" width="${n(s)}" height="${n(s)}">${shape}</pattern></defs>`;
}

/** Same shape as on screen: round-capped line through midpoints, or a dot. */
function strokeSvg(item: StrokeItem): string {
  const p = item.points;
  const ox = item.origin.x;
  const oy = item.origin.y;
  const count = p.length / 2;
  // `opacity` (not stroke-opacity) so a highlighter's overlaps don't darken.
  const op = item.opacity < 1 ? ` opacity="${item.opacity}"` : '';
  const limit = Math.max(0.75, item.width * 0.25);
  let isDot = true;
  for (let i = 2; i < p.length && isDot; i += 2) {
    if (Math.abs(p[i] - p[0]) > limit || Math.abs(p[i + 1] - p[1]) > limit)
      isDot = false;
  }
  if (isDot) {
    return `<circle cx="${n(p[0] + ox)}" cy="${n(p[1] + oy)}" r="${n(item.width / 2)}" fill="${item.color}"${op}/>`;
  }
  const X = (i: number) => n(p[i * 2] + ox);
  const Y = (i: number) => n(p[i * 2 + 1] + oy);
  let d = `M${X(0)} ${Y(0)}`;
  if (count === 2) {
    d += `L${X(1)} ${Y(1)}`;
  } else {
    for (let i = 1; i < count - 1; i++) {
      const mx = (p[i * 2] + p[i * 2 + 2]) / 2 + ox;
      const my = (p[i * 2 + 1] + p[i * 2 + 3]) / 2 + oy;
      d += `Q${X(i)} ${Y(i)} ${n(mx)} ${n(my)}`;
    }
    d += `L${X(count - 1)} ${Y(count - 1)}`;
  }
  return `<path d="${d}" fill="none" stroke="${item.color}" stroke-width="${n(item.width)}" stroke-linecap="round" stroke-linejoin="round"${op}/>`;
}

function visible(items: Item[], area: Bounds): Item[] {
  return items
    .filter(
      (i) =>
        i.bounds.maxX >= area.minX &&
        i.bounds.minX <= area.maxX &&
        i.bounds.maxY >= area.minY &&
        i.bounds.minY <= area.maxY,
    )
    .sort(compareRenderOrder);
}

/** Compact number formatting for SVG. */
function n(v: number): string {
  return String(Math.round(v * 100) / 100);
}

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}
