<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { PopoverSide } from './toolbar-layout';

  let {
    anchor,
    onclose,
    width = 320,
    side = 'below',
    label,
    children,
  }: {
    anchor: DOMRect;
    onclose: () => void;
    width?: number;
    /** Which side of the anchor it opens on. */
    side?: PopoverSide;
    label: string;
    children: Snippet;
  } = $props();

  const GAP = 10;
  const MARGIN = 12;
  let height = $state(0);

  const clamp = (v: number, min: number, max: number) => Math.min(Math.max(min, v), max);

  const place = $derived.by(() => {
    const W = window.innerWidth;
    const H = window.innerHeight;
    if (side === 'left' || side === 'right') {
      return {
        left: side === 'right' ? anchor.right + GAP : anchor.left - GAP - width,
        top: clamp(anchor.top + anchor.height / 2 - height / 2, MARGIN, H - height - MARGIN),
        maxHeight: H - 2 * MARGIN,
      };
    }
    const left = clamp(anchor.left + anchor.width / 2 - width / 2, MARGIN, W - width - MARGIN);
    return side === 'above'
      ? { left, bottom: H - anchor.top + GAP, maxHeight: anchor.top - GAP - MARGIN }
      : { left, top: anchor.bottom + GAP, maxHeight: H - 100 };
  });
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<!-- Any tap outside closes the popover without drawing on the board. -->
<div class="backdrop" onpointerdown={onclose} aria-hidden="true"></div>
<div
  class="popover"
  role="dialog"
  aria-label={label}
  style:left="{place.left}px"
  style:top={place.top === undefined ? null : `${place.top}px`}
  style:bottom={place.bottom === undefined ? null : `${place.bottom}px`}
  style:max-height="{place.maxHeight}px"
  style:width="{width}px"
  bind:offsetHeight={height}
>
  {@render children()}
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 35;
  }
  .popover {
    position: fixed;
    z-index: 36;
    overflow-y: auto;
    padding: 16px;
    border-radius: 16px;
    background: var(--panel-bg);
    color: var(--fg);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-lg);
  }
</style>
