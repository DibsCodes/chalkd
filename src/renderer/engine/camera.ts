import type { CameraState, Point } from '../../shared/types';

export type { Point } from '../../shared/types';

/**
 * Maps unbounded world coordinates to screen (CSS pixel) coordinates.
 * (x, y) is the world point shown at the screen's top-left corner.
 */
export class Camera {
  static readonly MIN_ZOOM = 0.1;
  static readonly MAX_ZOOM = 8;

  x = 0;
  y = 0;
  zoom = 1;

  toWorld(sx: number, sy: number): Point {
    return { x: sx / this.zoom + this.x, y: sy / this.zoom + this.y };
  }

  toScreen(wx: number, wy: number): Point {
    return { x: (wx - this.x) * this.zoom, y: (wy - this.y) * this.zoom };
  }

  /** Change zoom while keeping the world point under (sx, sy) fixed. */
  zoomAt(sx: number, sy: number, zoom: number): void {
    const anchor = this.toWorld(sx, sy);
    this.zoom = clampZoom(zoom);
    this.x = anchor.x - sx / this.zoom;
    this.y = anchor.y - sy / this.zoom;
  }

  panBy(dsx: number, dsy: number): void {
    this.x -= dsx / this.zoom;
    this.y -= dsy / this.zoom;
  }

  copyFrom(other: Camera): void {
    this.x = other.x;
    this.y = other.y;
    this.zoom = other.zoom;
  }

  get state(): CameraState {
    return { x: this.x, y: this.y, zoom: this.zoom };
  }

  set state(s: CameraState) {
    this.x = s.x;
    this.y = s.y;
    this.zoom = clampZoom(s.zoom);
  }

  clone(): Camera {
    const c = new Camera();
    c.copyFrom(this);
    return c;
  }
}

export function clampZoom(zoom: number): number {
  return Math.min(Camera.MAX_ZOOM, Math.max(Camera.MIN_ZOOM, zoom));
}
