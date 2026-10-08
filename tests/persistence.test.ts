import {
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BoardFile, BoardFileError } from '../src/main/board-file';
import { autoBoardName, Library, sanitize } from '../src/main/library';
import { BoardSession } from '../src/main/board-session';
import { SettingsStore } from '../src/main/settings';
import {
  createImage,
  createStroke,
  type StrokeItem,
} from '../src/renderer/engine/items';
import { DEFAULT_BACKGROUND } from '../src/shared/types';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'chalkd-test-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const pen = { kind: 'pen' as const, color: '#123456', width: 3, opacity: 1 };

describe('BoardFile', () => {
  it('creates an empty board with default meta', () => {
    const file = BoardFile.open(path.join(dir, 'a.chalkd'));
    expect(file.read()).toEqual({
      meta: { background: DEFAULT_BACKGROUND, camera: null },
      items: [],
      assets: [],
    });
    file.close();
  });

  it('round-trips strokes, deletes, and meta across reopen', () => {
    const p = path.join(dir, 'b.chalkd');
    const a = createStroke([100.5, -20.25, 110, -10, 130.75, 5], pen, 1);
    const b = createStroke(
      [0, 0, 1, 1],
      { ...pen, kind: 'highlighter', opacity: 0.4 },
      2,
    );
    let file = BoardFile.open(p);
    file.write({ upserts: [a, b], deletes: [] });
    file.write({
      upserts: [],
      deletes: [b.id],
      meta: { camera: { x: 12, y: -4, zoom: 1.5 } },
    });
    file.close();

    file = BoardFile.open(p);
    const { meta, items } = file.read();
    file.close();
    expect(meta.camera).toEqual({ x: 12, y: -4, zoom: 1.5 });
    expect(meta.background).toEqual(DEFAULT_BACKGROUND);
    expect(items).toHaveLength(1);
    const got = items[0] as StrokeItem;
    expect(got.id).toBe(a.id);
    expect(got.origin).toEqual(a.origin);
    expect(got.bounds).toEqual(a.bounds);
    expect([...got.points]).toEqual([...a.points]);
    expect(got.color).toBe('#123456');
  });

  it('upserting an existing id replaces it', () => {
    const file = BoardFile.open(path.join(dir, 'c.chalkd'));
    const a = createStroke([0, 0, 5, 5], pen, 1);
    file.write({ upserts: [a], deletes: [] });
    file.write({ upserts: [{ ...a, color: '#ff0000' }], deletes: [] });
    expect(file.read().items.map((i) => (i as StrokeItem).color)).toEqual([
      '#ff0000',
    ]);
    file.close();
  });

  it('refuses files that are not Chalkd boards', () => {
    const p = path.join(dir, 'notes.chalkd');
    writeFileSync(p, 'just some text, definitely not sqlite');
    expect(() => BoardFile.open(p)).toThrow();
  });

  it('refuses boards from a newer format version', async () => {
    const p = path.join(dir, 'future.chalkd');
    BoardFile.open(p).close();
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(p);
    db.exec('PRAGMA user_version = 99');
    db.close();
    expect(() => BoardFile.open(p)).toThrow(BoardFileError);
  });
});

describe('BoardFile images', () => {
  const png = (n: number) => ({
    hash: `hash${n}`,
    mime: 'image/png',
    bytes: new Uint8Array([n, 1, 2, 3]),
  });

  it('round-trips image items and loads only the image data in use', () => {
    const p = path.join(dir, 'img.chalkd');
    const a = createImage('hash1', 10, 20, 300, 200, 1);
    let file = BoardFile.open(p);
    file.write({ upserts: [a], deletes: [], assets: [png(1), png(2)] });
    file.close();

    file = BoardFile.open(p);
    const { items, assets } = file.read();
    expect(items).toEqual([a]);
    expect(assets.map((x) => x.hash)).toEqual(['hash1']);
    expect([...assets[0].bytes]).toEqual([1, 1, 2, 3]);
    file.close();
  });

  it('garbage-collects image data no item uses', async () => {
    const p = path.join(dir, 'gc.chalkd');
    const file = BoardFile.open(p);
    const a = createImage('hash1', 0, 0, 10, 10, 1);
    file.write({ upserts: [a], deletes: [], assets: [png(1), png(2)] });
    file.write({ upserts: [], deletes: [a.id] });
    file.collectGarbage();
    file.close();
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(p);
    expect(db.prepare('SELECT count(*) AS n FROM assets').get()).toEqual({
      n: 0,
    });
    db.close();
  });

  it('writing the same image data twice stores it once', async () => {
    const p = path.join(dir, 'dup.chalkd');
    const file = BoardFile.open(p);
    file.write({
      upserts: [createImage('hash1', 0, 0, 1, 1, 1)],
      deletes: [],
      assets: [png(1)],
    });
    file.write({
      upserts: [createImage('hash1', 5, 5, 1, 1, 2)],
      deletes: [],
      assets: [png(1)],
    });
    expect(file.read().items).toHaveLength(2);
    expect(file.read().assets).toHaveLength(1);
    file.close();
  });
});

