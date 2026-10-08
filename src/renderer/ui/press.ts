import type { Action } from 'svelte/action';

const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE_PX = 10;

export interface PressOptions {
  onTap?: (node: HTMLElement) => void;
  onLongPress?: (node: HTMLElement) => void;
  /**
   * Lets the button be picked up and dragged: holding it `delayMs` lifts it.
   * A long-press then fires on release instead of while held, unless the
   * button was dragged.
   */
  drag?: {
    delayMs: number;
    onStart: (node: HTMLElement, x: number) => void;
    onMove: (node: HTMLElement, x: number) => void;
    /** `commit` is false when nothing moved or the system cancelled. */
    onEnd: (node: HTMLElement, commit: boolean) => void;
  };
}

/**
 * Tap vs. long-press (and optionally hold-to-drag) for touch, mouse, and
 * keyboard. Moving the finger before then (e.g. to scroll the toolbar)
 * cancels them all.
 */
export const press: Action<HTMLElement, PressOptions> = (node, initial) => {
  let opts = initial;
  let id: number | null = null;
  let start = { x: 0, y: 0 };
  let timers: ReturnType<typeof setTimeout>[] = [];
  let longFired = false;
  let lifted = false;
  let dragged = false;

  const reset = () => {
    for (const t of timers) clearTimeout(t);
    timers = [];
    id = null;
    lifted = false;
    node.classList.remove('lifted');
  };
  const down = (e: PointerEvent) => {
    if (e.button !== 0 || id !== null) return;
    id = e.pointerId;
    start = { x: e.clientX, y: e.clientY };
    longFired = false;
    dragged = false;
    timers.push(
      setTimeout(() => {
        longFired = true;
        if (!opts.drag) opts.onLongPress?.(node);
      }, LONG_PRESS_MS),
    );
    const drag = opts.drag;
    if (drag) {
      const pointer = e.pointerId;
      timers.push(
        setTimeout(() => {
          lifted = true;
          node.setPointerCapture(pointer);
          node.classList.add('lifted');
          drag.onStart(node, start.x);
        }, drag.delayMs),
      );
    }
  };
  const move = (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    const far =
      Math.hypot(e.clientX - start.x, e.clientY - start.y) > MOVE_TOLERANCE_PX;
    if (lifted) {
      dragged ||= far;
      opts.drag?.onMove(node, e.clientX);
    } else if (far) {
      reset();
    }
  };
  const up = (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    const wasLong = longFired;
    const wasLifted = lifted;
    reset();
    if (wasLifted) opts.drag?.onEnd(node, dragged);
    if (wasLifted ? !dragged : wasLong) {
      if (opts.drag) opts.onLongPress?.(node);
    } else if (!wasLong) {
      opts.onTap?.(node);
    }
  };
  const cancel = (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    const wasLifted = lifted;
    reset();
    if (wasLifted) opts.drag?.onEnd(node, false);
  };
  // Once lifted, a sideways slide drags the button rather than scrolling
  // the toolbar (which would also cancel the pointer).
  const touchMove = (e: TouchEvent) => {
    if (lifted) e.preventDefault();
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
  node.addEventListener('pointercancel', cancel);
  node.addEventListener('touchmove', touchMove, { passive: false });
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
      node.removeEventListener('pointercancel', cancel);
      node.removeEventListener('touchmove', touchMove);
      node.removeEventListener('keydown', key);
    },
  };
};
