import { describe, expect, it } from 'vitest';
import { Camera } from '../src/renderer/engine/camera';
import { History } from '../src/renderer/engine/history';
import { createStroke, type StrokeStyle } from '../src/renderer/engine/items';
import { Scene } from '../src/renderer/engine/scene';

const pen: StrokeStyle = { kind: 'pen', color: '#000', width: 4, opacity: 1 };
const highlighter: StrokeStyle = {
  kind: 'highlighter',
  color: '#ff0',
  width: 20,
  opacity: 0.4,
};

describe('Camera', () => {
  it('round-trips between screen and world', () => {
    const cam = new Camera();
    cam.x = -300;
    cam.y = 120;
    cam.zoom = 1.75;
    const w = cam.toWorld(400, 250);
    const s = cam.toScreen(w.x, w.y);
    expect(s.x).toBeCloseTo(400);
    expect(s.y).toBeCloseTo(250);
  });

  it('zoomAt keeps the anchor fixed and clamps', () => {
    const cam = new Camera();
    const before = cam.toWorld(200, 100);
    cam.zoomAt(200, 100, 100);
    expect(cam.zoom).toBe(Camera.MAX_ZOOM);
    const after = cam.toScreen(before.x, before.y);
    expect(after.x).toBeCloseTo(200);
    expect(after.y).toBeCloseTo(100);
  });
});

describe('createStroke', () => {
  it('stores points relative to the origin with padded bounds', () => {
    const s = createStroke([1000, 2000, 1010, 1990, 1020, 2005], pen, 1);
    expect(s.origin).toEqual({ x: 1000, y: 2000 });
    expect([...s.points]).toEqual([0, 0, 10, -10, 20, 5]);
    expect(s.bounds).toEqual({ minX: 998, minY: 1988, maxX: 1022, maxY: 2007 });
  });
});

describe('Scene', () => {
  it('finds items by area, highlighters beneath ink', () => {
    const scene = new Scene();
    const ink = createStroke([0, 0, 10, 10], pen, scene.allocZ());
    const hl = createStroke([0, 5, 10, 5], highlighter, scene.allocZ());
    const far = createStroke([5000, 5000, 5010, 5010], pen, scene.allocZ());
    scene.apply({ added: [ink, hl, far], removed: [] });

    const hits = scene.query({ minX: -5, minY: -5, maxX: 20, maxY: 20 });
    expect(hits.map((i) => i.id)).toEqual([hl.id, ink.id]);
    expect(scene.contentBounds()).toEqual({
      minX: -10,
      minY: -5,
      maxX: 5012,
      maxY: 5012,
    });
  });

  it('keeps z increasing past restored items', () => {
    const scene = new Scene();
    scene.apply({ added: [createStroke([0, 0], pen, 41)], removed: [] });
    expect(scene.allocZ()).toBe(42);
  });
});

describe('History', () => {
  it('undoes and redoes, and a new edit clears redo', () => {
    const scene = new Scene();
    const history = new History(scene);
    const a = createStroke([0, 0, 5, 5], pen, scene.allocZ());
    const b = createStroke([10, 10, 15, 15], pen, scene.allocZ());
    history.commit({ added: [a], removed: [] });
    history.commit({ added: [b], removed: [] });

    history.undo();
    expect(scene.has(b.id)).toBe(false);
    history.redo();
    expect(scene.has(b.id)).toBe(true);

    history.undo();
    history.commit({
      added: [createStroke([1, 1], pen, scene.allocZ())],
      removed: [],
    });
    expect(history.canRedo).toBe(false);
  });

  it('restores erased items on undo', () => {
    const scene = new Scene();
    const history = new History(scene);
    const a = createStroke([0, 0, 5, 5], pen, scene.allocZ());
    history.commit({ added: [a], removed: [] });
    history.commit({ added: [], removed: [a] });
    expect(scene.size).toBe(0);
    history.undo();
    expect(scene.get(a.id)).toBe(a);
  });
});
