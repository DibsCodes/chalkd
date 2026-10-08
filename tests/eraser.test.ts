import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssetStore } from '../src/renderer/engine/assets';
import { Camera } from '../src/renderer/engine/camera';
import {
  cutPolyline,
  findLoop,
  polylineHits,
  Smoother,
} from '../src/renderer/engine/geometry';
import { History } from '../src/renderer/engine/history';
import {
  createImage,
  createStroke,
  type StrokeItem,
} from '../src/renderer/engine/items';
import type { Point } from '../src/renderer/engine/camera';
import type { Renderer } from '../src/renderer/engine/renderer';
import { Scene } from '../src/renderer/engine/scene';
import { EraserTool } from '../src/renderer/engine/tools/eraser';

const pen = { kind: 'pen' as const, color: '#000', width: 4, opacity: 1 };

/** A horizontal line from x=0 to x=100 at y=0, one point every 10 units. */
function line(): number[] {
  const pts: number[] = [];
  for (let x = 0; x <= 100; x += 10) pts.push(x, 0);
  return pts;
}

describe('cutPolyline', () => {
  it('splits a line where the eraser crosses it', () => {
    const runs = cutPolyline(line(), 50, -20, 50, 20, 5)!;
    expect(runs).toHaveLength(2);
    const leftEnd = runs[0].at(-2)!;
    const rightStart = runs[1][0];
    // Cut edges sit close to the eraser's edge (45 and 55), not at the
    // original 10-unit point spacing.
    expect(leftEnd).toBeGreaterThan(42);
    expect(leftEnd).toBeLessThan(45);
    expect(rightStart).toBeGreaterThan(55);
    expect(rightStart).toBeLessThan(58);
  });

  it('keeps untouched points exactly', () => {
    const runs = cutPolyline(line(), 95, -20, 95, 20, 3)!;
    expect(runs[0].slice(0, 10)).toEqual([0, 0, 10, 0, 20, 0, 30, 0, 40, 0]);
  });

  it('returns null when nothing is hit, [] when everything is', () => {
    expect(cutPolyline(line(), 50, 30, 60, 30, 5)).toBeNull();
    expect(cutPolyline(line(), -10, 0, 110, 0, 5)).toEqual([]);
  });

  it('erases a single-point dot', () => {
    expect(cutPolyline([5, 5], 6, 6, 6, 6, 3)).toEqual([]);
  });
});

describe('polylineHits', () => {
  it('detects a fast swipe that jumps clean over a line', () => {
    expect(polylineHits(line(), 50, -100, 50, 100, 1)).toBe(true);
    expect(polylineHits(line(), 50, 10, 50, 100, 1)).toBe(false);
  });
});

