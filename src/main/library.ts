import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BACKGROUND,
  type Background,
  type TreeNode,
} from '../shared/types';
import { BoardFile } from './board-file';
import { writeFileAtomic } from './fs-util';

export const BOARD_EXT = '.chalkd';
export const ORDER_FILE = '.order.json';
export const FIRST_NOTEBOOK = 'My Notebook';

/**
 * The library is a plain folder tree: notebooks are folders, boards are
 * `.chalkd` files, and each folder's `.order.json` lists its children in
 * display order (PLAN.md › Storage).
 */
export class Library {
  constructor(
    readonly root: string,
    /** Background for newly created boards. */
    private newBoardBackground: () => Background = () => DEFAULT_BACKGROUND,
  ) {}

  /**
   * Make sure the library exists and holds at least one board. If there are
   * notebooks but no boards (say, the last one was deleted), the new board
   * goes into the first notebook rather than a new one.
   */
  ensure(now = new Date()): void {
    mkdirSync(this.root, { recursive: true });
    if (this.firstBoard()) return;
    const notebook =
      this.children('').find((n) => !n.endsWith(BOARD_EXT)) ??
      this.createNotebook('', FIRST_NOTEBOOK);
    this.createBoard(notebook, now);
  }

  abs(rel: string): string {
    return path.join(this.root, rel);
  }

  /** Library-relative path for an absolute one, or null if it's outside. */
  rel(abs: string): string | null {
    const r = path.relative(this.root, abs);
    return r && !r.startsWith('..') && !path.isAbsolute(r) ? r : null;
  }

  isBoard(rel: string | null): rel is string {
    if (!rel || !rel.endsWith(BOARD_EXT)) return false;
    return existsSync(this.abs(rel));
  }

  isNotebook(rel: string): boolean {
    try {
      return statSync(this.abs(rel)).isDirectory();
    } catch {
      return false;
    }
  }

  /** First board in display order, depth-first. */
  firstBoard(dir = ''): string | null {
    for (const name of this.children(dir)) {
      const rel = path.join(dir, name);
      if (name.endsWith(BOARD_EXT)) return rel;
      const inner = this.firstBoard(rel);
      if (inner) return inner;
    }
    return null;
  }

  /**
   * Notebooks and boards inside `dir`, in display order: the order file
   * first, then anything it doesn't mention (oldest first).
   */
  children(dir: string): string[] {
    const absDir = this.abs(dir);
    let entries;
    try {
      entries = readdirSync(absDir, { withFileTypes: true });
    } catch {
      return [];
    }
    const present = entries
      .filter((e) => !e.name.startsWith('.'))
      .filter(
        (e) => e.isDirectory() || (e.isFile() && e.name.endsWith(BOARD_EXT)),
      )
      .map((e) => e.name);
    const listed = this.readOrder(dir).filter((n) => present.includes(n));
    const rest = present
      .filter((n) => !listed.includes(n))
      .map((n) => ({ n, t: createdAt(path.join(absDir, n)) }))
      .sort((a, b) => a.t - b.t || naturalCompare(a.n, b.n))
      .map((e) => e.n);
    return [...listed, ...rest];
  }

  /** The whole library as a tree, in display order. */
  tree(dir = ''): TreeNode[] {
    return this.children(dir).map((name) => {
      const rel = path.join(dir, name);
      return name.endsWith(BOARD_EXT)
        ? { type: 'board', name: boardDisplayName(rel), path: rel }
        : { type: 'notebook', name, path: rel, children: this.tree(rel) };
    });
  }

  /** Rename in place, keeping its spot in the order. Returns the new path. */
  rename(rel: string, newName: string): string {
    const dir = parentOf(rel);
    const oldName = path.basename(rel);
    const ext = rel.endsWith(BOARD_EXT) ? BOARD_EXT : '';
    const trimmed =
      ext && newName.endsWith(ext) ? newName.slice(0, -ext.length) : newName;
    const wanted = sanitize(trimmed);
    if (wanted + ext === oldName) return rel;
    const order = this.children(dir);
    const finalName = this.uniqueName(dir, wanted, ext) + ext;
    renameSync(this.abs(rel), this.abs(path.join(dir, finalName)));
    this.writeOrder(
      dir,
      order.map((n) => (n === oldName ? finalName : n)),
    );
    return path.join(dir, finalName);
  }

