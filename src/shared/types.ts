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

export type Item = StrokeItem;

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
}

/** A batch of edits to persist. */
export interface BoardChanges {
  upserts: Item[];
  deletes: string[];
  meta?: Partial<BoardMeta>;
}
