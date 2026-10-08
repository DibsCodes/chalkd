import type { Action } from 'svelte/action';

const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE_PX = 10;

export interface PressOptions {
  onTap?: (node: HTMLElement) => void;
  onLongPress?: (node: HTMLElement) => void;
}

/**
 * Tap vs. long-press for touch, mouse, and keyboard. Moving the finger
 * (e.g. to scroll the toolbar) cancels both.
 */
export const press: Action<HTMLElement, PressOptions> = (node, initial) => {
  let opts = initial;
  let id: number | null = null;
  let start = { x: 0, y: 0 };
  let timer: ReturnType<typeof setTimeout> | null = null;
  let longFired = false;

  const reset = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    id = null;
  };
  const down = (e: PointerEvent) => {
    if (e.button !== 0 || id !== null) return;
    id = e.pointerId;
    start = { x: e.clientX, y: e.clientY };
    longFired = false;
    timer = setTimeout(() => {
      timer = null;
      longFired = true;
      opts.onLongPress?.(node);
    }, LONG_PRESS_MS);
  };
  const move = (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    if (
      Math.hypot(e.clientX - start.x, e.clientY - start.y) > MOVE_TOLERANCE_PX
    )
      reset();
  };
  const up = (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    const wasLong = longFired;
    reset();
    if (!wasLong) opts.onTap?.(node);
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      opts.onTap?.(node);
    } else if (e.key === 'ContextMenu') {
      e.preventDefault();
      opts.onLongPress?.(node);
    }
  };

  node.addEventListener('pointerdown', down);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', up);
  node.addEventListener('pointercancel', reset);
  node.addEventListener('keydown', key);
  return {
    update(next) {
      opts = next;
    },
    destroy() {
      reset();
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointercancel', reset);
      node.removeEventListener('keydown', key);
    },
  };
};
