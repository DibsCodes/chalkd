/** Types shared by the main process and the renderer. */

export interface Point {
  x: number;
  y: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type StrokeKind = 'pen' | 'highlighter';

export interface StrokeStyle {
  kind: StrokeKind;
  color: string;
  width: number;
  opacity: number;
}

export interface StrokeItem extends StrokeStyle {
  id: string;
  type: 'stroke';
  /** Stacking order within the item's layer; higher draws on top. */
  z: number;
  /** World position that `points` are relative to. */
  origin: Point;
  /** Flat x,y pairs relative to `origin`. */
  points: Float32Array;
  bounds: Bounds;
}

/** A picture placed on the board; its bytes live in the board's asset table. */
export interface ImageItem {
  id: string;
  type: 'image';
  z: number;
  /** SHA-256 (hex) of the image bytes. */
  asset: string;
  x: number;
  y: number;
  w: number;
  h: number;
  bounds: Bounds;
}

export type Item = StrokeItem | ImageItem;

/** Image bytes, stored once per board no matter how many items use them. */
export interface AssetData {
  hash: string;
  mime: string;
  bytes: Uint8Array;
}

export type Pattern = 'blank' | 'grid' | 'lines' | 'dots';

export interface Background {
  color: string;
  pattern: Pattern;
  /** Pattern spacing in world units. */
  spacing: number;
}

export const DEFAULT_BACKGROUND: Background = {
  color: '#ffffff',
  pattern: 'dots',
  spacing: 40,
};

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

export interface BoardMeta {
  background: Background;
  /** Where the view was when the board was last used; null = never opened. */
  camera: CameraState | null;
}

/** A board as loaded from disk. */
export interface BoardData {
  /** Path relative to the library root, e.g. "Math 7/Lesson 1.chalkd". */
  path: string;
  name: string;
  meta: BoardMeta;
  items: Item[];
  /** Image data used by the board's items. */
  assets: AssetData[];
}

/** A batch of edits to persist. */
export interface BoardChanges {
  upserts: Item[];
  deletes: string[];
  meta?: Partial<BoardMeta>;
  /** New image data (written before the items that use it). */
  assets?: AssetData[];
}

/** A file the user picked, pasted, or dropped, ready to import. */
export interface ImportFile {
  name: string;
  mime: string;
  bytes: Uint8Array;
}

// ---------- library ----------

export interface TreeNode {
  type: 'notebook' | 'board';
  /** Display name (boards without the .chalkd extension). */
  name: string;
  /** Path relative to the library root. */
  path: string;
  children?: TreeNode[];
}

/** What the drawer needs after any library change. */
export interface LibraryState {
  tree: TreeNode[];
  /** The open board's path (it may have moved), or null. */
  current: string | null;
  /** Set when the open board was deleted and another one opened instead. */
  reopened?: BoardData;
  /** Set after a rename or move: where the item went. */
  moved?: { from: string; to: string };
}

// ---------- settings ----------

/** A pen or highlighter the user has set up in the toolbar. */
export interface Preset {
  id: string;
  color: string;
  /** Stroke width in board units. */
  width: number;
}

export type ActiveTool =
  | { type: 'pen'; presetId: string }
  | { type: 'highlighter'; presetId: string }
  | { type: 'eraser' }
  | { type: 'select' };

export interface EraserSettings {
  mode: 'partial' | 'stroke';
  /** Diameter in screen pixels. */
  size: number;
}

export type Theme = 'system' | 'light' | 'dark';

export interface ExportOptions {
  format: 'png' | 'pdf';
  /** PNG: the whole board, or just what's on screen. */
  area: 'board' | 'view';
  /** PDF: one page fitted to the content, or printable pages at real size. */
  layout: 'fit' | 'pages';
  paper: 'letter' | 'a4';
  /** Include the board's color and pattern (off = plain white). */
  background: boolean;
}

export interface AppSettings {
  /** Library folder; null means the default (~/Documents/Chalkd). */
  rootDir: string | null;
  /** Last open board, relative to the library root. */
  lastBoard: string | null;
  pens: Preset[];
  highlighters: Preset[];
  tool: ActiveTool;
  eraser: EraserSettings;
  defaultBackground: Background;
  theme: Theme;
  tapGestures: boolean;
  /** 0 = raw input, 1 = heavily smoothed. */
  smoothing: number;
  /** Ignore touches wider than this many px; null = off. */
  palmContactPx: number | null;
  export: ExportOptions;
  /** Where the last export was saved; the next one starts there. */
  lastExportDir: string | null;
}

export const HIGHLIGHTER_OPACITY = 0.4;

export const DEFAULT_SETTINGS: AppSettings = {
  rootDir: null,
  lastBoard: null,
  pens: [
    { id: 'pen-black', color: '#1d2433', width: 4 },
    { id: 'pen-blue', color: '#1f5fd1', width: 4 },
    { id: 'pen-red', color: '#d62f2f', width: 4 },
    { id: 'pen-green', color: '#1f8a3a', width: 4 },
  ],
  highlighters: [
    { id: 'hl-yellow', color: '#ffd400', width: 20 },
    { id: 'hl-green', color: '#5fe35f', width: 20 },
    { id: 'hl-pink', color: '#ff6fb5', width: 20 },
  ],
  tool: { type: 'pen', presetId: 'pen-black' },
  eraser: { mode: 'partial', size: 40 },
  defaultBackground: DEFAULT_BACKGROUND,
  theme: 'system',
  tapGestures: true,
  smoothing: 0.5,
  palmContactPx: null,
  export: {
    format: 'pdf',
    area: 'board',
    layout: 'fit',
    paper: 'letter',
    background: true,
  },
  lastExportDir: null,
};
