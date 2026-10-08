import { clampZoom, type Camera, type Point } from './camera';

// PLAN.md › Input model.
export const CANCEL_WINDOW_MS = 150;
export const CANCEL_TRAVEL_PX = 24;
const WHEEL_IDLE_MS = 150;

/** What the router drives. Tool points are in world coordinates. */
export interface InputTarget {
  readonly camera: Camera;
  toolDown(p: Point): void;
  toolMove(points: Point[]): void;
  toolUp(): void;
  toolCancel(): void;
  cameraChanged(): void;
  gestureStart(): void;
  gestureEnd(): void;
}

export interface InputOptions {
  /** Ignore touches whose reported contact is wider than this (CSS px). */
  palmContactPx: number | null;
}

/** The subset of PointerEvent the router reads; lets tests feed fakes. */
export interface PointerLike {
  pointerId: number;
  pointerType: string;
  clientX: number;
  clientY: number;
  button: number;
  width: number;
  height: number;
  getCoalescedEvents?(): PointerLike[];
}

interface Track {
  startX: number;
  startY: number;
  x: number;
  y: number;
}

/** One touch interaction: from the first finger down to the last finger up. */
interface Sequence {
  startAt: number;
  mode: 'draw' | 'gesture';
  drawId: number;
  /** The tool has an open stroke that still needs toolUp/toolCancel. */
  toolOpen: boolean;
  drawLifted: boolean;
}

interface GestureBase {
  centroid: Point;
  dist: number | null;
  cam: { x: number; y: number; zoom: number };
}

/**
 * Turns raw pointer events into tool strokes, camera moves, and tap gestures.
 * 1 finger = tool; 2 fingers = pan + pinch; quick 2/3-finger taps = undo/redo.
 */
export class InputRouter {
  private touches = new Map<number, Track>();
  private palms = new Set<number>();
  private seq: Sequence | null = null;
  private base: GestureBase | null = null;
  private toolPointer: number | null = null;
  private panPointer: { id: number; x: number; y: number } | null = null;
  private wheelTimer: ReturnType<typeof setTimeout> | null = null;
  private detach: (() => void) | null = null;
  /** Top-left of the board element in the window; pointer coords are relative to it. */
  private offset = { x: 0, y: 0 };

  constructor(
    private target: InputTarget,
    public options: InputOptions,
    private now: () => number = () => performance.now(),
  ) {}

