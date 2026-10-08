import { describe, expect, it } from 'vitest';
import { AssetStore } from '../src/renderer/engine/assets';
import { Camera } from '../src/renderer/engine/camera';
import { History } from '../src/renderer/engine/history';
import {
  createImage,
  createStroke,
  transformItem,
  type ImageItem,
  type StrokeItem,
} from '../src/renderer/engine/items';
import type { Renderer } from '../src/renderer/engine/renderer';
import { Scene } from '../src/renderer/engine/scene';
import {
  pointInPolygon,
  SelectTool,
} from '../src/renderer/engine/tools/select';

const pen = { kind: 'pen' as const, color: '#000', width: 4, opacity: 1 };

function setup() {
  const scene = new Scene();
  const history = new History(scene);
  const camera = new Camera();
  let hidden: string[] = [];
  const renderer = {
    setLive() {},
    invalidateLive() {},
    setHidden(ids: Iterable<string>) {
      hidden = [...ids];
    },
  } as unknown as Renderer;
  const tool = new SelectTool({
    scene,
    history,
    camera,
    renderer,
    assets: new AssetStore(),
  });
  // A short line at (0..40, 0), a picture at (100,100) 50×50, a line far away.
  const line = createStroke([0, 0, 20, 0, 40, 0], pen, scene.allocZ());
  const pic = createImage('h', 100, 100, 50, 50, scene.allocZ());
  const far = createStroke([500, 500, 520, 500], pen, scene.allocZ());
  history.commit({ added: [line, pic, far], removed: [] });
  return { scene, history, camera, tool, line, pic, far, hidden: () => hidden };
}

/** Drag the tool through these points. */
function gesture(tool: SelectTool, pts: [number, number][]) {
  tool.down({ x: pts[0][0], y: pts[0][1] });
  tool.move(pts.slice(1).map(([x, y]) => ({ x, y })));
  tool.up();
}

describe('transformItem', () => {
  it('moves and scales strokes, including their width and bounds', () => {
    const s = createStroke([10, 10, 20, 10], pen, 1);
    const t = transformItem(s, {
      dx: 5,
      dy: 0,
      s: 2,
      ox: 10,
      oy: 10,
    }) as StrokeItem;
    expect(t.id).toBe(s.id);
    expect(t.origin).toEqual({ x: 15, y: 10 });
    expect([...t.points]).toEqual([0, 0, 20, 0]);
    expect(t.width).toBe(8);
    expect(t.bounds).toEqual({ minX: 11, minY: 6, maxX: 39, maxY: 14 });
  });

  it('moves and scales images', () => {
    const i = createImage('h', 0, 0, 10, 20, 1);
    const t = transformItem(i, {
      dx: 0,
      dy: 0,
      s: 3,
      ox: 0,
      oy: 0,
    }) as ImageItem;
    expect([t.x, t.y, t.w, t.h]).toEqual([0, 0, 30, 60]);
    expect(t.bounds).toEqual({ minX: 0, minY: 0, maxX: 30, maxY: 60 });
  });
});

describe('pointInPolygon', () => {
  it('handles a square', () => {
    const sq = [0, 0, 10, 0, 10, 10, 0, 10];
    expect(pointInPolygon(5, 5, sq)).toBe(true);
    expect(pointInPolygon(15, 5, sq)).toBe(false);
  });
});

describe('SelectTool', () => {
  it('lasso selects what it surrounds', () => {
    const { tool, line, pic } = setup();
    gesture(tool, [
      [-10, -10],
      [200, -10],
      [200, 200],
      [-10, 200],
      [-10, -10],
    ]);
    expect(tool.selected.map((i) => i.id).sort()).toEqual(
      [line.id, pic.id].sort(),
    );
  });

  it('a stroke only half inside the loop still counts, a sliver does not', () => {
    const { tool, line } = setup();
    gesture(tool, [
      [-10, -10],
      [25, -10],
      [25, 10],
      [-10, 10],
    ]); // covers 0..25 of 0..40
    expect(tool.selected.map((i) => i.id)).toEqual([line.id]);
    gesture(tool, [[300, 300]]); // tap empty space to clear first
    gesture(tool, [
      [35, -10],
      [60, -10],
      [60, 10],
      [35, 10],
    ]); // covers 35..40 only
    expect(tool.selected).toEqual([]);
  });

  it('tapping an item selects just it; tapping empty space clears', () => {
    const { tool, pic } = setup();
    gesture(tool, [[120, 120]]);
    expect(tool.selected.map((i) => i.id)).toEqual([pic.id]);
    gesture(tool, [[300, 300]]);
    expect(tool.selected).toEqual([]);
  });

  it('dragging the selection moves it as one undoable step', () => {
    const { tool, scene, history, pic, hidden } = setup();
    gesture(tool, [[120, 120]]);
    tool.down({ x: 120, y: 120 });
    tool.move([{ x: 150, y: 130 }]);
    expect(hidden()).toEqual([pic.id]); // previewed, not yet committed
    expect((scene.get(pic.id) as ImageItem).x).toBe(100);
    tool.up();
    expect(hidden()).toEqual([]);
    expect((scene.get(pic.id) as ImageItem).x).toBe(130);
    expect(tool.selected.map((i) => i.id)).toEqual([pic.id]); // still selected

    history.undo();
    expect((scene.get(pic.id) as ImageItem).x).toBe(100);
    expect(tool.selected).toEqual([]); // the moved copy is gone
  });

  it('dragging a corner resizes around the opposite corner', () => {
    const { tool, scene, pic } = setup();
    gesture(tool, [[120, 120]]);
    // Bottom-right handle at (150,150); drag it to (200,200): double size.
    gesture(tool, [
      [150, 150],
      [200, 200],
    ]);
    const p = scene.get(pic.id) as ImageItem;
    expect([p.x, p.y, p.w, p.h]).toEqual([100, 100, 100, 100]);
  });

  it('on a small selection, dragging the middle still moves rather than resizes', () => {
    const { tool, scene, pic } = setup();
    gesture(tool, [[120, 120]]);
    gesture(tool, [
      [118, 118],
      [128, 118],
    ]); // ~25px from a corner, inside a 50px picture
    const p = scene.get(pic.id) as ImageItem;
    expect([p.x, p.w]).toEqual([110, 50]);
  });

  it('cannot be shrunk to nothing', () => {
    const { tool, scene, pic } = setup();
    gesture(tool, [[120, 120]]);
    gesture(tool, [
      [150, 150],
      [90, 90],
    ]); // past the anchor
    expect((scene.get(pic.id) as ImageItem).w).toBeGreaterThan(10);
  });

  it('a cancelled drag (second finger) leaves everything in place', () => {
    const { tool, scene, pic, hidden } = setup();
    gesture(tool, [[120, 120]]);
    tool.down({ x: 120, y: 120 });
    tool.move([{ x: 300, y: 300 }]);
    tool.cancel();
    expect((scene.get(pic.id) as ImageItem).x).toBe(100);
    expect(hidden()).toEqual([]);
  });

  it('deletes the selection as one step', () => {
    const { tool, scene, history, line, pic } = setup();
    gesture(tool, [
      [-10, -10],
      [200, -10],
      [200, 200],
      [-10, 200],
    ]);
    tool.deleteSelection();
    expect(scene.size).toBe(1);
    history.undo();
    expect(scene.has(line.id) && scene.has(pic.id)).toBe(true);
  });
});
