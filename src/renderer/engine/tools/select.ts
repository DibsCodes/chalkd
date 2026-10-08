import type { Bounds } from '../../../shared/types';
import type { Point } from '../camera';
import { drawItem } from '../draw';
import { distSqToSegment, mostlyInside, pointInPolygon } from '../geometry';
import {
  applyTransform,
  boundsOf,
  compareRenderOrder,
  IDENTITY,
  isIdentity,
  transformItem,
  type Item,
  type Transform,
} from '../items';
import type { Tool, ToolContext } from './tool';

/** Handle radius as drawn, in screen pixels. */
const HANDLE_PX = 11;
/** How close a finger must land to grab a handle, in screen pixels. */
const HANDLE_HIT_PX = 30;
/** A lasso smaller than this (screen px) is a tap. */
const TAP_PX = 10;
/** Extra reach around thin ink for taps, in screen pixels. */
const TAP_SLOP_PX = 8;
/** The selection can't be shrunk smaller than this on screen. */
const MIN_SIZE_PX = 16;
const ACCENT = '#2f6fed';

type Mode = 'idle' | 'lasso' | 'move' | 'scale';

/**
 * Lasso or tap to select; drag inside the selection to move it, drag a
 * corner handle to resize it. While dragging, the selection is previewed on
 * the live layer; letting go commits one undoable change.
 */
export class SelectTool implements Tool {
  private selection: Item[] = [];
  private mode: Mode = 'idle';
  private lasso: number[] = [];
  private start: Point = { x: 0, y: 0 };
  private anchor: Point = { x: 0, y: 0 };
  private startBounds: Bounds | null = null;
  private transform: Transform = IDENTITY;
  private listeners = new Set<() => void>();
  private unsubscribe: () => void;
  private applying = false;

  constructor(private ctx: ToolContext) {
    this.unsubscribe = ctx.scene.onChange(() => {
      if (this.applying) return;
      // Something else changed the board (undo, say): keep only selected
      // items that are still there unchanged.
      const kept = this.selection.filter((i) => ctx.scene.get(i.id) === i);
      if (kept.length !== this.selection.length) this.setSelection(kept);
    });
  }

  activate(): void {
    this.ctx.renderer.setLive((g) => this.drawOverlay(g));
  }

  get selected(): readonly Item[] {
    return this.selection;
  }

