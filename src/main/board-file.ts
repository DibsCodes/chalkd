import { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_BACKGROUND,
  type AssetData,
  type Background,
  type BoardChanges,
  type BoardMeta,
  type Item,
} from '../shared/types';

/** Bumped whenever the schema changes; stored in PRAGMA user_version. */
export const FORMAT_VERSION = 1;
/** "CHLK": marks a SQLite file as a Chalkd board (PRAGMA application_id). */
const APPLICATION_ID = 0x43484c4b;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS items (
    id       TEXT PRIMARY KEY,
    type     TEXT NOT NULL,
    kind     TEXT NOT NULL,
    z        INTEGER NOT NULL,
    min_x    REAL NOT NULL,
    min_y    REAL NOT NULL,
    max_x    REAL NOT NULL,
    max_y    REAL NOT NULL,
    origin_x REAL NOT NULL,
    origin_y REAL NOT NULL,
    style    TEXT NOT NULL,
    points   BLOB NOT NULL
  );
  CREATE TABLE IF NOT EXISTS assets (
    hash  TEXT PRIMARY KEY,
    mime  TEXT NOT NULL,
    bytes BLOB NOT NULL
  );
`;

interface ItemRow {
  id: string;
  type: string;
  kind: string;
  z: number;
  min_x: number;
  min_y: number;
  max_x: number;
  max_y: number;
  origin_x: number;
  origin_y: number;
  style: string;
  points: Uint8Array;
}

export class BoardFileError extends Error {}

/**
 * One board on disk: a SQLite database. Uses a rollback journal (not WAL) so
 * a closed board is always a single self-contained file — safe to copy or sync.
 */
export class BoardFile {
  private constructor(
    readonly path: string,
    private db: DatabaseSync,
  ) {}

  /**
   * Open a board, creating an empty one if the file doesn't exist.
   * `background` applies only to a newly created board.
   */
  static open(
    path: string,
    background: Background = DEFAULT_BACKGROUND,
  ): BoardFile {
    const db = new DatabaseSync(path);
    try {
      db.exec('PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL;');
      const appId = pragma(db, 'application_id');
      const version = pragma(db, 'user_version');
      const isNew = appId === 0 && version === 0 && isEmpty(db);
      if (isNew) {
        db.exec('BEGIN');
        db.exec(SCHEMA);
        db.exec(`PRAGMA application_id = ${APPLICATION_ID}`);
        db.exec(`PRAGMA user_version = ${FORMAT_VERSION}`);
        writeMeta(db, { background, camera: null });
        db.exec('COMMIT');
      } else if (appId !== APPLICATION_ID) {
        throw new BoardFileError(`${path} is not a Chalkd board`);
      } else if (version > FORMAT_VERSION) {
        throw new BoardFileError(
          `${path} was saved by a newer version of Chalkd (format ${version})`,
        );
      }
      return new BoardFile(path, db);
    } catch (err) {
      db.close();
      throw err;
    }
  }

  read(): { meta: BoardMeta; items: Item[]; assets: AssetData[] } {
    const meta: BoardMeta = { background: DEFAULT_BACKGROUND, camera: null };
    const metaRows = this.db.prepare('SELECT key, value FROM meta').all() as {
      key: string;
      value: string;
    }[];
    for (const { key, value } of metaRows) {
      if (key === 'background' || key === 'camera')
        meta[key] = JSON.parse(value);
    }

    const rows = this.db
      .prepare('SELECT * FROM items ORDER BY z')
      .all() as unknown as ItemRow[];
    const assets = this.db
      .prepare(
        `SELECT hash, mime, bytes FROM assets
         WHERE hash IN (${REFERENCED_ASSETS})`,
      )
      .all() as unknown as AssetData[];
    return { meta, items: rows.map(rowToItem), assets };
  }

  /**
   * Drop image data no item uses any more (e.g. a deleted picture). Only safe
   * when nothing could still undo back to it — i.e. right after opening.
   */
  collectGarbage(): void {
    this.db.exec(`DELETE FROM assets WHERE hash NOT IN (${REFERENCED_ASSETS})`);
  }

  /** Apply a batch of edits atomically. */
  write(changes: BoardChanges): void {
    const db = this.db;
    db.exec('BEGIN');
    try {
      if (changes.assets?.length) {
        const add = db.prepare(
          'INSERT OR IGNORE INTO assets (hash, mime, bytes) VALUES (?, ?, ?)',
        );
        for (const a of changes.assets) add.run(a.hash, a.mime, a.bytes);
      }
      if (changes.deletes.length) {
        const del = db.prepare('DELETE FROM items WHERE id = ?');
        for (const id of changes.deletes) del.run(id);
      }
      if (changes.upserts.length) {
        const put = db.prepare(
          `INSERT OR REPLACE INTO items
             (id, type, kind, z, min_x, min_y, max_x, max_y,
              origin_x, origin_y, style, points)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const item of changes.upserts) put.run(...itemToRow(item));
      }
      if (changes.meta) writeMeta(db, changes.meta);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  close(): void {
    if (this.db.isOpen) this.db.close();
  }
}