  /**
   * Move into `parent` (possibly the same folder, i.e. a reorder), placed just
   * before the sibling named `before`, or at the end. Returns the new path.
   */
  move(rel: string, parent: string, before: string | null): string {
    const name = path.basename(rel);
    const from = parentOf(rel);
    if (!rel.endsWith(BOARD_EXT) && isSameOrInside(parent, rel)) {
      throw new Error("A notebook can't go inside itself");
    }
    let finalName = name;
    if (from !== parent) {
      const ext = rel.endsWith(BOARD_EXT) ? BOARD_EXT : '';
      const sourceOrder = this.children(from).filter((n) => n !== name);
      finalName = this.uniqueName(parent, path.basename(name, ext), ext) + ext;
      renameSync(this.abs(rel), this.abs(path.join(parent, finalName)));
      this.writeOrder(from, sourceOrder);
    }
    const order = this.children(parent).filter((n) => n !== finalName);
    const at = before === null ? -1 : order.indexOf(before);
    order.splice(at < 0 ? order.length : at, 0, finalName);
    this.writeOrder(parent, order);
    return path.join(parent, finalName);
  }

  /** Remove via `trash` (the system trash in the app) and fix up the order. */
  async remove(
    rel: string,
    trash: (abs: string) => Promise<void>,
  ): Promise<void> {
    const dir = parentOf(rel);
    const order = this.children(dir).filter((n) => n !== path.basename(rel));
    await trash(this.abs(rel));
    this.writeOrder(dir, order);
  }

  createNotebook(parent: string, name: string): string {
    const finalName = this.uniqueName(parent, sanitize(name), '');
    mkdirSync(this.abs(path.join(parent, finalName)));
    this.appendToOrder(parent, finalName);
    return path.join(parent, finalName);
  }

  /** Create an auto-named board in `notebook` (e.g. "Oct 7 · 10:42 AM"). */
  createBoard(
    notebook: string,
    now = new Date(),
    name = autoBoardName(now),
  ): string {
    const base = this.uniqueName(notebook, sanitize(name), BOARD_EXT);
    const file = base + BOARD_EXT;
    BoardFile.open(
      this.abs(path.join(notebook, file)),
      this.newBoardBackground(),
    ).close();
    this.appendToOrder(notebook, file);
    return path.join(notebook, file);
  }

  private readOrder(dir: string): string[] {
    try {
      const data = JSON.parse(
        readFileSync(this.abs(path.join(dir, ORDER_FILE)), 'utf8'),
      );
      return Array.isArray(data)
        ? data.filter((n) => typeof n === 'string')
        : [];
    } catch {
      return [];
    }
  }

  private appendToOrder(dir: string, name: string): void {
    // Rewrite from the current display order so the file also picks up
    // anything that appeared on disk without it.
    const order = this.children(dir).filter((n) => n !== name);
    order.push(name);
    this.writeOrder(dir, order);
  }

  private writeOrder(dir: string, order: string[]): void {
    writeFileAtomic(
      this.abs(path.join(dir, ORDER_FILE)),
      JSON.stringify(order, null, 2) + '\n',
    );
  }

  private uniqueName(dir: string, base: string, ext: string): string {
    let candidate = base;
    for (
      let n = 2;
      existsSync(this.abs(path.join(dir, candidate + ext)));
      n++
    ) {
      candidate = `${base} (${n})`;
    }
    return candidate;
  }
}

export function autoBoardName(now: Date): string {
  const day = now.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
  const time = now.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${day} · ${time}`;
}

/** Library-relative parent folder ('' for the top level). */
export function parentOf(rel: string): string {
  const dir = path.dirname(rel);
  return dir === '.' ? '' : dir;
}

/** Is `rel` the same as `ancestor`, or somewhere inside it? */
export function isSameOrInside(rel: string, ancestor: string): boolean {
  return rel === ancestor || rel.startsWith(ancestor + path.sep);
}

export function boardDisplayName(rel: string): string {
  return path.basename(rel, BOARD_EXT);
}

/** Names become file names: no slashes, no leading dots, no control chars. */
export function sanitize(name: string): string {
  const clean = name
    // oxlint-disable-next-line no-control-regex -- stripping them is the point
    .replace(/[/\\\u0000-\u001f]/g, '-')
    .replace(/^\.+/, '')
    .trim();
  return clean || 'Untitled';
}

function createdAt(file: string): number {
  try {
    const st = statSync(file);
    return st.birthtimeMs || st.mtimeMs;
  } catch {
    return 0;
  }
}

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});
function naturalCompare(a: string, b: string): number {
  return collator.compare(a, b);
}
