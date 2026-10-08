import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BoardSession } from '../src/main/board-session';
import { Library } from '../src/main/library';
import { SettingsStore } from '../src/main/settings';
import { createStroke } from '../src/renderer/engine/items';

let dir: string;
let lib: Library;
const t = new Date(2026, 9, 7, 9, 0);
const trash = async (abs: string) =>
  rmSync(abs, { recursive: true, force: true });

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'chalkd-lib-'));
  lib = new Library(dir);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Math/ with boards A, B, C and a sub-notebook Unit/ holding D. */
function sample() {
  const math = lib.createNotebook('', 'Math');
  for (const n of ['A', 'B', 'C']) lib.createBoard(math, t, n);
  const unit = lib.createNotebook(math, 'Unit');
  lib.createBoard(unit, t, 'D');
  lib.createNotebook('', 'Science');
  return { math, unit };
}

const names = (rel: string) => lib.children(rel);

describe('tree', () => {
  it('lists notebooks and boards in display order', () => {
    sample();
    const tree = lib.tree();
    expect(tree.map((n) => n.name)).toEqual(['Math', 'Science']);
    const math = tree[0];
    expect(math.children!.map((n) => `${n.type}:${n.name}`)).toEqual([
      'board:A',
      'board:B',
      'board:C',
      'notebook:Unit',
    ]);
    expect(math.children![3].children![0].path).toBe(
      path.join('Math', 'Unit', 'D.chalkd'),
    );
  });
});

describe('rename', () => {
  it('keeps the item in place in the order', () => {
    const { math } = sample();
    const renamed = lib.rename(path.join(math, 'B.chalkd'), 'Bee');
    expect(renamed).toBe(path.join('Math', 'Bee.chalkd'));
    expect(names(math)).toEqual(['A.chalkd', 'Bee.chalkd', 'C.chalkd', 'Unit']);
  });

  it('ignores a typed .chalkd and avoids clashes', () => {
    const { math } = sample();
    expect(lib.rename(path.join(math, 'A.chalkd'), 'C.chalkd')).toBe(
      path.join('Math', 'C (2).chalkd'),
    );
  });

  it('renames notebooks', () => {
    const { unit } = sample();
    expect(lib.rename(unit, 'Unit 3 – Fractions')).toBe(
      path.join('Math', 'Unit 3 – Fractions'),
    );
    expect(lib.tree()[0].children![3].children![0].name).toBe('D');
  });
});

describe('move', () => {
  it('reorders within a notebook', () => {
    const { math } = sample();
    lib.move(path.join(math, 'C.chalkd'), math, 'A.chalkd');
    expect(names(math)).toEqual(['C.chalkd', 'A.chalkd', 'B.chalkd', 'Unit']);
    lib.move(path.join(math, 'C.chalkd'), math, null);
    expect(names(math)).toEqual(['A.chalkd', 'B.chalkd', 'Unit', 'C.chalkd']);
  });

  it('moves into another notebook at a position, fixing both orders', () => {
    const { math, unit } = sample();
    const moved = lib.move(path.join(math, 'A.chalkd'), unit, 'D.chalkd');
    expect(moved).toBe(path.join('Math', 'Unit', 'A.chalkd'));
    expect(names(unit)).toEqual(['A.chalkd', 'D.chalkd']);
    expect(names(math)).toEqual(['B.chalkd', 'C.chalkd', 'Unit']);
  });

  it('renames on clash and moves to the top level', () => {
    const { math, unit } = sample();
    lib.createBoard('', t, 'D');
    expect(lib.move(path.join(unit, 'D.chalkd'), '', null)).toBe(
      'D (2).chalkd',
    );
    expect(names(math)).toContain('Unit');
  });

  it('refuses to put a notebook inside itself', () => {
    const { math, unit } = sample();
    expect(() => lib.move(math, unit, null)).toThrow();
    expect(() => lib.move(math, math, null)).toThrow();
  });
});

describe('duplicate', () => {
  it('copies a board just after the original, with its contents', () => {
    const { math } = sample();
    const a = path.join(math, 'A.chalkd');
    const settings = new SettingsStore(path.join(dir, '.config'));
    const session = new BoardSession(lib, settings);
    session.open(a);
    session.write({
      upserts: [
        createStroke(
          [0, 0, 5, 5],
          { kind: 'pen', color: '#000', width: 2, opacity: 1 },
          1,
        ),
      ],
      deletes: [],
    });
    session.close();

    expect(lib.duplicate(a)).toBe(path.join(math, 'A copy.chalkd'));
    expect(names(math)).toEqual([
      'A.chalkd',
      'A copy.chalkd',
      'B.chalkd',
      'C.chalkd',
      'Unit',
    ]);
    const copy = new BoardSession(lib, settings);
    expect(copy.open(path.join(math, 'A copy.chalkd')).items).toHaveLength(1);
    copy.close();
  });

  it('numbers further copies', () => {
    const { math } = sample();
    const a = path.join(math, 'A.chalkd');
    lib.duplicate(a);
    expect(lib.duplicate(a)).toBe(path.join(math, 'A copy (2).chalkd'));
    expect(names(math).slice(0, 3)).toEqual([
      'A.chalkd',
      'A copy (2).chalkd',
      'A copy.chalkd',
    ]);
  });

  it('refuses notebooks', () => {
    const { unit } = sample();
    expect(() => lib.duplicate(unit)).toThrow();
  });
});

describe('remove and ensure', () => {
  it('removes and fixes the order', async () => {
    const { math } = sample();
    await lib.remove(path.join(math, 'B.chalkd'), trash);
    expect(names(math)).toEqual(['A.chalkd', 'C.chalkd', 'Unit']);
  });

  it('after the last board is gone, puts a new one in the first notebook', async () => {
    const { math } = sample();
    await lib.remove(math, trash);
    lib.ensure(t);
    expect(lib.firstBoard()).toBe(
      path.join('Science', 'Oct 7 · 9:00 AM.chalkd'),
    );
  });
});

describe('BoardSession.around', () => {
  function openSession() {
    const settings = new SettingsStore(path.join(dir, '.config'));
    const session = new BoardSession(lib, settings);
    return { session, settings };
  }

  it('reopens the open board at its new path and keeps saving to it', async () => {
    const { math } = sample();
    const { session, settings } = openSession();
    const board = path.join(math, 'Unit', 'D.chalkd');
    session.open(board);
    const renamed = await session.around(
      () => lib.rename(math, 'Maths'),
      (cur, to) => to + cur.slice(math.length),
    );
    const now = path.join(renamed, 'Unit', 'D.chalkd');
    expect(session.currentPath).toBe(now);
    expect(settings.get('lastBoard')).toBe(now);

    session.write({
      upserts: [
        createStroke(
          [0, 0, 5, 5],
          { kind: 'pen', color: '#000', width: 2, opacity: 1 },
          1,
        ),
      ],
      deletes: [],
    });
    expect(session.open(now).items).toHaveLength(1);
    expect(existsSync(lib.abs(board))).toBe(false);
    session.close();
  });

  it('reopens the original board if the operation fails', async () => {
    const { math } = sample();
    const { session } = openSession();
    const board = path.join(math, 'A.chalkd');
    session.open(board);
    await expect(
      session.around(
        () => lib.move(math, path.join(math, 'Unit'), null),
        () => null,
      ),
    ).rejects.toThrow();
    expect(session.currentPath).toBe(board);
    session.close();
  });
});
