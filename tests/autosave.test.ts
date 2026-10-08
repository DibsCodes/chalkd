import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Autosave,
  CAMERA_SAVE_DELAY_MS,
  RETRY_DELAY_MS,
  SAVE_DELAY_MS,
  type SaveBackend,
} from '../src/renderer/board/autosave';
import { AssetStore } from '../src/renderer/engine/assets';
import { Camera } from '../src/renderer/engine/camera';
import type { Editor } from '../src/renderer/engine/editor';
import { History } from '../src/renderer/engine/history';
import { createStroke } from '../src/renderer/engine/items';
import { Scene } from '../src/renderer/engine/scene';
import type { BoardChanges } from '../src/shared/types';

const pen = { kind: 'pen' as const, color: '#000', width: 3, opacity: 1 };

/** Just the parts of Editor that Autosave touches. */
function fakeEditor() {
  const scene = new Scene();
  const camera = new Camera();
  const listeners = new Set<() => void>();
  const editor = {
    scene,
    camera,
    assets: new AssetStore(),
    history: new History(scene),
    onCameraChange(fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    onBackgroundChange() {
      return () => {};
    },
    moveCamera(x: number) {
      camera.x = x;
      for (const fn of listeners) fn();
    },
  };
  return editor;
}

class FakeBackend implements SaveBackend {
  writes: BoardChanges[] = [];
  failNext = false;
  async write(changes: BoardChanges) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('disk full');
    }
    this.writes.push(structuredClone(changes));
  }
  writeSync(changes: BoardChanges) {
    this.writes.push(structuredClone(changes));
    return null;
  }
}

let editor: ReturnType<typeof fakeEditor>;
let backend: FakeBackend;
let errors: unknown[];
let autosave: Autosave;

beforeEach(() => {
  vi.useFakeTimers();
  editor = fakeEditor();
  backend = new FakeBackend();
  errors = [];
  autosave = new Autosave(editor as unknown as Editor, backend, (e) =>
    errors.push(e),
  );
});
afterEach(() => vi.useRealTimers());

const stroke = () => createStroke([0, 0, 10, 10], pen, editor.scene.allocZ());

describe('Autosave', () => {
  it('batches edits and writes them after the delay', async () => {
    const a = stroke();
    const b = stroke();
    editor.history.commit({ added: [a], removed: [] });
    editor.history.commit({ added: [b], removed: [] });
    expect(backend.writes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(backend.writes).toHaveLength(1);
    expect(backend.writes[0].upserts.map((i) => i.id)).toEqual([a.id, b.id]);
  });

  it('collapses an add-then-undo into a delete of nothing new', async () => {
    const a = stroke();
    editor.history.commit({ added: [a], removed: [] });
    editor.history.undo();
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(backend.writes[0].upserts).toEqual([]);
    expect(backend.writes[0].deletes).toEqual([a.id]);
  });

  it('saves the camera, but no more than once a second while panning', async () => {
    for (let i = 0; i < 20; i++) {
      editor.moveCamera(i);
      await vi.advanceTimersByTimeAsync(50);
    }
    await vi.advanceTimersByTimeAsync(CAMERA_SAVE_DELAY_MS);
    expect(backend.writes.length).toBeGreaterThanOrEqual(1);
    expect(backend.writes.length).toBeLessThanOrEqual(2);
    expect(backend.writes.at(-1)!.meta!.camera!.x).toBe(19);
  });

  it('a stroke after a camera move is not held back by the slower camera delay', async () => {
    editor.moveCamera(5);
    editor.history.commit({ added: [stroke()], removed: [] });
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(backend.writes).toHaveLength(1);
    expect(backend.writes[0].meta?.camera?.x).toBe(5);
  });

  it('keeps failed edits and retries them', async () => {
    const a = stroke();
    backend.failNext = true;
    editor.history.commit({ added: [a], removed: [] });
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(errors).toHaveLength(1);
    expect(backend.writes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
    expect(backend.writes).toHaveLength(1);
    expect(backend.writes[0].upserts[0].id).toBe(a.id);
  });

  it('a retry does not resurrect something erased in the meantime', async () => {
    const a = stroke();
    backend.failNext = true;
    editor.history.commit({ added: [a], removed: [] });
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    editor.history.commit({ added: [], removed: [a] });
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
    const last = backend.writes.at(-1)!;
    expect(last.upserts).toEqual([]);
    expect(last.deletes).toEqual([a.id]);
  });

  it('writes new image data with the items, and retries it after a failure', async () => {
    const asset = {
      hash: 'abc',
      mime: 'image/png',
      bytes: new Uint8Array([1]),
    };
    editor.assets.add(asset);
    backend.failNext = true;
    editor.history.commit({ added: [stroke()], removed: [] });
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(backend.writes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
    expect(backend.writes[0].assets?.map((a) => a.hash)).toEqual(['abc']);
  });

  it('flushSync writes immediately on close', () => {
    editor.history.commit({ added: [stroke()], removed: [] });
    autosave.flushSync();
    expect(backend.writes).toHaveLength(1);
    expect(autosave.hasPending).toBe(false);
  });
});
