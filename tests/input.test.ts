import { beforeEach, describe, expect, it } from 'vitest';
import { Camera, type Point } from '../src/renderer/engine/camera';
import {
  InputRouter,
  type InputOptions,
  type InputTarget,
  type PointerLike,
} from '../src/renderer/engine/input';

class FakeTarget implements InputTarget {
  camera = new Camera();
  log: string[] = [];
  moves: Point[] = [];
  taps: number[] = [];

  toolDown() {
    this.log.push('down');
  }
  toolMove(points: Point[]) {
    this.moves.push(...points);
    if (this.log.at(-1) !== 'move') this.log.push('move');
  }
  toolUp() {
    this.log.push('up');
  }
  toolCancel() {
    this.log.push('cancel');
  }
  cameraChanged() {}
  gestureStart() {
    this.log.push('gestureStart');
  }
  gestureEnd() {
    this.log.push('gestureEnd');
  }
  tap(n: number) {
    this.taps.push(n);
    this.log.push(`tap${n}`);
  }
}

let target: FakeTarget;
let router: InputRouter;
let clock: number;

function setup(options: Partial<InputOptions> = {}) {
  target = new FakeTarget();
  clock = 0;
  router = new InputRouter(
    target,
    { palmContactPx: null, tapGestures: true, ...options },
    () => clock,
  );
}

function ev(
  id: number,
  x: number,
  y: number,
  extra: Partial<PointerLike> = {},
): PointerLike {
  return {
    pointerId: id,
    pointerType: 'touch',
    clientX: x,
    clientY: y,
    button: 0,
    width: 1,
    height: 1,
    ...extra,
  };
}

const down = (id: number, x: number, y: number, extra?: Partial<PointerLike>) =>
  router.pointerDown(ev(id, x, y, extra));
const move = (id: number, x: number, y: number, extra?: Partial<PointerLike>) =>
  router.pointerMove(ev(id, x, y, extra));
const up = (id: number, x: number, y: number, extra?: Partial<PointerLike>) =>
  router.pointerUp(ev(id, x, y, extra), false);

beforeEach(() => setup());

describe('one finger', () => {
  it('draws a stroke', () => {
    down(1, 10, 10);
    clock = 20;
    move(1, 20, 10);
    move(1, 30, 12);
    clock = 300;
    up(1, 30, 12);
    expect(target.log).toEqual(['down', 'move', 'up']);
    expect(target.moves.at(-1)).toEqual({ x: 30, y: 12 });
  });

  it('reports tool points in world coordinates', () => {
    target.camera.x = 100;
    target.camera.y = 50;
    target.camera.zoom = 2;
    down(1, 0, 0);
    move(1, 20, 40);
    up(1, 20, 40);
    expect(target.moves).toEqual([{ x: 110, y: 70 }]);
  });

  it('uses coalesced samples when the browser provides them', () => {
    down(1, 0, 0);
    move(1, 30, 0, {
      getCoalescedEvents: () => [ev(1, 10, 0), ev(1, 20, 0), ev(1, 30, 0)],
    });
    up(1, 30, 0);
    expect(target.moves.map((p) => p.x)).toEqual([10, 20, 30]);
  });

  it('cancels the stroke when the system cancels the touch', () => {
    down(1, 0, 0);
    move(1, 50, 0);
    router.pointerUp(ev(1, 50, 0), true);
    expect(target.log).toEqual(['down', 'move', 'cancel']);
  });
});

describe('two fingers', () => {
  it('turns into pan/zoom when the second finger lands quickly', () => {
    down(1, 100, 100);
    clock = 60;
    down(2, 200, 100);
    expect(target.log).toEqual(['down', 'cancel', 'gestureStart']);

    clock = 100;
    move(1, 150, 150);
    move(2, 250, 150);
    clock = 400;
    up(1, 150, 150);
    up(2, 250, 150);
    expect(target.log).toEqual([
      'down',
      'cancel',
      'gestureStart',
      'gestureEnd',
    ]);
    // Both fingers moved +50,+50 at zoom 1: the view panned by that much.
    expect(target.camera.x).toBeCloseTo(-50);
    expect(target.camera.y).toBeCloseTo(-50);
  });

  it('pinch zooms around the midpoint between the fingers', () => {
    down(1, 100, 100);
    clock = 10;
    down(2, 200, 100);
    const anchor = target.camera.toWorld(150, 100);
    clock = 50;
    move(1, 50, 100);
    move(2, 250, 100);
    expect(target.camera.zoom).toBeCloseTo(2);
    const after = target.camera.toScreen(anchor.x, anchor.y);
    expect(after.x).toBeCloseTo(150);
    expect(after.y).toBeCloseTo(100);
  });

  it('keeps panning smoothly after one finger of a pinch lifts', () => {
    down(1, 100, 100);
    clock = 10;
    down(2, 200, 100);
    clock = 50;
    move(2, 300, 100); // zoom to 2x
    up(2, 300, 100);
    const camX = target.camera.x;
    move(1, 140, 100); // remaining finger moves 40 screen px
    expect(target.camera.zoom).toBeCloseTo(2);
    expect(target.camera.x).toBeCloseTo(camX - 40 / 2);
  });

  it('does not cancel a stroke that already traveled far', () => {
    down(1, 0, 0);
    clock = 50;
    move(1, 60, 0);
    down(2, 300, 300);
    clock = 600;
    move(1, 120, 0);
    up(2, 300, 300);
    up(1, 120, 0);
    expect(target.log).toEqual(['down', 'move', 'up']);
  });

  it('ignores a late second finger and keeps drawing', () => {
    down(1, 0, 0);
    clock = 400;
    move(1, 50, 0);
    down(2, 300, 300);
    move(2, 400, 400);
    move(1, 80, 0);
    clock = 700;
    up(1, 80, 0);
    up(2, 400, 400);
    expect(target.log).toEqual(['down', 'move', 'up']);
    expect(target.camera.x).toBe(0);
  });
});

