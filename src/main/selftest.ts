import { BrowserWindow } from 'electron';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
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
  printInbox: string,
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
        if (t.startsWith('row:')) {
          el = document.querySelectorAll('[role=treeitem]')[Number(t.slice(4))];
        } else {
          try { el = document.querySelector(t); } catch {}
          el ??= [...document.querySelectorAll('button, [role=treeitem]')].find(
            (b) => b.textContent.trim() === t,
          );
        }
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

  const type = async (text: string) => {
    for (const ch of text) wc.sendInputEvent({ type: 'char', keyCode: ch });
    await pause(100);
  };

  /** Long-press `from`, then drag to just above/below `to` (or onto its middle). */
  const dragRow = async (
    from: string,
    to: string,
    where: 'above' | 'below' | 'onto',
  ) => {
    const [x0, y0] = await center(from);
    const [x1, yc] = await center(to);
    const y1 = where === 'above' ? yc - 18 : where === 'below' ? yc + 18 : yc;
    wc.sendInputEvent({ type: 'mouseMove', x: x0, y: y0 });
    wc.sendInputEvent({
      type: 'mouseDown',
      x: x0,
      y: y0,
      button: 'left',
      clickCount: 1,
    });
    await pause(650);
    for (let i = 1; i <= 20; i++) {
      const x = x0 + ((x1 - x0) * i) / 20;
      const y = y0 + ((y1 - y0) * i) / 20;
      wc.sendInputEvent({
        type: 'mouseMove',
        x,
        y,
        modifiers: ['leftbuttondown'],
      });
      await pause(16);
    }
    await shot('drag-in-progress');
    wc.sendInputEvent({
      type: 'mouseUp',
      x: x1,
      y: y1,
      button: 'left',
      clickCount: 1,
    });
    await pause(400);
  };

  await pause(1000);
  if (process.env.CHALKD_SELFTEST_MODE === 'view') {
    await shot('reopened');
    return;
  }
  if (process.env.CHALKD_SELFTEST_MODE === 'print') {
    // Print through the real backend script, as CUPS would run it (but as
    // this user, into the sandbox inbox).
    const pdf = path.join(outDir, 'worksheet.pdf');
    writeFileSync(pdf, await makeWorksheetPdf());
    const print = (job: number, title: string) =>
      execFileSync(
        'sh',
        [
          path.join(process.cwd(), 'scripts/printer/chalkd-backend'),
          String(job),
          os.userInfo().username,
          title,
          '1',
          '',
          pdf,
        ],
        { env: { ...process.env, CHALKD_PRINT_INBOX: printInbox } },
      );
    await shot('p0-before');
    print(7, 'Fractions worksheet.pdf');
    await pause(2500);
    await shot('p1-printed');
    // A second job while the drawer is open: the drawer gets out of the way.
    await tap('[aria-label="Notebooks"]');
    await pause(400);
    print(8, '(stdin)');
    await pause(2500);
    await shot('p2-second');
    await tap('[aria-label="Notebooks"]');
    await pause(400);
    await shot('p3-drawer');
    return;
  }
  if (process.env.CHALKD_SELFTEST_MODE === 'import') {
    const testImport = async (name: string, mime: string, bytes: Buffer) => {
      await wc.executeJavaScript(
        `window.__chalkdTest.import([{ name: ${JSON.stringify(name)}, mime: ${JSON.stringify(mime)}, b64: ${JSON.stringify(bytes.toString('base64'))} }])`,
      );
      await pause(600);
    };

    await testImport(
      'worksheet.pdf',
      'application/pdf',
      await makeWorksheetPdf(),
    );
    await shot('i1-pdf');
    // Write an answer on the worksheet: ink must sit above the page.
    const [w, h] = win.getContentSize();
    const answer: [number, number][] = [];
    for (let i = 0; i <= 60; i++)
      answer.push([w / 2 - 120 + i * 4, h / 2 + 20 + Math.sin(i / 4) * 14]);
    await drag(answer);
    await key('1', ['control']);
    await pause(500);
    await shot('i2-fit-all');

    await key('0', ['control']);
    await pause(400);
    await testImport(
      'photo.png',
      'image/png',
      (await wc.capturePage()).resize({ width: 640 }).toPNG(),
    );
    await shot('i3-picture');

    // Select it with a tap, move it, resize from a corner, delete, undo.
    await tap('[aria-label="Select"]');
    const [px, py] = [w / 2, h / 2 + 32];
    await drag([[px, py]]);
    await shot('i4-selected');
    const steps = (
      x0: number,
      y0: number,
      x1: number,
      y1: number,
    ): [number, number][] =>
      Array.from({ length: 15 }, (_, i) => [
        x0 + ((x1 - x0) * i) / 14,
        y0 + ((y1 - y0) * i) / 14,
      ]);
    await drag(steps(px, py, px - 220, py - 60));
    await shot('i5-moved');
    await tap('Delete');
    await shot('i6-deleted');
    await key('z', ['control']);
    await shot('i7-undo');
    return;
  }

  if (process.env.CHALKD_SELFTEST_MODE === 'export') {
    const [w, h] = win.getContentSize();
    const testImport = async (name: string, mime: string, bytes: Buffer) => {
      await wc.executeJavaScript(
        `window.__chalkdTest.import([{ name: ${JSON.stringify(name)}, mime: ${JSON.stringify(mime)}, b64: ${JSON.stringify(bytes.toString('base64'))} }])`,
      );
      await pause(600);
    };
    // A grid board with a worksheet page, pen ink, a dot, and a highlighter.
    await tap('[aria-label="Settings"]');
    await tap('Grid');
    await key('Escape');
    await testImport(
      'worksheet.pdf',
      'application/pdf',
      await makeWorksheetPdf(),
    );
    await key('0', ['control']);
    await pause(400);
    const wave: [number, number][] = [];
    for (let i = 0; i <= 80; i++)
      wave.push([w / 2 - 160 + i * 4, h / 2 + 60 + Math.sin(i / 6) * 30]);
    await drag(wave);
    await drag([[w / 2 + 200, h / 2 + 60]]);
    await tap('[data-preset="hl-yellow"]');
    await drag(
      Array.from(
        { length: 40 },
        (_, i) => [w / 2 - 170 + i * 9, h / 2 + 64] as [number, number],
      ),
    );

    const exportWith = async (label: string, choices: string[]) => {
      await tap('[aria-label="Export"]');
      for (const c of choices) await tap(c);
      await shot(`e-dialog-${label}`);
      await tap('Export…');
      await pause(2500);
    };
    await exportWith('pdf-fit', ['PDF', 'One page']);
    await exportWith('pdf-pages', ['PDF', 'Printable pages', 'Letter']);
    await exportWith('png-board', ['Picture (PNG)', 'Whole board']);
    await exportWith('png-view', ['Picture (PNG)', 'What’s on screen']);
    await shot('e-done');
    return;
  }

  if (process.env.CHALKD_SELFTEST_MODE === 'coast') {
    const [w, h] = win.getContentSize();
    const cx = w / 2;
    const cy = h / 2;
    for (let i = -3; i <= 3; i++) {
      await drag(
        Array.from({ length: 40 }, (_, k): [number, number] => [
          cx + i * 120 + Math.sin(k / 4) * 30,
          cy - 150 + k * 8,
        ]),
      );
    }
    const camera = () =>
      wc.executeJavaScript('window.__chalkdTest.camera()') as Promise<{
        x: number;
        y: number;
        zoom: number;
      }>;
    wc.debugger.attach('1.3');
    const touch = (type: string, points: [number, number][]) =>
      wc.debugger.sendCommand('Input.dispatchTouchEvent', {
        type,
        touchPoints: points.map(([x, y], id) => ({ x, y, id })),
      });
    /** Two fingers slide `dx` px over `steps` frames, optionally rest, then lift. */
    const swipe = async (dx: number, steps: number, restMs: number) => {
      const at = (o: number): [number, number][] => [
        [cx - 60 + o, cy],
        [cx + 60 + o, cy],
      ];
      await touch('touchStart', at(0));
      for (let i = 1; i <= steps; i++) {
        await touch('touchMove', at((dx * i) / steps));
        await pause(16);
      }
      await pause(restMs);
      const atRelease = await camera();
      await touch('touchEnd', []);
      await pause(150);
      const soon = await camera();
      await shot(`c-gliding-${dx}`);
      await pause(1500);
      const later = await camera();
      await pause(300);
      const settled = await camera();
      return { atRelease, soon, later, settled };
    };
    const log = {
      flick: await swipe(-200, 8, 0),
      restThenLift: await swipe(300, 15, 150),
    };
    await shot('c-after');
    wc.debugger.detach();
    writeFileSync(
      path.join(outDir, 'coast.json'),
      JSON.stringify(log, null, 2),
    );
    return;
  }

  if (process.env.CHALKD_SELFTEST_MODE === 'toolbar') {
    const order = () =>
      wc.executeJavaScript(
        `[...document.querySelectorAll('[aria-label="Pens"] [data-preset]')].map((b) => b.getAttribute('aria-label'))`,
      ) as Promise<string[]>;
    const log: Record<string, unknown> = { before: await order() };
    /** Hold the nth pen for `holdMs`, slide `dx` px, and let go. */
    const holdSlide = async (n: number, holdMs: number, dx: number) => {
      const [x0, y] = await center(
        `[aria-label="Pens"] [data-preset]:nth-child(${n})`,
      );
      wc.sendInputEvent({ type: 'mouseMove', x: x0, y });
      wc.sendInputEvent({
        type: 'mouseDown',
        x: x0,
        y,
        button: 'left',
        clickCount: 1,
      });
      await pause(holdMs);
      if (holdMs >= 700) await shot(`t-held-${holdMs}`);
      for (let i = 1; i <= 15; i++) {
        wc.sendInputEvent({
          type: 'mouseMove',
          x: x0 + (dx * i) / 15,
          y,
          modifiers: ['leftbuttondown'],
        });
        await pause(16);
      }
      if (dx) await shot(`t-sliding-${holdMs}`);
      wc.sendInputEvent({
        type: 'mouseUp',
        x: x0 + dx,
        y,
        button: 'left',
        clickCount: 1,
      });
      await pause(400);
    };

    await shot('t1-start');
    // Picked up after 700 ms: the first pen moves two places right.
    const [a] = await center('[aria-label="Pens"] [data-preset]:nth-child(1)');
    const [c] = await center('[aria-label="Pens"] [data-preset]:nth-child(3)');
    await holdSlide(1, 800, c - a);
    log.afterDrag = await order();
    await shot('t2-dropped');
    // A shorter hold and a slide is a scroll, not a drag: nothing moves.
    await holdSlide(1, 500, c - a);
    log.afterShortSlide = await order();
    // Hold and release without sliding opens the editor.
    await holdSlide(2, 500, 0);
    await shot('t3-editor');
    log.editorOpen = await wc.executeJavaScript(
      `!!document.querySelector('[role=dialog], .popover')`,
    );
    writeFileSync(
      path.join(outDir, 'toolbar.json'),
      JSON.stringify(log, null, 2),
    );
    return;
  }

  if (process.env.CHALKD_SELFTEST_MODE === 'drawer') {
    const [w, h] = win.getContentSize();
    const scribble = (dx: number): [number, number][] =>
      Array.from({ length: 60 }, (_, i) => [
        w / 2 + dx + i * 4,
        h / 2 + Math.sin(i / 5) * 40,
      ]);

    await drag(scribble(-200)); // on the first board
    await tap('[aria-label="Notebooks"]');
    await shot('d1-drawer');

    await tap('Board'); // new board in the same notebook, opens it
    await drag(scribble(0));
    await drag(scribble(60));
    await tap('[aria-label="Notebooks"]');
    await shot('d2-two-boards');

    await tap('Notebook'); // new notebook, starts renaming
    await type('Science');
    await key('Enter');
    await pause(300);
    await shot('d3-renamed-notebook');

    await tap('row:1', 700); // long-press the first board → menu
    await shot('d4-menu');
    await tap('Move to…');
    await shot('d5-move-dialog');
    await tap('[aria-label="Move into Science"]');
    await pause(300);
    await shot('d6-moved');

    // Drag the "Science" notebook above "My Notebook"'s first child.
    await dragRow('Science', 'row:1', 'above');
    await shot('d7-dragged');

    await tap('row:3'); // opens behind the drawer, which stays open
    await pause(300);
    await shot('d8-opened');

    await tap('row:2', 700);
    await tap('Duplicate'); // opens the copy and starts renaming it
    await pause(400);
    await shot('d9-duplicated');
    await type('Period 2');
    await key('Enter');
    await pause(300);
    await shot('d10-copy-renamed');

    await tap('row:2', 700);
    await tap('Delete');
    await shot('d11-confirm');
    await tap('Delete board');
    await pause(400);
    // The sandbox lives on tmpfs, which has no trash: expect the fallback.
    await shot('d12-no-trash');
    await tap('Delete permanently');
    await pause(400);
    await shot('d13-deleted');
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

  // Eraser loop around the end of the wave, then a tap inside it.
  const loop: [number, number][] = [];
  for (let a = 0; a <= 2.1 * Math.PI; a += 0.1)
    loop.push([cx + 300 + Math.cos(a) * 90, cy + Math.sin(a) * 90]);
  await drag(loop);
  await shot('2b-eraser-loop');
  await drag([[cx + 300, cy + 60]]);
  await shot('2c-eraser-loop-erased');

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

/** A two-page worksheet PDF, printed by Chromium from a hidden window. */
async function makeWorksheetPdf(): Promise<Buffer> {
  const html = `<!doctype html><html><body style="font-family:sans-serif">
    <h1 style="font-size:40px">Fractions worksheet</h1>
    <p style="font-size:22px">1. Shade 3/4 of the circle.</p>
    <svg width="220" height="220"><circle cx="110" cy="110" r="100" fill="none" stroke="black" stroke-width="3"/>
      <line x1="110" y1="10" x2="110" y2="210" stroke="black"/><line x1="10" y1="110" x2="210" y2="110" stroke="black"/></svg>
    <p style="font-size:22px">2. 1/2 + 1/4 = ________</p>
    <div style="page-break-before:always"><h1 style="font-size:40px">Page two</h1>
    <p style="font-size:22px">3. Order from least to greatest: 2/3, 1/2, 5/6</p></div>
  </body></html>`;
  const win = new BrowserWindow({ show: false });
  try {
    await win.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
    );
    return await win.webContents.printToPDF({ pageSize: 'Letter' });
  } finally {
    win.destroy();
  }
}
