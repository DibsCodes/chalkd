import type { BrowserWindow } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * `CHALKD_SELFTEST=<dir> npm start`: drives the real app with synthetic mouse
 * and keyboard input and saves screenshots, so behavior can be checked
 * without someone at the screen. Quits when done. With
 * CHALKD_SELFTEST_MODE=view it only screenshots whatever board opens.
 */
export async function runSelfTest(
  win: BrowserWindow,
  outDir: string,
): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const wc = win.webContents;
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const shot = async (name: string) => {
    await pause(250);
    const image = await wc.capturePage();
    writeFileSync(path.join(outDir, `${name}.png`), image.toPNG());
  };

  /** Center of the first element matching a CSS selector, or a button with this text. */
  const center = async (target: string): Promise<[number, number]> => {
    const r = await wc.executeJavaScript(
      `(() => {
        const t = ${JSON.stringify(target)};
        let el = null;
        try { el = document.querySelector(t); } catch {}
        el ??= [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === t);
        el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        const r = el?.getBoundingClientRect();
        return r ? [r.left + r.width / 2, r.top + r.height / 2] : null;
      })()`,
    );
    if (!r) throw new Error(`selftest: nothing matches ${target}`);
    return r;
  };

  const tap = async (target: string, holdMs = 30) => {
    const [x, y] = await center(target);
    wc.sendInputEvent({ type: 'mouseMove', x, y });
    wc.sendInputEvent({
      type: 'mouseDown',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
    await pause(holdMs);
    wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
    await pause(150);
  };

  const key = async (
    keyCode: string,
    modifiers: ('control' | 'shift')[] = [],
  ) => {
    wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await pause(150);
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
    await pause(60);
  };

  await pause(1000);
  if (process.env.CHALKD_SELFTEST_MODE === 'view') {
    await shot('reopened');
    return;
  }

  const [w, h] = win.getContentSize();
  const cx = w / 2;
  const cy = h / 2 + 30;

  // Pen: a spiral, a wave, and a dot.
  const spiral: [number, number][] = [];
  for (let t = 0; t < 6 * Math.PI; t += 0.08) {
    spiral.push([cx - 260 + Math.cos(t) * t * 6, cy + Math.sin(t) * t * 6]);
  }
  await drag(spiral);
  const wave: [number, number][] = [];
  for (let x = 0; x <= 360; x += 4)
    wave.push([cx + x, cy + Math.sin(x / 30) * 40]);
  await drag(wave);
  await drag([[cx + 180, cy + 120]]);

  // Highlighter across the wave (should sit underneath the ink).
  await tap('[data-preset="hl-yellow"]');
  const hl: [number, number][] = [];
  for (let x = -20; x <= 380; x += 6) hl.push([cx + x, cy + 4]);
  await drag(hl);

  // Partial eraser straight down through the spiral.
  await tap('[aria-label="Eraser"]');
  const cut: [number, number][] = [];
  for (let y = -140; y <= 140; y += 5) cut.push([cx - 260, cy + y]);
  await drag(cut);
  await shot('1-pen-highlighter-eraser');

  // Undo the erase, then redo it.
  await key('z', ['control']);
  await shot('2-undo-erase');
  await key('z', ['control', 'shift']);

  // Pen editor: tap a pen, tap it again to edit.
  await tap('[data-preset="pen-blue"]');
  await tap('[data-preset="pen-blue"]');
  await shot('3-pen-editor');
  await key('Escape');

  // Eraser menu via long-press.
  await tap('[aria-label="Eraser"]', 700);
  await shot('4-eraser-menu');
  await key('Escape');

  // Settings, then a charcoal board with a grid.
  await tap('[aria-label="Settings"]');
  await shot('5-settings');
  await tap('[aria-label="Charcoal"]');
  await tap('Grid');
  await key('Escape');
  await shot('6-charcoal');
}
