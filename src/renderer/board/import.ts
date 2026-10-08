import type { AssetData, ImportFile } from '../../shared/types';
import type { Editor } from '../engine/editor';
import { boundsOf, createImage, type ImageItem } from '../engine/items';

/** Longest side kept for imported photos; bigger ones are scaled down. */
const MAX_IMAGE_PX = 3000;
/** PDF pages are rendered at this many pixels per board unit (sharp at 200%). */
const PDF_SCALE = 2;
/** 1 PDF point = 1/72 inch; 1 board unit = 1 CSS pixel = 1/96 inch. */
const PT_TO_UNITS = 96 / 72;
const GAP = 40;
/** New pictures fill at most this much of the view. */
const IMAGE_FIT = 0.6;

export const IMPORTABLE =
  /^(image\/(png|jpeg|gif|webp|bmp|svg\+xml|avif)|application\/pdf)$/;

interface Prepared {
  asset: AssetData;
  /** Natural size in board units. */
  width: number;
  height: number;
  /** PDF pages keep their real size; pictures are fitted to the view. */
  fitToView: boolean;
}

/**
 * Put images and PDF pages on the board, stacked top to bottom from the
 * middle of the view, as one undoable step. Returns how many were placed.
 */
export async function importFiles(
  editor: Editor,
  files: ImportFile[],
  onProgress?: (message: string) => void,
): Promise<number> {
  const prepared: Prepared[] = [];
  for (const file of files) {
    if (file.mime === 'application/pdf') {
      prepared.push(...(await renderPdf(file, onProgress)));
    } else if (IMPORTABLE.test(file.mime)) {
      prepared.push(await prepareImage(file));
    }
  }
  if (!prepared.length) return 0;

  const view = editor.renderer.viewBounds();
  const viewW = view.maxX - view.minX;
  const viewH = view.maxY - view.minY;
  const centerX = (view.minX + view.maxX) / 2;
  let y: number | null = null;
  const items: ImageItem[] = [];
  for (const p of prepared) {
    const fit = p.fitToView
      ? Math.min(
          1,
          (viewW * IMAGE_FIT) / p.width,
          (viewH * IMAGE_FIT) / p.height,
        )
      : 1;
    const w = p.width * fit;
    const h = p.height * fit;
    // The first item is centered in the view; the rest follow below it.
    y ??= (view.minY + view.maxY) / 2 - h / 2;
    editor.assets.add(p.asset);
    items.push(
      createImage(
        p.asset.hash,
        centerX - w / 2,
        y,
        w,
        h,
        editor.scene.allocZ(),
      ),
    );
    y += h + GAP;
  }
  editor.history.commit({ added: items, removed: [] });

  // If it all doesn't fit on screen (a long PDF), bring the first one into view.
  const all = boundsOf(items)!;
  const fits =
    all.minX >= view.minX &&
    all.maxX <= view.maxX &&
    all.minY >= view.minY &&
    all.maxY <= view.maxY;
  if (!fits) editor.fitBounds(items[0].bounds);
  return items.length;
}

async function prepareImage(file: ImportFile): Promise<Prepared> {
  const blob = new Blob([file.bytes as BlobPart], { type: file.mime });
  if (file.mime === 'image/svg+xml') return rasterizeSvg(blob);

  const bitmap = await createImageBitmap(blob);
  const { width, height } = bitmap;
  const long = Math.max(width, height);
  if (long <= MAX_IMAGE_PX && file.mime !== 'image/bmp') {
    bitmap.close();
    return {
      asset: await asset(file.bytes, file.mime),
      width,
      height,
      fitToView: true,
    };
  }
  // Too big (or BMP, which is huge on disk): scale down and re-encode.
  const scale = Math.min(1, MAX_IMAGE_PX / long);
  const canvas = new OffscreenCanvas(
    Math.round(width * scale),
    Math.round(height * scale),
  );
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const out = await canvas.convertToBlob({ type: 'image/webp', quality: 0.92 });
  return {
    asset: await asset(new Uint8Array(await out.arrayBuffer()), 'image/webp'),
    width: canvas.width,
    height: canvas.height,
    fitToView: true,
  };
}

/** SVGs become ordinary pictures, rendered at 2× for sharpness. */
async function rasterizeSvg(blob: Blob): Promise<Prepared> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const width = img.naturalWidth || 800;
    const height = img.naturalHeight || 600;
    const canvas = new OffscreenCanvas(width * 2, height * 2);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const out = await canvas.convertToBlob({ type: 'image/png' });
    return {
      asset: await asset(new Uint8Array(await out.arrayBuffer()), 'image/png'),
      width,
      height,
      fitToView: true,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function renderPdf(
  file: ImportFile,
  onProgress?: (message: string) => void,
): Promise<Prepared[]> {
  // pdf.js is large; load it only when a PDF actually shows up.
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdfjs.getDocument({
    data: file.bytes.slice(), // pdf.js takes ownership of the buffer
    cMapUrl: './pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: './pdfjs/standard_fonts/',
    wasmUrl: './pdfjs/wasm/',
  });
  const doc = await task.promise;

  try {
    const pages: Prepared[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      if (doc.numPages > 1)
        onProgress?.(`Importing page ${n} of ${doc.numPages}…`);
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: PT_TO_UNITS * PDF_SCALE });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport }).promise;
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Page render failed'))),
          'image/webp',
          0.92,
        ),
      );
      page.cleanup();
      pages.push({
        asset: await asset(
          new Uint8Array(await blob.arrayBuffer()),
          'image/webp',
        ),
        width: viewport.width / PDF_SCALE,
        height: viewport.height / PDF_SCALE,
        fitToView: false,
      });
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

async function asset(bytes: Uint8Array, mime: string): Promise<AssetData> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  const hash = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return { hash, mime, bytes };
}
