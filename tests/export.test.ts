import { describe, expect, it } from 'vitest';
import {
  contentArea,
  pdfHtml,
  tiling,
  type ExportSource,
} from '../src/renderer/board/export';
import { AssetStore } from '../src/renderer/engine/assets';
import { createImage, createStroke } from '../src/renderer/engine/items';
import { DEFAULT_SETTINGS, type ExportOptions } from '../src/shared/types';

const pen = { kind: 'pen' as const, color: '#1d2433', width: 4, opacity: 1 };
const hl = {
  kind: 'highlighter' as const,
  color: '#ffd400',
  width: 20,
  opacity: 0.4,
};
const opts = (o: Partial<ExportOptions> = {}): ExportOptions => ({
  ...DEFAULT_SETTINGS.export,
  ...o,
});

function source(): ExportSource {
  const assets = new AssetStore();
  assets.add({
    hash: 'pic',
    mime: 'image/png',
    bytes: new Uint8Array([137, 80, 78, 71]),
  });
  return {
    name: 'Lesson',
    assets,
    background: { color: '#1f3d34', pattern: 'grid', spacing: 40 },
    items: [
      createStroke([0, 0, 50, 10, 100, 0], pen, 3),
      createStroke([10, 50], pen, 4), // a dot
      createStroke([0, 20, 100, 20], hl, 2),
      createImage('pic', 200, 0, 100, 80, 1),
    ],
  };
}

describe('contentArea', () => {
  it('pads the content and is null for an empty board', () => {
    expect(contentArea([])).toBeNull();
    const a = contentArea(source().items)!;
    expect(a.minX).toBeLessThan(-2);
    expect(a.maxX).toBeGreaterThan(300);
  });
});

describe('tiling', () => {
  const area = (w: number, h: number) => ({
    minX: 0,
    minY: 0,
    maxX: w,
    maxY: h,
  });
  it('fits small content on one portrait page', () => {
    expect(tiling(area(500, 500), 'letter')).toMatchObject({
      pages: 1,
      landscape: false,
    });
  });
  it('turns the paper when that saves pages', () => {
    // Letter content area: 720×960 portrait, 960×720 landscape.
    expect(tiling(area(1800, 600), 'letter')).toMatchObject({
      pages: 2,
      landscape: true,
    });
  });
  it('A4 is taller than Letter', () => {
    // 1000 tall: Letter (960 of content per page) needs two; A4 (1026) one.
    expect(tiling(area(600, 1000), 'letter').pages).toBe(2);
    expect(tiling(area(600, 1000), 'a4').pages).toBe(1);
  });
});

describe('pdfHtml', () => {
  it('one page: sized to the content, with vector ink, dots, highlighter, and pictures', () => {
    const src = source();
    const area = contentArea(src.items)!;
    const html = pdfHtml(src, area, opts({ layout: 'fit' }));
    const w = area.maxX - area.minX;
    expect(html).toContain(`@page { size: ${Math.round(w * 100) / 100}px`);
    expect(html.match(/stroke-linecap="round"/g)).toHaveLength(2); // pen + highlighter
    expect(html).toContain('<circle'); // the dot
    expect(html).toContain('opacity="0.4"'); // whole-path highlighter opacity
    expect(html).toContain('href="data:image/png;base64,iVBORw=="');
    expect(html).toContain('fill="url(#bg-pattern)"');
    expect(html).toContain('fill="#1f3d34"');
    // Highlighter drawn before (underneath) pen ink; picture before both.
    expect(html.indexOf('<image')).toBeLessThan(html.indexOf('opacity="0.4"'));
    expect(html.indexOf('opacity="0.4"')).toBeLessThan(
      html.indexOf('stroke="#1d2433"'),
    );
  });

  it('background off gives plain white and no pattern', () => {
    const src = source();
    const html = pdfHtml(
      src,
      contentArea(src.items)!,
      opts({ background: false }),
    );
    expect(html).not.toContain('#1f3d34');
    expect(html).not.toContain('bg-pattern');
    expect(html).toContain('fill="#ffffff"');
  });

  it('printable pages: one window onto the board per page', () => {
    const src = source();
    const area = { minX: 0, minY: 0, maxX: 1800, maxY: 600 };
    const html = pdfHtml(src, area, opts({ layout: 'pages', paper: 'letter' }));
    expect(html).toContain('size: letter landscape');
    expect(html.match(/class="page"/g)).toHaveLength(2);
    expect(html.match(/<use href="#board"\/>/g)).toHaveLength(2);
    // The board itself (and its picture) is included only once.
    expect(html.match(/<image/g)).toHaveLength(1);
  });

  it('shrinks a giant one-page export to PDF’s 200-inch limit', () => {
    const src = source();
    const html = pdfHtml(
      src,
      { minX: 0, minY: 0, maxX: 40000, maxY: 1000 },
      opts({ layout: 'fit' }),
    );
    expect(html).toContain('size: 19200px 480px');
  });
});