describe('tap gestures', () => {
  it('2-finger tap → undo, leaving no stray stroke or camera change', () => {
    down(1, 100, 100);
    clock = 30;
    down(2, 180, 100);
    clock = 60;
    move(2, 183, 102); // a little jitter
    clock = 150;
    up(1, 100, 100);
    up(2, 183, 102);
    expect(target.taps).toEqual([2]);
    expect(target.log).not.toContain('up');
    expect(target.camera.x).toBe(0);
    expect(target.camera.y).toBe(0);
    expect(target.camera.zoom).toBe(1);
  });

  it('3-finger tap → redo', () => {
    down(1, 100, 100);
    clock = 20;
    down(2, 180, 100);
    clock = 40;
    down(3, 260, 100);
    clock = 160;
    up(1, 100, 100);
    up(2, 180, 100);
    up(3, 260, 100);
    expect(target.taps).toEqual([3]);
  });

  it('a slow two-finger tap still undoes and drops the dot it started', () => {
    down(1, 100, 100);
    clock = 180; // after the cancel window
    down(2, 180, 100);
    clock = 230;
    up(1, 100, 100);
    up(2, 180, 100);
    expect(target.log).toEqual(['down', 'cancel', 'tap2']);
  });

  it('is not a tap when the fingers stay down too long', () => {
    down(1, 100, 100);
    clock = 20;
    down(2, 180, 100);
    clock = 600;
    up(1, 100, 100);
    up(2, 180, 100);
    expect(target.taps).toEqual([]);
  });

  it('is not a tap when the fingers move', () => {
    down(1, 100, 100);
    clock = 20;
    down(2, 180, 100);
    clock = 80;
    move(1, 100, 140);
    clock = 150;
    up(1, 100, 140);
    up(2, 180, 100);
    expect(target.taps).toEqual([]);
  });

  it('can be turned off', () => {
    setup({ tapGestures: false });
    down(1, 100, 100);
    clock = 20;
    down(2, 180, 100);
    clock = 120;
    up(1, 100, 100);
    up(2, 180, 100);
    expect(target.taps).toEqual([]);
    expect(target.log).toEqual([
      'down',
      'cancel',
      'gestureStart',
      'gestureEnd',
    ]);
  });
});

describe('palm rejection', () => {
  it('ignores contacts larger than the threshold', () => {
    setup({ palmContactPx: 30 });
    down(9, 400, 400, { width: 60, height: 45 });
    move(9, 420, 420, { width: 60, height: 45 });
    down(1, 100, 100);
    clock = 50;
    move(1, 150, 100);
    clock = 300;
    up(1, 150, 100);
    up(9, 420, 420);
    expect(target.log).toEqual(['down', 'move', 'up']);
  });
});

describe('mouse', () => {
  it('left button draws, middle button pans', () => {
    const mouse = { pointerType: 'mouse' };
    down(1, 0, 0, mouse);
    move(1, 10, 0, mouse);
    up(1, 10, 0, mouse);
    expect(target.log).toEqual(['down', 'move', 'up']);

    down(2, 0, 0, { ...mouse, button: 1 });
    move(2, 30, 20, { ...mouse, button: 1 });
    up(2, 30, 20, { ...mouse, button: 1 });
    expect(target.camera.x).toBeCloseTo(-30);
    expect(target.camera.y).toBeCloseTo(-20);
  });

  it('cannot start a second stroke while a finger is drawing', () => {
    down(1, 0, 0);
    down(2, 5, 5, { pointerType: 'mouse' });
    clock = 300;
    up(2, 5, 5, { pointerType: 'mouse' });
    up(1, 0, 0);
    expect(target.log).toEqual(['down', 'up']);
  });
});
