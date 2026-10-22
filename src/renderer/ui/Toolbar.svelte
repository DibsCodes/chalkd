<script lang="ts">
  import { onMount } from 'svelte';
  import { board } from '../state/board.svelte';
  import { settings, type PresetKind } from '../state/settings.svelte';
  import Icon from './Icon.svelte';
  import PresetSwatch from './PresetSwatch.svelte';
  import { press } from './press';
  import { isVertical, splitSlots, visiblePresets } from './toolbar-layout';

  let {
    onMenu,
    onEditPreset,
    onMorePresets,
    onEraserMenu,
    onImport,
    onExport,
    onSettings,
  }: {
    onMenu: () => void;
    onExport: () => void;
    onImport: (anchor: HTMLElement) => void;
    onEditPreset: (kind: PresetKind, id: string, anchor: HTMLElement) => void;
    /** Show every preset of a kind, when the toolbar can't fit them all. */
    onMorePresets: (kind: PresetKind, anchor: HTMLElement) => void;
    onEraserMenu: (anchor: HTMLElement) => void;
    onSettings: () => void;
  } = $props();

  const eraserOn = $derived(settings.value.tool.type === 'eraser');
  const selectOn = $derived(settings.value.tool.type === 'select');
  const position = $derived(settings.value.toolbarPosition);
  const vertical = $derived(isVertical(position));

  // ---------- fitting pens and highlighters ----------

  /** How many pens and highlighters fit, together; the rest hide behind a "more" button. */
  let slots = $state(Infinity);
  let toolsEl: HTMLElement;
  let spacerEl: HTMLElement;

  const shown = $derived.by(() => {
    const t = settings.value.tool;
    const [pens, highlighters] = splitSlots(
      slots,
      settings.value.pens.length,
      settings.value.highlighters.length,
    );
    return {
      pen: visiblePresets(settings.value.pens, pens, t.type === 'pen' ? t.presetId : null),
      highlighter: visiblePresets(
        settings.value.highlighters,
        highlighters,
        t.type === 'highlighter' ? t.presetId : null,
      ),
    };
  });

  /**
   * Hide presets while the tools overflow; bring them back once the spacer
   * has room for another.
   */
  function fit() {
    const btn = toolsEl.querySelector<HTMLElement>('[data-preset]');
    if (!btn) return;
    const length = (el: HTMLElement) => (vertical ? el.offsetHeight : el.offsetWidth);
    const overflow = vertical
      ? toolsEl.scrollHeight - toolsEl.clientHeight
      : toolsEl.scrollWidth - toolsEl.clientWidth;
    const step = length(btn) + 4; // the group's gap
    const count = shown.pen.length + shown.highlighter.length;
    const total = settings.value.pens.length + settings.value.highlighters.length;
    const free = length(spacerEl);
    if (overflow > 0) slots = Math.max(2, count - Math.ceil(overflow / step));
    else if (count < total && free >= step) slots = count + Math.floor(free / step);
  }

  onMount(() => {
    const observer = new ResizeObserver(() => fit());
    observer.observe(toolsEl.parentElement!);
    observer.observe(toolsEl);
    observer.observe(spacerEl);
    return () => observer.disconnect();
  });

  // Adding or removing presets changes what overflows without resizing anything.
  $effect(() => {
    void [shown, settings.value.pens.length, settings.value.highlighters.length, vertical];
    fit();
  });

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

  // ---------- hold-to-drag reordering ----------

  /** Hold a pen or highlighter this long to pick it up and move it. */
  const DRAG_DELAY_MS = 700;

  let drag: {
    kind: PresetKind;
    id: string;
    buttons: HTMLElement[];
    /** Button centers along the toolbar when the drag began, in viewport px. */
    centers: number[];
    from: number;
    to: number;
    start: number;
    vertical: boolean;
    /** Viewport px per CSS px (the toolbar size setting zooms the toolbar). */
    scale: number;
  } | null = null;

  function dragStart(kind: PresetKind, id: string, el: HTMLElement, x: number, y: number) {
    const group = el.parentElement!;
    const buttons = [...group.querySelectorAll<HTMLElement>('[data-preset]')];
    const rects = buttons.map((b) => b.getBoundingClientRect());
    drag = {
      kind,
      id,
      buttons,
      centers: rects.map((r) => (vertical ? r.top + r.height / 2 : r.left + r.width / 2)),
      from: buttons.indexOf(el),
      to: buttons.indexOf(el),
      start: vertical ? y : x,
      vertical,
      scale: rects[0].width / buttons[0].offsetWidth || 1,
    };
    group.classList.add('reordering');
  }

  function dragMove(el: HTMLElement, x: number, y: number) {
    if (!drag) return;
    const { centers, from, scale } = drag;
    const translate = drag.vertical ? 'translateY' : 'translateX';
    // Stay within the group.
    const d = Math.min(
      centers[centers.length - 1] - centers[from],
      Math.max(centers[0] - centers[from], (drag.vertical ? y : x) - drag.start),
    );
    const center = centers[from] + d;
    let to = 0;
    centers.forEach((c, i) => {
      if (Math.abs(c - center) < Math.abs(centers[to] - center)) to = i;
    });
    drag.to = to;
    el.style.transform = `${translate}(${d / scale}px)`;
    // Neighbours step aside to open a gap where it would land.
    drag.buttons.forEach((b, i) => {
      if (b === el) return;
      const shift = from < to && i > from && i <= to ? -1 : from > to && i >= to && i < from ? 1 : 0;
      const step = (centers[i + shift] - centers[i]) / scale;
      b.style.transform = shift ? `${translate}(${step}px)` : '';
    });
  }

  function dragEnd(el: HTMLElement, commit: boolean) {
    if (!drag) return;
    const d = drag;
    drag = null;
    // No transition while the buttons swap their offsets for real positions.
    el.parentElement?.classList.remove('reordering');
    for (const b of d.buttons) b.style.transform = '';
    if (!commit) return;
    // The group may be showing only some of the presets: land where the one it was dropped on is.
    const target = d.buttons[d.to].dataset.preset;
    settings.movePreset(d.kind, d.id, settings.presets(d.kind).findIndex((p) => p.id === target));
  }

  function eraserTap(el: HTMLElement) {
    if (eraserOn) onEraserMenu(el);
    else settings.selectTool({ type: 'eraser' });
  }
