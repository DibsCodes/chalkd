import type { Editor } from '../engine/editor';
import { createStroke } from '../engine/items';

/**
 * `npm run bench`: fills a board with handwriting-like scribbles, then times
 * full redraws and a simulated pinch. Results go to the terminal.
 */
export async function runBench(editor: Editor): Promise<void> {
  const log = (entry: unknown) => window.chalkd.dev.log(entry);
  const frame = () => new Promise<number>((r) => requestAnimationFrame(r));

  for (const count of [500, 2000, 6000]) {
    editor.history.clear();
    editor.scene.apply({ added: [], removed: editorItems(editor) });
    editor.scene.apply({ added: scribbles(editor, count), removed: [] });

    editor.fitContent();
    await wait(400);
    const fitRender = await timedRedraw(editor, frame);

    editor.zoomToActual();
    await wait(400);
    const actualRender = await timedRedraw(editor, frame);

    // Simulated two-finger pinch: zoom in and back out over ~2 s.
    const cam = editor.camera;
    const cx = editor.renderer.width / 2;
    const cy = editor.renderer.height / 2;
    const startZoom = cam.zoom;
    editor.gestureStart();
    const intervals: number[] = [];
    let last = await frame();
    for (let i = 0; i < 120; i++) {
      cam.zoomAt(
        cx,
        cy,
        startZoom * (1 + 1.5 * Math.sin((i / 120) * Math.PI)) * 0.4,
      );
      cam.panBy(2, 1);
      editor.cameraChanged();
      const t = await frame();
      intervals.push(t - last);
      last = t;
    }
    editor.gestureEnd();
    await frame();

    intervals.sort((a, b) => a - b);
    log({
      bench: count,
      fitAllRenderMs: round(fitRender),
      at100RenderMs: round(actualRender),
      pinchFrameMs: {
        p50: round(intervals[Math.floor(intervals.length * 0.5)]),
        p95: round(intervals[Math.floor(intervals.length * 0.95)]),
        max: round(intervals[intervals.length - 1]),
      },
    });
  }
  log({ benchDone: true });
}

function editorItems(editor: Editor) {
  const all = editor.scene.contentBounds();
  return all ? editor.scene.query(all) : [];
}

async function timedRedraw(
  editor: Editor,
  frame: () => Promise<number>,
): Promise<number> {
  editor.renderer.invalidateContent();
  await frame();
  return editor.renderer.stats.contentMs;
}

/** Random-walk strokes that curve like handwriting, spread over the board. */
function scribbles(editor: Editor, count: number) {
  const items = [];
  const area = Math.sqrt(count) * 140;
  for (let s = 0; s < count; s++) {
    let x = (Math.random() - 0.5) * area;
    let y = (Math.random() - 0.5) * area * 0.6;
    let angle = Math.random() * Math.PI * 2;
    const n = 40 + Math.floor(Math.random() * 160);
    const pts: number[] = [];
    for (let i = 0; i < n; i++) {
      angle += (Math.random() - 0.5) * 0.6;
      x += Math.cos(angle) * 3;
      y += Math.sin(angle) * 3;
      pts.push(x, y);
    }
    items.push(
      createStroke(
        pts,
        { kind: 'pen', color: '#1d2433', width: 3, opacity: 1 },
        editor.scene.allocZ(),
      ),
    );
  }
  return items;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const round = (n: number) => Math.round(n * 100) / 100;
