import type { Camera, Point } from '../camera';
import type { History } from '../history';
import type { Renderer } from '../renderer';
import type { Scene } from '../scene';

export interface ToolContext {
  scene: Scene;
  history: History;
  renderer: Renderer;
  camera: Camera;
}

/** A tool receives one stroke-shaped interaction at a time, in world space. */
export interface Tool {
  down(p: Point): void;
  move(points: Point[]): void;
  up(): void;
  /** Abandon the interaction without changing the board. */
  cancel(): void;
}
