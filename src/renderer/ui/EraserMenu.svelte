<script lang="ts">
  import type { EraserSettings } from '../../shared/types';
  import Icon from './Icon.svelte';

  let {
    eraser,
    onchange,
    onclear,
  }: {
    eraser: EraserSettings;
    onchange: (patch: Partial<EraserSettings>) => void;
    onclear: () => void;
  } = $props();

  const SIZES = [
    { size: 24, label: 'Small' },
    { size: 40, label: 'Medium' },
    { size: 72, label: 'Large' },
    { size: 120, label: 'Huge' },
  ];

  /** Real sizes don't all fit in a button; keep them in proportion instead. */
  const preview = (size: number) => Math.round(12 + ((size - 24) / (120 - 24)) * 32);
</script>

<div class="section-label">Erase</div>
<div class="segmented" role="radiogroup" aria-label="Eraser mode">
  <button
    type="button"
    role="radio"
    aria-checked={eraser.mode === 'partial'}
    class:on={eraser.mode === 'partial'}
    onclick={() => onchange({ mode: 'partial' })}>Just what I rub</button
  >
  <button
    type="button"
    role="radio"
    aria-checked={eraser.mode === 'stroke'}
    class:on={eraser.mode === 'stroke'}
    onclick={() => onchange({ mode: 'stroke' })}>Whole strokes</button
  >
</div>

<div class="section-label">Size</div>
<div class="sizes" role="radiogroup" aria-label="Eraser size">
  {#each SIZES as s (s.size)}
    <button
      type="button"
      role="radio"
      aria-checked={eraser.size === s.size}
      aria-label={s.label}
      class:on={eraser.size === s.size}
      onclick={() => onchange({ size: s.size })}
    >
      <span class="dot" style:width="{preview(s.size)}px" style:height="{preview(s.size)}px"></span>
    </button>
  {/each}
</div>

<button type="button" class="clear" onclick={onclear}>
  <Icon name="trash" size={20} />
  Clear board
</button>

<style>
  .section-label {
    font-weight: 600;
    margin-bottom: 8px;
  }
  .sizes {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    margin-bottom: 18px;
  }
  .sizes button {
    height: 60px;
    display: grid;
    place-items: center;
    border-radius: 12px;
    border: 1px solid var(--border);
    background: none;
  }
  .sizes button.on {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .dot {
    border-radius: 50%;
    border: 2px solid var(--fg);
    opacity: 0.7;
  }
  .clear {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    height: var(--touch-target);
    border-radius: 12px;
    border: 1px solid var(--border);
    background: none;
    color: var(--danger);
    font: inherit;
    font-weight: 600;
  }
</style>