</script>

{#snippet presetGroup(kind: PresetKind, label: string)}
  {@const hidden = settings.presets(kind).length - shown[kind].length}
  <div class="group" role="radiogroup" aria-label={label}>
    {#each shown[kind] as p (p.id)}
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
          drag: {
            delayMs: DRAG_DELAY_MS,
            onStart: (el, x, y) => dragStart(kind, p.id, el, x, y),
            onMove: dragMove,
            onEnd: dragEnd,
          },
        }}
      >
        <PresetSwatch {kind} preset={p} />
      </button>
    {/each}
    {#if hidden > 0}
      <button
        type="button"
        class="tool add"
        aria-label="{hidden} more {label.toLowerCase()}"
        onclick={(e) => onMorePresets(kind, e.currentTarget)}
      >
        <Icon name="more" size={20} />
        <span class="count">{hidden}</span>
      </button>
    {:else}
      <button
        type="button"
        class="tool add"
        aria-label="Add a {kind}"
        onclick={(e) => addPreset(kind, e.currentTarget)}
      >
        <Icon name="plus" size={20} />
      </button>
    {/if}
  </div>
{/snippet}

<header class="toolbar {position}" class:vertical>
  <button type="button" class="tool" aria-label="Notebooks" onclick={onMenu}>
    <Icon name="menu" />
  </button>
  <div class="divider"></div>
  <div class="tools" bind:this={toolsEl}>
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

  <div class="spacer" bind:this={spacerEl}></div>
  {#if !vertical}
    <span class="board-name" title={board.name}>{board.name}</span>
  {/if}
  <button type="button" class="tool" aria-label="Settings" onclick={onSettings}>
    <Icon name="settings" />
  </button>
</header>

<style>
  .toolbar {
    position: absolute;
    inset: 0;
    zoom: var(--toolbar-scale);
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 8px;
    background: var(--chrome-bg);
    color: var(--fg);
    z-index: 5;
  }
  .toolbar.top {
    bottom: auto;
    height: var(--toolbar-base-size);
    border-bottom: 1px solid var(--border);
  }
  .toolbar.bottom {
    top: auto;
    height: var(--toolbar-base-size);
    border-top: 1px solid var(--border);
  }
  .toolbar.left {
    right: auto;
    width: var(--toolbar-base-size);
    border-right: 1px solid var(--border);
  }
  .toolbar.right {
    left: auto;
    width: var(--toolbar-base-size);
    border-left: 1px solid var(--border);
  }
  .vertical {
    flex-direction: column;
    padding: 8px 0;
  }
  .tools {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    min-height: 0;
    /* Only scrolls if even one pen and one highlighter don't fit. */
    overflow: auto;
    scrollbar-width: none;
    touch-action: pan-x;
  }
  .group {
    display: flex;
    gap: 4px;
  }
  .vertical .tools,
  .vertical .group {
    flex-direction: column;
  }
  .vertical .tools {
    touch-action: pan-y;
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
    position: relative;
    color: var(--muted);
  }
  .count {
    position: absolute;
    right: 2px;
    bottom: 2px;
    min-width: 18px;
    height: 18px;
    padding: 0 4px;
    box-sizing: border-box;
    border-radius: 9px;
    background: var(--hover);
    color: var(--fg);
    font-size: 12px;
    font-weight: 600;
    line-height: 18px;
  }
  .group:global(.reordering) > .tool:not(:global(.lifted)) {
    transition: transform 150ms ease;
  }
  /* Picked up for dragging. Drawn inside the button: the scrolling strip clips anything outside. */
  .tool:global(.lifted) {
    position: relative;
    z-index: 1;
    background: var(--hover);
    box-shadow: inset 0 0 0 3px var(--accent);
  }
  .tool:global(.lifted) > :global(span) {
    scale: 1.3;
  }
  .divider {
    flex: none;
    width: 1px;
    height: 32px;
    margin: 0 6px;
    background: var(--border);
  }
  .vertical .divider {
    width: 32px;
    height: 1px;
    margin: 6px 0;
  }
  .spacer {
    flex: 1;
  }
  .board-name {
    /* Gives way before any pens or highlighters do. */
    flex-shrink: 1000;
    max-width: 30vw;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--muted);
    font-weight: 500;
    padding: 0 8px;
  }
</style>
