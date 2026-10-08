<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    anchor,
    onclose,
    width = 320,
    label,
    children,
  }: {
    anchor: DOMRect;
    onclose: () => void;
    width?: number;
    label: string;
    children: Snippet;
  } = $props();

  const GAP = 10;
  const MARGIN = 12;
  const left = $derived(
    Math.min(
      Math.max(MARGIN, anchor.left + anchor.width / 2 - width / 2),
      window.innerWidth - width - MARGIN,
    ),
  );
  const top = $derived(anchor.bottom + GAP);
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<!-- Any tap outside closes the popover without drawing on the board. -->
<div class="backdrop" onpointerdown={onclose} aria-hidden="true"></div>
<div
  class="popover"
  role="dialog"
  aria-label={label}
  style:left="{left}px"
  style:top="{top}px"
  style:width="{width}px"
>
  {@render children()}
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 20;
  }
  .popover {
    position: fixed;
    z-index: 21;
    max-height: calc(100vh - 100px);
    overflow-y: auto;
    padding: 16px;
    border-radius: 16px;
    background: var(--panel-bg);
    color: var(--fg);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-lg);
  }
</style>