  /** Selection bounds including any in-progress move/resize, or null. */
  bounds(): Bounds | null {
    const b = boundsOf(this.selection);
    if (!b) return null;
    const a = applyTransform(this.transform, b.minX, b.minY);
    const c = applyTransform(this.transform, b.maxX, b.maxY);
    return { minX: a.x, minY: a.y, maxX: c.x, maxY: c.y };
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ---------- Tool ----------

  down(p: Point): void {
    this.start = p;
    this.transform = IDENTITY;
    const b = this.bounds();
    if (b) {
      const corner = this.cornerAt(p, b);
      if (corner) {
        this.mode = 'scale';
        this.anchor = corner.opposite;
        this.startBounds = b;
        this.ctx.renderer.setHidden(this.selection.map((i) => i.id));
        return;
      }
      const pad = HANDLE_HIT_PX / 2 / this.ctx.camera.zoom;
      if (inside(p, b, pad)) {
        this.mode = 'move';
        this.ctx.renderer.setHidden(this.selection.map((i) => i.id));
        return;
      }
    }
    this.setSelection([]);
    this.mode = 'lasso';
    this.lasso = [p.x, p.y];
    this.ctx.renderer.invalidateLive();
  }

  move(points: Point[]): void {
    const p = points[points.length - 1];
    if (!p) return;
    if (this.mode === 'lasso') {
      for (const q of points) this.lasso.push(q.x, q.y);
    } else if (this.mode === 'move') {
      this.transform = {
        dx: p.x - this.start.x,
        dy: p.y - this.start.y,
        s: 1,
        ox: 0,
        oy: 0,
      };
    } else if (this.mode === 'scale') {
      this.transform = {
        dx: 0,
        dy: 0,
        s: this.scaleFor(p),
        ox: this.anchor.x,
        oy: this.anchor.y,
      };
    } else {
      return;
    }
    this.ctx.renderer.invalidateLive();
    this.notify();
  }

  up(): void {
    if (this.mode === 'lasso') {
      this.finishLasso();
    } else if (this.mode === 'move' || this.mode === 'scale') {
      if (!isIdentity(this.transform)) {
        const moved = this.selection.map((i) =>
          transformItem(i, this.transform),
        );
        this.commit({ added: moved, removed: this.selection });
        this.selection = moved;
      }
      this.ctx.renderer.setHidden([]);
    }
    this.reset();
  }

  cancel(): void {
    if (this.mode === 'move' || this.mode === 'scale')
      this.ctx.renderer.setHidden([]);
    this.reset();
  }

  dispose(): void {
    this.unsubscribe();
    this.ctx.renderer.setHidden([]);
    this.ctx.renderer.setLive(null);
    this.listeners.clear();
  }

  // ---------- commands ----------

  deleteSelection(): void {
    if (!this.selection.length) return;
    this.commit({ added: [], removed: this.selection });
    this.setSelection([]);
  }

  selectAll(): void {
    this.setSelection(this.ctx.scene.all());
  }

  clearSelection(): void {
    this.setSelection([]);
  }

  // ---------- internals ----------

  private reset(): void {
    this.mode = 'idle';
    this.lasso = [];
    this.transform = IDENTITY;
    this.startBounds = null;
    this.ctx.renderer.invalidateLive();
    this.notify();
  }

  private commit(change: { added: Item[]; removed: Item[] }): void {
    this.applying = true;
    try {
      this.ctx.history.commit(change);
    } finally {
      this.applying = false;
    }
  }

  private setSelection(items: Item[]): void {
    this.selection = items.sort(compareRenderOrder);
    this.ctx.renderer.invalidateLive();
    this.notify();
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  private finishLasso(): void {
    const zoom = this.ctx.camera.zoom;
    const pts = this.lasso;
    const lb = polylineBounds(pts);
    const isTap =
      Math.max(lb.maxX - lb.minX, lb.maxY - lb.minY) * zoom < TAP_PX;
    if (isTap) {
      const hit = this.itemAt(this.start);
      this.setSelection(hit ? [hit] : []);
      return;
    }
    const chosen = this.ctx.scene.query(lb).filter((item) => {
      if (item.type === 'image') {
        return pointInPolygon(item.x + item.w / 2, item.y + item.h / 2, pts);
      }
      // A stroke counts when at least half of it is inside the loop.
      return mostlyInside(item.points, item.origin, pts);
    });
    this.setSelection(chosen);
  }

  /** The topmost item under a point. */
  private itemAt(p: Point): Item | null {
    const slop = TAP_SLOP_PX / this.ctx.camera.zoom;
    const area = {
      minX: p.x - slop,
      minY: p.y - slop,
      maxX: p.x + slop,
      maxY: p.y + slop,
    };
    const candidates = this.ctx.scene.query(area).reverse();
    for (const item of candidates) {
      if (item.type === 'image') {
        if (inside(p, item.bounds, 0)) return item;
        continue;
      }
      const reach = (item.width / 2 + slop) ** 2;
      const pts = item.points;
      const x = p.x - item.origin.x;
      const y = p.y - item.origin.y;
      if (pts.length === 2 && (pts[0] - x) ** 2 + (pts[1] - y) ** 2 <= reach)
        return item;
      for (let i = 2; i < pts.length; i += 2) {
        if (
          distSqToSegment(x, y, pts[i - 2], pts[i - 1], pts[i], pts[i + 1]) <=
          reach
        ) {
          return item;
        }
      }
    }
    return null;
  }

  /**
   * Which corner handle a point grabs. Handles reach generously outward, but
   * inside the selection only a quarter of its size, so on small pictures
   * the middle still moves instead of resizing.
   */
  private cornerAt(p: Point, b: Bounds): { opposite: Point } | null {
    const r = HANDLE_HIT_PX / this.ctx.camera.zoom;
    const inner = Math.min(r, Math.min(b.maxX - b.minX, b.maxY - b.minY) / 4);
    const within = inside(p, b, 0);
    const corners = cornersOf(b);
    for (let i = 0; i < 4; i++) {
      const c = corners[i];
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      if (d <= (within ? inner : r)) return { opposite: corners[(i + 2) % 4] };
    }
    return null;
  }

  /** Uniform scale from dragging a corner, measured along the diagonal. */
  private scaleFor(p: Point): number {
    const v0x = this.start.x - this.anchor.x;
    const v0y = this.start.y - this.anchor.y;
    const len2 = v0x * v0x + v0y * v0y;
    if (len2 === 0) return 1;
    const s =
      ((p.x - this.anchor.x) * v0x + (p.y - this.anchor.y) * v0y) / len2;
    const b = this.startBounds!;
    const size = Math.max(b.maxX - b.minX, b.maxY - b.minY);
    const min = MIN_SIZE_PX / this.ctx.camera.zoom / Math.max(size, 1e-6);
    return Math.max(min, s);
  }

  private drawOverlay(g: CanvasRenderingContext2D): void {
    const z = this.ctx.camera.zoom;
    g.save();
    if (this.mode === 'lasso' && this.lasso.length >= 4) {
      g.beginPath();
      g.moveTo(this.lasso[0], this.lasso[1]);
      for (let i = 2; i < this.lasso.length; i += 2)
        g.lineTo(this.lasso[i], this.lasso[i + 1]);
      g.closePath();
      g.fillStyle = 'rgba(47, 111, 237, 0.07)';
      g.fill();
      g.setLineDash([6 / z, 5 / z]);
      g.lineWidth = 1.5 / z;
      g.strokeStyle = ACCENT;
      g.stroke();
    }

    if (this.selection.length) {
      if (this.mode === 'move' || this.mode === 'scale') {
        const t = this.transform;
        g.save();
        g.translate(t.ox + t.dx, t.oy + t.dy);
        g.scale(t.s, t.s);
        g.translate(-t.ox, -t.oy);
        for (const item of this.selection) drawItem(g, item, this.ctx.assets);
        g.restore();
      }
      const b = this.bounds()!;
      const pad = 6 / z;
      g.globalAlpha = 1;
      g.setLineDash([6 / z, 4 / z]);
      g.lineWidth = 1.5 / z;
      g.strokeStyle = ACCENT;
      g.strokeRect(
        b.minX - pad,
        b.minY - pad,
        b.maxX - b.minX + pad * 2,
        b.maxY - b.minY + pad * 2,
      );
      g.setLineDash([]);
      for (const c of cornersOf(b)) {
        g.beginPath();
        g.arc(c.x, c.y, HANDLE_PX / z, 0, Math.PI * 2);
        g.fillStyle = '#ffffff';
        g.fill();
        g.lineWidth = 2 / z;
        g.strokeStyle = ACCENT;
        g.stroke();
      }
    }
    g.restore();
  }
}

function cornersOf(b: Bounds): Point[] {
  return [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY },
  ];
}

function inside(p: Point, b: Bounds, pad: number): boolean {
  return (
    p.x >= b.minX - pad &&
    p.x <= b.maxX + pad &&
    p.y >= b.minY - pad &&
    p.y <= b.maxY + pad
  );
}

function polylineBounds(pts: number[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    minX = Math.min(minX, pts[i]);
    minY = Math.min(minY, pts[i + 1]);
    maxX = Math.max(maxX, pts[i]);
    maxY = Math.max(maxY, pts[i + 1]);
  }
  return { minX, minY, maxX, maxY };
}