  attach(el: HTMLElement): void {
    const measure = () => {
      const r = el.getBoundingClientRect();
      this.offset = { x: r.left, y: r.top };
    };
    const down = (e: PointerEvent) => {
      if (!this.busy) measure();
      el.setPointerCapture(e.pointerId);
      this.pointerDown(e);
    };
    const move = (e: PointerEvent) => this.pointerMove(e);
    const up = (e: PointerEvent) => this.pointerUp(e, false);
    const cancel = (e: PointerEvent) => this.pointerUp(e, true);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      measure();
      this.wheel(e);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('wheel', wheel, { passive: false });
    this.detach = () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
      el.removeEventListener('wheel', wheel);
    };
  }

  dispose(): void {
    this.detach?.();
    if (this.wheelTimer) clearTimeout(this.wheelTimer);
  }

  get busy(): boolean {
    return (
      this.seq !== null || this.toolPointer !== null || this.panPointer !== null
    );
  }

  pointerDown(e: PointerLike): void {
    if (e.pointerType === 'touch') this.touchDown(e);
    else this.mouseDown(e);
  }

  pointerMove(e: PointerLike): void {
    if (e.pointerType === 'touch') {
      this.touchMove(e);
    } else if (e.pointerId === this.toolPointer) {
      this.target.toolMove(this.worldSamples(e));
    } else if (this.panPointer && e.pointerId === this.panPointer.id) {
      this.target.camera.panBy(
        e.clientX - this.panPointer.x,
        e.clientY - this.panPointer.y,
      );
      this.panPointer.x = e.clientX;
      this.panPointer.y = e.clientY;
      this.target.cameraChanged();
    }
  }

  pointerUp(e: PointerLike, cancelled: boolean): void {
    if (e.pointerType === 'touch') {
      this.touchUp(e, cancelled);
    } else if (e.pointerId === this.toolPointer) {
      this.toolPointer = null;
      if (cancelled) this.target.toolCancel();
      else this.target.toolUp();
    } else if (this.panPointer && e.pointerId === this.panPointer.id) {
      this.panPointer = null;
      this.target.gestureEnd();
    }
  }

  wheel(e: {
    clientX: number;
    clientY: number;
    deltaX: number;
    deltaY: number;
    ctrlKey: boolean;
  }): void {
    if (this.seq || this.toolPointer !== null) return;
    if (this.wheelTimer) clearTimeout(this.wheelTimer);
    else this.target.gestureStart();
    const cam = this.target.camera;
    const sx = e.clientX - this.offset.x;
    const sy = e.clientY - this.offset.y;
    if (e.ctrlKey) {
      // Ctrl+wheel is also what a touchpad pinch produces: many small deltas
      // instead of a few big mouse-wheel notches, so it needs more gain.
      const gain = Math.abs(e.deltaY) >= 50 ? 0.002 : 0.01;
      cam.zoomAt(sx, sy, cam.zoom * Math.exp(-e.deltaY * gain));
    } else {
      cam.panBy(-e.deltaX, -e.deltaY);
    }
    this.target.cameraChanged();
    this.wheelTimer = setTimeout(() => {
      this.wheelTimer = null;
      this.target.gestureEnd();
    }, WHEEL_IDLE_MS);
  }

  // ---------- mouse & pen ----------

  private mouseDown(e: PointerLike): void {
    if (this.busy) return;
    if (e.button === 0) {
      this.toolPointer = e.pointerId;
      this.target.toolDown(this.world(e));
    } else if (e.button === 1) {
      this.panPointer = { id: e.pointerId, x: e.clientX, y: e.clientY };
      this.target.gestureStart();
    }
  }

  // ---------- touch ----------

  private touchDown(e: PointerLike): void {
    const palm = this.options.palmContactPx;
    if (palm !== null && Math.max(e.width, e.height) > palm) {
      this.palms.add(e.pointerId);
      return;
    }
    if (!this.seq && (this.toolPointer !== null || this.panPointer)) return;

    const x = e.clientX - this.offset.x;
    const y = e.clientY - this.offset.y;
    this.touches.set(e.pointerId, { startX: x, startY: y, x, y });

    const seq = this.seq;
    if (!seq) {
      this.seq = {
        startAt: this.now(),
        mode: 'draw',
        drawId: e.pointerId,
        toolOpen: true,
        drawLifted: false,
      };
      this.target.toolDown(this.world(e));
      return;
    }

    if (seq.mode === 'gesture') {
      this.resetBase();
    } else if (
      !seq.drawLifted &&
      this.now() - seq.startAt < CANCEL_WINDOW_MS &&
      this.travel(seq.drawId) < CANCEL_TRAVEL_PX
    ) {
      // A second finger arrived quickly: this was a gesture all along.
      this.target.toolCancel();
      seq.toolOpen = false;
      seq.mode = 'gesture';
      this.target.gestureStart();
      this.resetBase();
    }
    // Otherwise a late finger while drawing is ignored.
  }

  private touchMove(e: PointerLike): void {
    const t = this.touches.get(e.pointerId);
    const seq = this.seq;
    if (!t || !seq) return;
    t.x = e.clientX - this.offset.x;
    t.y = e.clientY - this.offset.y;

    if (seq.mode === 'draw') {
      if (e.pointerId === seq.drawId && !seq.drawLifted) {
        this.target.toolMove(this.worldSamples(e));
      }
    } else {
      this.applyGesture();
    }
  }

  private touchUp(e: PointerLike, cancelled: boolean): void {
    if (this.palms.delete(e.pointerId)) return;
    const seq = this.seq;
    if (!seq || !this.touches.delete(e.pointerId)) return;

    if (seq.mode === 'draw' && e.pointerId === seq.drawId) {
      seq.drawLifted = true;
      if (cancelled && seq.toolOpen) {
        this.target.toolCancel();
        seq.toolOpen = false;
      }
      // A clean lift is committed when the sequence ends.
    } else if (seq.mode === 'gesture') {
      this.resetBase();
    }

    if (this.touches.size === 0) this.endSequence();
  }

  private endSequence(): void {
    const seq = this.seq!;
    this.seq = null;
    this.base = null;

    if (seq.toolOpen) this.target.toolUp();
    if (seq.mode === 'gesture') this.target.gestureEnd();
  }

  private resetBase(): void {
    const pts = [...this.touches.values()].slice(0, 2);
    if (pts.length === 0) {
      this.base = null;
      return;
    }
    const cam = this.target.camera;
    this.base = {
      centroid: centroid(pts),
      dist: pts.length === 2 ? distance(pts[0], pts[1]) : null,
      cam: { x: cam.x, y: cam.y, zoom: cam.zoom },
    };
  }

  private applyGesture(): void {
    const base = this.base;
    if (!base) return;
    const pts = [...this.touches.values()].slice(0, 2);
    if (pts.length === 0) return;
    const c = centroid(pts);
    const zoom =
      pts.length === 2 && base.dist
        ? clampZoom(base.cam.zoom * (distance(pts[0], pts[1]) / base.dist))
        : base.cam.zoom;
    // Keep the world point that was under the starting centroid under the
    // current centroid: one rule gives pan and pinch together.
    const ax = base.centroid.x / base.cam.zoom + base.cam.x;
    const ay = base.centroid.y / base.cam.zoom + base.cam.y;
    const cam = this.target.camera;
    cam.zoom = zoom;
    cam.x = ax - c.x / zoom;
    cam.y = ay - c.y / zoom;
    this.target.cameraChanged();
  }

  private travel(id: number): number {
    const t = this.touches.get(id);
    return t ? Math.hypot(t.x - t.startX, t.y - t.startY) : 0;
  }

  private world(e: PointerLike): Point {
    return this.target.camera.toWorld(
      e.clientX - this.offset.x,
      e.clientY - this.offset.y,
    );
  }

  private worldSamples(e: PointerLike): Point[] {
    const samples = e.getCoalescedEvents?.() ?? [];
    return (samples.length ? samples : [e]).map((s) => this.world(s));
  }
}

function centroid(pts: { x: number; y: number }[]): Point {
  if (pts.length === 1) return { x: pts[0].x, y: pts[0].y };
  return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
}

function distance(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