describe('Smoother', () => {
  it('passes the first point through and drags later ones toward input', () => {
    const s = new Smoother(0.5);
    expect(s.push({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    const p = s.push({ x: 10, y: 0 })!;
    expect(p.x).toBeGreaterThan(0);
    expect(p.x).toBeLessThan(10);
  });

  it('strength 0 is raw input', () => {
    const s = new Smoother(0);
    s.push({ x: 0, y: 0 });
    expect(s.push({ x: 10, y: 4 })).toEqual({ x: 10, y: 4 });
  });
});

describe('EraserTool', () => {
  function setup(mode: 'partial' | 'stroke') {
    const scene = new Scene();
    const history = new History(scene);
    const camera = new Camera();
    const renderer = {
      setLive() {},
      invalidateLive() {},
    } as unknown as Renderer;
    const tool = new EraserTool(
      { scene, history, camera, renderer, assets: new AssetStore() },
      { mode, size: 10 },
    );
    const a = createStroke(line(), pen, scene.allocZ());
    const b = createStroke([0, 200, 100, 200], pen, scene.allocZ());
    history.commit({ added: [a, b], removed: [] });
    return { scene, history, tool, a, b };
  }

  it('partial erase splits the stroke and undoes in one step', () => {
    const { scene, history, tool, a, b } = setup('partial');
    tool.down({ x: 50, y: -30 });
    tool.move([
      { x: 50, y: 0 },
      { x: 50, y: 30 },
    ]);
    tool.up();

    expect(scene.has(a.id)).toBe(false);
    const pieces = scene.all().filter((i) => i.id !== b.id) as StrokeItem[];
    expect(pieces).toHaveLength(2);
    for (const p of pieces) expect(p.color).toBe('#000');

    history.undo();
    expect(
      scene
        .all()
        .map((i) => i.id)
        .sort(),
    ).toEqual([a.id, b.id].sort());
    history.redo();
    expect(scene.size).toBe(3);
  });

  it('erasing a piece made earlier in the same gesture stays one clean step', () => {
    const { scene, history, tool, a, b } = setup('partial');
    tool.down({ x: 50, y: -30 });
    tool.move([
      { x: 50, y: 30 },
      { x: 80, y: 30 },
      { x: 80, y: -30 },
    ]);
    tool.up();
    expect(scene.size).toBe(4); // b + three pieces of a
    history.undo();
    expect(
      scene
        .all()
        .map((i) => i.id)
        .sort(),
    ).toEqual([a.id, b.id].sort());
  });

  it('stroke mode removes whole strokes', () => {
    const { scene, tool, a, b } = setup('stroke');
    tool.down({ x: 30, y: -20 });
    tool.move([{ x: 30, y: 20 }]);
    tool.up();
    expect(scene.all().map((i) => i.id)).toEqual([b.id]);
    expect(scene.has(a.id)).toBe(false);
  });

  it('leaves images alone', () => {
    const { scene, history, tool } = setup('stroke');
    const img = createImage('h', 40, -10, 20, 20, scene.allocZ());
    history.commit({ added: [img], removed: [] });
    tool.down({ x: 50, y: -30 });
    tool.move([{ x: 50, y: 30 }]);
    tool.up();
    expect(scene.has(img.id)).toBe(true);
  });

  it('cancel restores the board exactly', () => {
    const { scene, history, tool, a, b } = setup('partial');
    tool.down({ x: 50, y: -30 });
    tool.move([{ x: 50, y: 30 }]);
    tool.cancel();
    expect(
      scene
        .all()
        .map((i) => i.id)
        .sort(),
    ).toEqual([a.id, b.id].sort());
    expect(history.canRedo).toBe(false);
    history.undo(); // only the original commit is on the stack
    expect(scene.size).toBe(0);
  });

  it('eraser size is in screen pixels, so it covers more board when zoomed out', () => {
    const { scene, tool, a } = setup('stroke');
    (tool as unknown as { ctx: { camera: Camera } }).ctx.camera.zoom = 0.25;
    // 10 px eraser at 25% zoom = 20 board units radius: reaches y=0 from y=21.
    tool.down({ x: 50, y: 21 });
    tool.up();
    expect(scene.has(a.id)).toBe(false);
  });
});

/** Points around a circle, starting at the top, `turns` times round. */
function circle(cx: number, cy: number, r: number, turns = 1): Point[] {
  const pts: Point[] = [];
  const steps = Math.round(36 * turns);
  for (let i = 0; i <= steps; i++) {
    const a = -Math.PI / 2 + (i / 36) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}

const flat = (pts: Point[]) => pts.flatMap((p) => [p.x, p.y]);

describe('findLoop', () => {
  it('finds a closed circle', () => {
    expect(findLoop(flat(circle(0, 0, 100)), 40, 60)).not.toBeNull();
  });

  it('accepts a circle that stops short or overshoots', () => {
    expect(findLoop(flat(circle(0, 0, 100, 0.95)), 40, 60)).not.toBeNull();
    expect(findLoop(flat(circle(0, 0, 100, 1.3)), 40, 60)).not.toBeNull();
  });

  it('ignores open arcs, straight lines, and tiny loops', () => {
    expect(findLoop(flat(circle(0, 0, 100, 0.6)), 40, 60)).toBeNull();
    expect(
      findLoop(
        line().map((v) => v * 3),
        40,
        60,
      ),
    ).toBeNull();
    expect(findLoop(flat(circle(0, 0, 20)), 40, 60)).toBeNull();
  });

  it('ignores back-and-forth scrubbing', () => {
    const scrub: number[] = [];
    for (let i = 0; i < 6; i++) scrub.push(0, i * 4, 300, i * 4 + 2);
    expect(findLoop(scrub, 40, 60)).toBeNull();
  });
});

describe('EraserTool loop erase', () => {
  afterEach(() => vi.useRealTimers());

  function setup(mode: 'partial' | 'stroke' = 'partial') {
    const scene = new Scene();
    const history = new History(scene);
    const camera = new Camera();
    const renderer = {
      setLive() {},
      invalidateLive() {},
    } as unknown as Renderer;
    const tool = new EraserTool(
      { scene, history, camera, renderer, assets: new AssetStore() },
      { mode, size: 10 },
    );
    // `inner` sits in the middle of the loop; `outer` is well away from it.
    const inner = createStroke([20, 190, 80, 210], pen, scene.allocZ());
    const outer = createStroke(line(), pen, scene.allocZ());
    history.commit({ added: [inner, outer], removed: [] });
    return { scene, history, tool, inner, outer };
  }

  function gesture(tool: EraserTool, pts: Point[]) {
    tool.down(pts[0]);
    tool.move(pts.slice(1));
    tool.up();
  }

  const tap = (tool: EraserTool, p: Point) => gesture(tool, [p]);

  it('a loop then a tap inside erases what it encloses, as one undo step', () => {
    const { scene, history, tool, inner, outer } = setup();
    gesture(tool, circle(50, 200, 80));
    expect(tool.armed).toBe(true);
    expect(scene.has(inner.id)).toBe(true);

    tap(tool, { x: 50, y: 240 });
    expect(tool.armed).toBe(false);
    expect(scene.has(inner.id)).toBe(false);
    expect(scene.has(outer.id)).toBe(true);

    history.undo();
    expect(scene.has(inner.id)).toBe(true);
    tool.dispose();
  });

  it('erases the inside of ink the loop cuts across, keeping the outside', () => {
    const { scene, history, tool } = setup();
    const long = createStroke([-100, 260, 200, 260], pen, scene.allocZ());
    history.commit({ added: [long], removed: [] });
    gesture(tool, circle(50, 200, 80));
    // The loop itself cut `long` into three pieces.
    const pieces = () =>
      scene.all().filter((i) => i.id !== long.id && i.bounds.minY >= 250);
    expect(pieces()).toHaveLength(3);

    tap(tool, { x: 50, y: 230 });
    const left = pieces();
    expect(left).toHaveLength(2);
    expect(left.every((i) => i.bounds.minX > 110 || i.bounds.maxX < -10)).toBe(
      true,
    );
    tool.dispose();
  });

  it('does nothing around empty board', () => {
    const { tool } = setup();
    gesture(tool, circle(500, 500, 80));
    expect(tool.armed).toBe(false);
  });

  it('touching outside the loop erases normally and drops the loop', () => {
    const { scene, tool, inner, outer } = setup('stroke');
    gesture(tool, circle(50, 200, 80));
    tap(tool, { x: 50, y: 0 });
    expect(tool.armed).toBe(false);
    expect(scene.has(outer.id)).toBe(false);
    expect(scene.has(inner.id)).toBe(true);
  });

  it('dragging inside the loop erases normally', () => {
    const { scene, tool, inner } = setup('stroke');
    const stray = createStroke([40, 160, 60, 160], pen, scene.allocZ());
    scene.apply({ added: [stray], removed: [] });
    gesture(tool, circle(50, 200, 80));
    gesture(tool, [
      { x: 50, y: 150 },
      { x: 50, y: 170 },
    ]);
    expect(scene.has(stray.id)).toBe(false);
    expect(scene.has(inner.id)).toBe(true);
    expect(tool.armed).toBe(false);
  });

  it('a pan or zoom keeps the loop waiting', () => {
    const { scene, tool, inner } = setup();
    gesture(tool, circle(50, 200, 80));
    tool.down({ x: 50, y: 240 });
    tool.cancel(); // second finger arrived
    expect(tool.armed).toBe(true);
    tap(tool, { x: 50, y: 240 });
    expect(scene.has(inner.id)).toBe(false);
  });

  it('the loop goes away on its own after a few seconds', () => {
    vi.useFakeTimers();
    const { scene, tool, inner } = setup();
    gesture(tool, circle(50, 200, 80));
    vi.advanceTimersByTime(7000);
    expect(tool.armed).toBe(false);
    tap(tool, { x: 50, y: 240 });
    expect(scene.has(inner.id)).toBe(true);
  });
});