function writeMeta(db: DatabaseSync, meta: Partial<BoardMeta>): void {
  const put = db.prepare(
    'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
  );
  for (const [key, value] of Object.entries(meta)) {
    if (value !== undefined) put.run(key, JSON.stringify(value));
  }
}

/** Asset hashes used by image items. */
const REFERENCED_ASSETS =
  "SELECT json_extract(style, '$.asset') FROM items WHERE type = 'image'";

const NO_POINTS = new Uint8Array(0);

function itemToRow(item: Item) {
  const b = item.bounds;
  if (item.type === 'image') {
    return [
      item.id,
      'image',
      'image',
      item.z,
      b.minX,
      b.minY,
      b.maxX,
      b.maxY,
      item.x,
      item.y,
      JSON.stringify({ asset: item.asset, w: item.w, h: item.h }),
      NO_POINTS,
    ] as const;
  }
  const p = item.points;
  return [
    item.id,
    'stroke',
    item.kind,
    item.z,
    b.minX,
    b.minY,
    b.maxX,
    b.maxY,
    item.origin.x,
    item.origin.y,
    JSON.stringify({
      color: item.color,
      width: item.width,
      opacity: item.opacity,
    }),
    new Uint8Array(p.buffer, p.byteOffset, p.byteLength),
  ] as const;
}

function rowToItem(row: ItemRow): Item {
  const bounds = {
    minX: row.min_x,
    minY: row.min_y,
    maxX: row.max_x,
    maxY: row.max_y,
  };
  if (row.type === 'image') {
    const style = JSON.parse(row.style) as {
      asset: string;
      w: number;
      h: number;
    };
    return {
      id: row.id,
      type: 'image',
      z: row.z,
      asset: style.asset,
      x: row.origin_x,
      y: row.origin_y,
      w: style.w,
      h: style.h,
      bounds,
    };
  }
  const style = JSON.parse(row.style) as {
    color: string;
    width: number;
    opacity: number;
  };
  // Copy into a fresh, aligned buffer: SQLite blobs can start at any offset.
  const bytes = row.points.slice();
  return {
    id: row.id,
    type: 'stroke',
    kind: row.kind === 'highlighter' ? 'highlighter' : 'pen',
    z: row.z,
    color: style.color,
    width: style.width,
    opacity: style.opacity,
    origin: { x: row.origin_x, y: row.origin_y },
    points: new Float32Array(bytes.buffer, 0, bytes.byteLength / 4),
    bounds,
  };
}

function pragma(db: DatabaseSync, name: string): number {
  const row = db.prepare(`PRAGMA ${name}`).get() as Record<string, number>;
  return Number(Object.values(row)[0] ?? 0);
}

function isEmpty(db: DatabaseSync): boolean {
  const row = db.prepare('SELECT count(*) AS n FROM sqlite_master').get() as {
    n: number;
  };
  return Number(row.n) === 0;
}
