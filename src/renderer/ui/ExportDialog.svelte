<script lang="ts">
  import { onMount } from 'svelte';
  import type { ExportOptions } from '../../shared/types';
  import { tiling, type ExportSource } from '../board/export';
  import { board } from '../state/board.svelte';
  import { settings } from '../state/settings.svelte';
  import Icon from './Icon.svelte';
  import { errorMessage, showToast } from './toast';

  /** `path` null = the open board. */
  let { path, onclose }: { path: string | null; onclose: () => void } = $props();

  let src = $state.raw<ExportSource | null>(null);
  let busy = $state(false);
  const isOpenBoard = $derived(path === null || path === board.path);
  const opts = $derived(settings.value.export);
  const area = $derived(src ? board.exportArea(src, opts, isOpenBoard) : null);

  onMount(async () => {
    try {
      src = await board.exportSource(path);
    } catch (err) {
      showToast(`Couldn't read that board: ${errorMessage(err)}`);
      onclose();
    }
  });

  function set(patch: Partial<ExportOptions>) {
    settings.update({ export: { ...settings.value.export, ...patch } });
  }

  const summary = $derived.by(() => {
    if (!src) return 'Loading…';
    if (!area) return 'This board is empty, so there’s nothing to export.';
    const w = area.maxX - area.minX;
    const h = area.maxY - area.minY;
    if (opts.format === 'png') {
      const scale = Math.min(2, 16384 / w, 16384 / h);
      return `${Math.round(w * scale)} × ${Math.round(h * scale)} pixel picture${
        opts.area === 'view' && isOpenBoard ? ' of what’s on screen' : ''
      }.`;
    }
    if (opts.layout === 'fit') return 'One page sized to fit everything on the board.';
    const t = tiling(area, opts.paper);
    const paper = opts.paper === 'letter' ? 'Letter' : 'A4';
    return `${t.pages} ${paper} page${t.pages === 1 ? '' : 's'} (${t.landscape ? 'landscape' : 'portrait'}), at the size it appears at 100% zoom.`;
  });

  async function run() {
    if (!src || !area || busy) return;
    busy = true;
    try {
      const saved = await board.export(src, area, $state.snapshot(opts));
      if (saved) {
        showToast(`Exported to ${saved}`);
        onclose();
      }
    } catch (err) {
      showToast(`Couldn't export: ${errorMessage(err)}`);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && !busy && onclose()} />

<div class="scrim" onpointerdown={() => !busy && onclose()} aria-hidden="true"></div>
<div class="dialog" role="dialog" aria-labelledby="export-title">
  <header>
    <h2 id="export-title">Export “{src?.name ?? board.name}”</h2>
    <button type="button" class="icon-button" aria-label="Close" onclick={onclose} disabled={busy}>
      <Icon name="close" />
    </button>
  </header>

  <div class="field-label">Format</div>
  <div class="segmented" role="radiogroup" aria-label="Format">
    <button type="button" role="radio" aria-checked={opts.format === 'pdf'} class:on={opts.format === 'pdf'} onclick={() => set({ format: 'pdf' })}>PDF</button>
    <button type="button" role="radio" aria-checked={opts.format === 'png'} class:on={opts.format === 'png'} onclick={() => set({ format: 'png' })}>Picture (PNG)</button>
  </div>

  {#if opts.format === 'pdf'}
    <div class="field-label">Layout</div>
    <div class="segmented" role="radiogroup" aria-label="Layout">
      <button type="button" role="radio" aria-checked={opts.layout === 'fit'} class:on={opts.layout === 'fit'} onclick={() => set({ layout: 'fit' })}>One page</button>
      <button type="button" role="radio" aria-checked={opts.layout === 'pages'} class:on={opts.layout === 'pages'} onclick={() => set({ layout: 'pages' })}>Printable pages</button>
    </div>
    {#if opts.layout === 'pages'}
      <div class="field-label">Paper</div>
      <div class="segmented" role="radiogroup" aria-label="Paper">
        <button type="button" role="radio" aria-checked={opts.paper === 'letter'} class:on={opts.paper === 'letter'} onclick={() => set({ paper: 'letter' })}>Letter</button>
        <button type="button" role="radio" aria-checked={opts.paper === 'a4'} class:on={opts.paper === 'a4'} onclick={() => set({ paper: 'a4' })}>A4</button>
      </div>
    {/if}
  {:else if isOpenBoard}
    <div class="field-label">Area</div>
    <div class="segmented" role="radiogroup" aria-label="Area">
      <button type="button" role="radio" aria-checked={opts.area === 'board'} class:on={opts.area === 'board'} onclick={() => set({ area: 'board' })}>Whole board</button>
      <button type="button" role="radio" aria-checked={opts.area === 'view'} class:on={opts.area === 'view'} onclick={() => set({ area: 'view' })}>What’s on screen</button>
    </div>
  {/if}

  <label class="toggle">
    <span>
      <span class="toggle-title">Include board background</span>
      <span class="hint">Its color and pattern. Turn off for plain white (saves printer ink on dark boards).</span>
    </span>
    <input type="checkbox" checked={opts.background} onchange={(e) => set({ background: e.currentTarget.checked })} />
  </label>

  <p class="summary">{summary}</p>

  <div class="actions">
    <button type="button" onclick={onclose} disabled={busy}>Cancel</button>
    <button type="button" class="primary" disabled={!area || busy} onclick={run}>
      {busy ? 'Exporting…' : 'Export…'}
    </button>
  </div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: rgba(10, 14, 22, 0.35);
    z-index: 42;
  }
  .dialog {
    position: fixed;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: min(460px, calc(100vw - 32px));
    max-height: calc(100vh - 32px);
    overflow-y: auto;
    padding: 12px 24px 24px;
    border-radius: 18px;
    background: var(--panel-bg);
    color: var(--fg);
    box-shadow: var(--shadow-lg);
    z-index: 43;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
  }
  h2 {
    margin: 0;
    font-size: 20px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .field-label {
    font-weight: 600;
    margin-bottom: 8px;
  }
  .toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    min-height: var(--touch-target);
  }
  .toggle-title {
    display: block;
    font-weight: 600;
  }
  .hint {
    display: block;
    font-size: 13px;
    color: var(--muted);
  }
  .summary {
    margin: 16px 0 20px;
    padding: 12px 14px;
    border-radius: 12px;
    background: var(--hover);
    line-height: 1.4;
  }
  .actions {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
  }
  .actions button {
    min-width: 110px;
    height: var(--touch-target);
    padding: 0 18px;
    border-radius: 12px;
    border: 1px solid var(--border);
    background: none;
    color: var(--fg);
    font: inherit;
    font-weight: 600;
  }
  .actions .primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .actions button:disabled {
    opacity: 0.5;
  }
</style>