describe('Library', () => {
  it('creates a first notebook and board on first run', () => {
    const lib = new Library(path.join(dir, 'Chalkd'));
    lib.ensure(new Date(2026, 9, 7, 10, 42));
    expect(lib.children('')).toEqual(['My Notebook']);
    expect(lib.firstBoard()).toBe(
      path.join('My Notebook', 'Oct 7 · 10:42 AM.chalkd'),
    );
  });

  it('does nothing when a board already exists', () => {
    const lib = new Library(dir);
    lib.ensure();
    const first = lib.firstBoard();
    lib.ensure();
    expect(lib.firstBoard()).toBe(first);
    expect(lib.children('')).toHaveLength(1);
  });

  it('keeps creation order and makes clashing names unique', () => {
    const lib = new Library(dir);
    const nb = lib.createNotebook('', 'Math');
    const t = new Date(2026, 9, 7, 9, 5);
    lib.createBoard(nb, t, 'Lesson 10');
    lib.createBoard(nb, t, 'Lesson 2');
    lib.createBoard(nb, t, 'Lesson 2');
    expect(lib.children(nb)).toEqual([
      'Lesson 10.chalkd',
      'Lesson 2.chalkd',
      'Lesson 2 (2).chalkd',
    ]);
    const order = JSON.parse(
      readFileSync(path.join(dir, 'Math', '.order.json'), 'utf8'),
    );
    expect(order).toEqual(lib.children(nb));
  });

  it('appends unlisted items oldest first and drops vanished ones', () => {
    const lib = new Library(dir);
    const nb = lib.createNotebook('', 'Science');
    lib.createBoard(nb, new Date(), 'Listed');
    // Copied in by hand, newest first on disk.
    for (const [name, secs] of [
      ['Zeta', 2000],
      ['Alpha', 1000],
    ] as const) {
      const p = path.join(dir, 'Science', `${name}.chalkd`);
      BoardFile.open(p).close();
      utimesSync(p, secs, secs);
    }
    mkdirSync(path.join(dir, 'Science', '.hidden'));
    writeFileSync(
      path.join(dir, 'Science', '.order.json'),
      JSON.stringify(['Gone.chalkd', 'Listed.chalkd']),
    );
    const children = lib.children(nb);
    expect(children[0]).toBe('Listed.chalkd');
    expect(children.slice(1).sort()).toEqual(['Alpha.chalkd', 'Zeta.chalkd']);
    expect(children).not.toContain('Gone.chalkd');
    expect(children).not.toContain('.hidden');
  });

  it('formats auto names and sanitizes file names', () => {
    expect(autoBoardName(new Date(2026, 0, 3, 15, 7))).toBe('Jan 3 · 3:07 PM');
    expect(sanitize('a/b\\c')).toBe('a-b-c');
    expect(sanitize('..secret')).toBe('secret');
    expect(sanitize('   ')).toBe('Untitled');
  });
});

describe('BoardSession', () => {
  it('reopens the last board, falling back when it is missing', () => {
    const settings = new SettingsStore(path.join(dir, 'config'));
    const lib = new Library(path.join(dir, 'lib'));
    const session = new BoardSession(lib, settings);

    const first = session.openInitial();
    const second = lib.createBoard(
      lib.createNotebook('', 'Other'),
      new Date(),
      'Second',
    );
    session.open(second);
    session.close();

    const reopened = new BoardSession(
      lib,
      new SettingsStore(path.join(dir, 'config')),
    );
    expect(reopened.openInitial().path).toBe(second);
    reopened.close();

    rmSync(lib.abs(second));
    const fallback = new BoardSession(
      lib,
      new SettingsStore(path.join(dir, 'config')),
    );
    expect(fallback.openInitial().path).toBe(first.path);
    fallback.close();
  });

  it('starts a fresh board when the only board is corrupt', () => {
    const settings = new SettingsStore(path.join(dir, 'config'));
    const lib = new Library(path.join(dir, 'lib'));
    lib.ensure();
    writeFileSync(lib.abs(lib.firstBoard()!), 'garbage');
    const session = new BoardSession(lib, settings);
    const data = session.openInitial();
    expect(data.items).toEqual([]);
    expect(lib.children('My Notebook')).toHaveLength(2);
    session.close();
  });
});
