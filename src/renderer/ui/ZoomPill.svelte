<script lang="ts">
  import { board } from '../state/board.svelte';

  let open = $state(false);

  function pick(action: () => void) {
    open = false;
    action();
  }
</script>

<div class="zoom">
  {#if open}
    <div class="backdrop" onpointerdown={() => (open = false)} aria-hidden="true"></div>
    <div class="menu" role="menu">
      <button type="button" role="menuitem" onclick={() => pick(() => board.editor?.zoomToActual())}>
        100%
      </button>
      <button type="button" role="menuitem" onclick={() => pick(() => board.editor?.fitContent())}>
        Fit content
      </button>
    </div>
  {/if}
  <button
    type="button"
    class="readout"
    aria-label="Zoom {Math.round(board.zoom * 100)}%"
    aria-expanded={open}
    onclick={() => (open = !open)}
  >
    {Math.round(board.zoom * 100)}%
  </button>
</div>

<style>
  .zoom {
    position: absolute;
    right: 16px;
    bottom: 16px;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
    z-index: 6;
  }
  .backdrop {
    position: fixed;
    inset: 0;
  }
  .readout,
  .menu {
    position: relative;
    background: var(--chrome-bg);
    color: var(--fg);
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
  }
  .readout {
    min-width: 72px;
    height: var(--touch-target);
    padding: 0 14px;
    border-radius: 24px;
    font: 600 15px/1 system-ui, sans-serif;
    font-variant-numeric: tabular-nums;
  }
  .menu {
    display: flex;
    flex-direction: column;
    padding: 6px;
    border-radius: 14px;
  }
  .menu button {
    height: var(--touch-target);
    padding: 0 18px;
    border: 0;
    border-radius: 10px;
    background: none;
    color: inherit;
    font: 500 15px/1 system-ui, sans-serif;
    text-align: left;
  }
  .menu button:active,
  .readout:active {
    background: var(--hover);
  }
</style>
