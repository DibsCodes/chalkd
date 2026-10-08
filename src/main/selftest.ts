import type { BrowserWindow } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * `CHALKD_SELFTEST=<dir> npm start`: drives the real input path with
 * synthetic mouse events and saves screenshots, so rendering can be checked
 * without someone at the screen. Quits when done.
 */
export async function runSelfTest(
  win: BrowserWindow,
  outDir: string,
): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const wc = win.webContents;
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const shot = async (name: string) => {
    await pause(150);
    const image = await wc.capturePage();
    writeFileSync(path.join(outDir, `${name}.png`), image.toPNG());
  };

  const drag = async (points: [number, number][]) => {
    const [x0, y0] = points[0];
    wc.sendInputEvent({ type: 'mouseMove', x: x0, y: y0 });
    wc.sendInputEvent({
      type: 'mouseDown',
      x: x0,
      y: y0,
      button: 'left',
      clickCount: 1,
    });
    for (const [x, y] of points.slice(1)) {
      wc.sendInputEvent({
        type: 'mouseMove',
        x,
        y,
        modifiers: ['leftbuttondown'],
      });
      await pause(4);
    }
    const [x1, y1] = points[points.length - 1];
    wc.sendInputEvent({
      type: 'mouseUp',
      x: x1,
      y: y1,
      button: 'left',
      clickCount: 1,
    });
    await pause(30);
  };

  await pause(800);
  const [w, h] = win.getContentSize();
  const cx = w / 2;
  const cy = h / 2;

  // A spiral, a wave, and a dot.
  const spiral: [number, number][] = [];
  for (let t = 0; t < 6 * Math.PI; t += 0.08) {
    spiral.push([cx - 220 + Math.cos(t) * t * 6, cy + Math.sin(t) * t * 6]);
  }
  await drag(spiral);
  const wave: [number, number][] = [];
  for (let x = 0; x <= 360; x += 4)
    wave.push([cx + x, cy + Math.sin(x / 30) * 40]);
  await drag(wave);
  await drag([[cx + 180, cy + 120]]);
  await shot('1-drawn');

  // Zoom in 3 notches around the wave.
  for (let i = 0; i < 3; i++) {
    wc.sendInputEvent({
      type: 'mouseWheel',
      x: cx + 180,
      y: cy,
      deltaX: 0,
      deltaY: 120,
      wheelTicksY: -1,
      modifiers: ['control'],
    } as Electron.MouseWheelInputEvent);
    await pause(40);
  }
  await pause(300);
  await shot('2-zoomed');

  // Undo the dot, then fit everything.
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'z', modifiers: ['control'] });
  wc.sendInputEvent({ type: 'keyUp', keyCode: 'z', modifiers: ['control'] });
  wc.sendInputEvent({ type: 'keyDown', keyCode: '1', modifiers: ['control'] });
  wc.sendInputEvent({ type: 'keyUp', keyCode: '1', modifiers: ['control'] });
  await pause(500);
  await shot('3-undo-fit');
}
