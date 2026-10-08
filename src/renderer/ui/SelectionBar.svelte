<script lang="ts">
  import { board } from '../state/board.svelte';
  import Icon from './Icon.svelte';

  const BAR_H = 52;
  const GAP = 18;

  /** Above the selection, or below it if there's no room at the top. */
  const pos = $derived.by(() => {
    const s = board.selection;
    if (!s) return null;
    const above = s.y - GAP - BAR_H;
    return {
      left: s.x + s.w / 2,
      top: above >= 8 ? above : s.y + s.h + GAP,
    };
  });
</script>

{#if pos && board.selection}
  <div class="bar" style:left="{pos.left}px" style:top="{pos.top}px" role="toolbar" aria-label="Selection">
    <span class="count">{board.selection.count} selected</span>
    <button type="button" class="delete" onclick={() => board.deleteSelection()}>
      <Icon name="trash" size={20} />
      Delete
    </button>
  </div>
{/if}

<style>
  .bar {
    position: absolute;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 6px;
    height: 52px;
    padding: 0 6px 0 16px;
    border-radius: 26px;
    background: var(--panel-bg);
    color: var(--fg);
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
    white-space: nowrap;
    z-index: 4;
  }
  .count {
    color: var(--muted);
    font-weight: 500;
    padding-right: 4px;
  }
  .delete {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 40px;
    padding: 0 16px;
    border: 0;
    border-radius: 20px;
    background: none;
    color: var(--danger);
    font: inherit;
    font-weight: 600;
  }
  .delete:active {
    background: var(--hover);
  }
</style>
