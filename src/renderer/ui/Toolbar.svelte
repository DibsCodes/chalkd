<script lang="ts">
  import { HIGHLIGHTER_OPACITY } from '../../shared/types';
  import { board } from '../state/board.svelte';
  import { settings, type PresetKind } from '../state/settings.svelte';
  import Icon from './Icon.svelte';
  import { press } from './press';

  let {
    onMenu,
    onEditPreset,
    onEraserMenu,
    onImport,
    onExport,
    onSettings,
  }: {
    onMenu: () => void;
    onExport: () => void;
    onImport: (anchor: HTMLElement) => void;
    onEditPreset: (kind: PresetKind, id: string, anchor: HTMLElement) => void;
    onEraserMenu: (anchor: HTMLElement) => void;
    onSettings: () => void;
  } = $props();

  const eraserOn = $derived(settings.value.tool.type === 'eraser');
  const selectOn = $derived(settings.value.tool.type === 'select');

  /** Tap selects; tapping the selected one (or long-pressing) edits it. */
  function presetTap(kind: PresetKind, id: string, el: HTMLElement) {
    if (settings.isSelected(kind, id)) onEditPreset(kind, id, el);
    else settings.selectTool({ type: kind, presetId: id });
  }

  function addPreset(kind: PresetKind, el: HTMLElement) {
    const copy = settings.duplicatePreset(kind);
    // Wait for the new button to render, then anchor the editor to it.
    requestAnimationFrame(() => {
      const btn = el.parentElement?.querySelector<HTMLElement>(`[data-preset="${copy.id}"]`);
      btn?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
      onEditPreset(kind, copy.id, btn ?? el);
    });
  }

  function eraserTap(el: HTMLElement) {
    if (eraserOn) onEraserMenu(el);
    else settings.selectTool({ type: 'eraser' });
  }
</script>

{#snippet presetGroup(kind: PresetKind, label: string)}
  <div class="group" role="radiogroup" aria-label={label}>
    {#each settings.presets(kind) as p (p.id)}
      {@const selected = settings.isSelected(kind, p.id)}
      <button
        type="button"
        class="tool"
        class:selected
        data-preset={p.id}
        role="radio"
        aria-checked={selected}
        aria-label="{kind} {p.color}, {p.width} px"
        use:press={{
          onTap: (el) => presetTap(kind, p.id, el),
          onLongPress: (el) => onEditPreset(kind, p.id, el),
        }}
      >
        {#if kind === 'pen'}
          <span
            class="pen-dot"
            style:background={p.color}
            style:--d="{Math.max(8, Math.min(30, p.width * 2.4))}px"
          ></span>
        {:else}
          <span
            class="hl-chip"
            style:background={p.color}
            style:opacity={HIGHLIGHTER_OPACITY + 0.35}
            style:--h="{Math.max(8, Math.min(22, p.width * 0.6))}px"
          ></span>
        {/if}
      </button>
    {/each}
    <button
      type="button"
      class="tool add"
      aria-label="Add a {kind}"
      onclick={(e) => addPreset(kind, e.currentTarget)}
    >
      <Icon name="plus" size={20} />
    </button>
  </div>
{/snippet}

<header class="toolbar">
  <button type="button" class="tool" aria-label="Notebooks" onclick={onMenu}>
    <Icon name="menu" />
  </button>
  <div class="divider"></div>
  <div class="tools">
    {@render presetGroup('pen', 'Pens')}
    <div class="divider"></div>
    {@render presetGroup('highlighter', 'Highlighters')}
    <div class="divider"></div>
    <button
      type="button"
      class="tool"
      class:selected={eraserOn}
      aria-label="Eraser"
      aria-pressed={eraserOn}
      use:press={{
        onTap: eraserTap,
        onLongPress: (el) => {
          settings.selectTool({ type: 'eraser' });
          onEraserMenu(el);
        },
      }}
    >
      <Icon name="eraser" />
    </button>
    <button
      type="button"
      class="tool"
      class:selected={selectOn}
      aria-label="Select"
      aria-pressed={selectOn}
      onclick={() => settings.selectTool({ type: 'select' })}
    >
      <Icon name="lasso" />
    </button>
  </div>

  <div class="divider"></div>
  <button
    type="button"
    class="tool"
    aria-label="Undo"
    disabled={!board.canUndo}
    onclick={() => board.editor?.undo()}
  >
    <Icon name="undo" />
  </button>
  <button
    type="button"
    class="tool"
    aria-label="Redo"
    disabled={!board.canRedo}
    onclick={() => board.editor?.redo()}
  >
    <Icon name="redo" />
  </button>
  <div class="divider"></div>
  <button
    type="button"
    class="tool"
    aria-label="Import"
    disabled={board.importing}
    onclick={(e) => onImport(e.currentTarget)}
  >
    <Icon name="image-plus" />
  </button>
  <button type="button" class="tool" aria-label="Export" onclick={onExport}>
    <Icon name="share" />
  </button>

  <div class="spacer"></div>
  <span class="board-name" title={board.name}>{board.name}</span>
  <button type="button" class="tool" aria-label="Settings" onclick={onSettings}>
    <Icon name="settings" />
  </button>
</header>

<style>
  .toolbar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: var(--toolbar-base-h);
    zoom: var(--toolbar-scale);
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 8px;
    background: var(--chrome-bg);
    color: var(--fg);
    border-bottom: 1px solid var(--border);
    z-index: 5;
  }
  .tools {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
    touch-action: pan-x;
  }
  .group {
    display: flex;
    gap: 4px;
  }
  .tool {
    flex: none;
    width: var(--touch-target);
    height: var(--touch-target);
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 12px;
    background: none;
    color: inherit;
    padding: 0;
  }
  .tool:active:not(:disabled) {
    background: var(--hover);
  }
  .tool:disabled {
    opacity: 0.35;
  }
  .tool.selected {
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .add {
    color: var(--muted);
  }
  .pen-dot {
    width: var(--d);
    height: var(--d);
    border-radius: 50%;
    box-shadow: 0 0 0 1px var(--border-strong);
  }
  .hl-chip {
    width: 28px;
    height: var(--h);
    border-radius: 4px;
    transform: rotate(-20deg);
  }
  .divider {
    flex: none;
    width: 1px;
    height: 32px;
    margin: 0 6px;
    background: var(--border);
  }
  .spacer {
    flex: 1;
  }
  .board-name {
    max-width: 30vw;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--muted);
    font-weight: 500;
    padding: 0 8px;
  }
</style>
