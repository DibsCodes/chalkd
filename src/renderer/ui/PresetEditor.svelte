<script lang="ts">
  import { HIGHLIGHTER_OPACITY, type Preset } from '../../shared/types';
  import type { PresetKind } from '../state/settings.svelte';
  import Icon from './Icon.svelte';

  let {
    kind,
    preset,
    boardColor,
    canDelete,
    onchange,
    ondelete,
  }: {
    kind: PresetKind;
    preset: Preset;
    boardColor: string;
    canDelete: boolean;
    onchange: (patch: Partial<Preset>) => void;
    ondelete: () => void;
  } = $props();

  const PEN_COLORS = [
    '#1d2433', '#5b6475', '#ffffff', '#d62f2f', '#f07b16', '#e0b300',
    '#1f8a3a', '#119c9c', '#1f5fd1', '#5b3cc4', '#b4359a', '#8a5a2b',
  ];
  const HIGHLIGHTER_COLORS = ['#ffd400', '#ffa62b', '#ff6fb5', '#5fe35f', '#4fd2ff', '#b48cff'];

  const colors = $derived(kind === 'pen' ? PEN_COLORS : HIGHLIGHTER_COLORS);
  const range = $derived(kind === 'pen' ? { min: 1, max: 40 } : { min: 8, max: 60 });
  const isCustom = $derived(!colors.includes(preset.color.toLowerCase()));
</script>

<div class="preview" style:background={boardColor}>
  <svg viewBox="0 0 280 80" aria-hidden="true">
    <path
      d="M 24 52 C 64 12, 104 76, 140 40 S 220 12, 256 36"
      fill="none"
      stroke={preset.color}
      stroke-width={Math.min(preset.width, 44)}
      stroke-linecap="round"
      stroke-linejoin="round"
      opacity={kind === 'highlighter' ? HIGHLIGHTER_OPACITY : 1}
    />
  </svg>
</div>

<div class="swatches" role="radiogroup" aria-label="Color">
  {#each colors as color (color)}
    <button
      type="button"
      class="swatch"
      class:selected={preset.color.toLowerCase() === color}
      style:--swatch={color}
      role="radio"
      aria-checked={preset.color.toLowerCase() === color}
      aria-label={color}
      onclick={() => onchange({ color })}
    ></button>
  {/each}
  <label class="swatch custom" class:selected={isCustom} style:--swatch={isCustom ? preset.color : null}>
    <input
      type="color"
      value={preset.color}
      oninput={(e) => onchange({ color: e.currentTarget.value })}
      aria-label="Custom color"
    />
  </label>
</div>

<label class="thickness">
  <span class="label-row">
    <span>Thickness</span>
    <span class="value">{preset.width} px</span>
  </span>
  <input
    type="range"
    min={range.min}
    max={range.max}
    step="1"
    value={preset.width}
    oninput={(e) => onchange({ width: Number(e.currentTarget.value) })}
  />
</label>

<button type="button" class="delete" disabled={!canDelete} onclick={ondelete}>
  <Icon name="trash" size={20} />
  {canDelete ? `Delete this ${kind}` : `You need at least one ${kind}`}
</button>

<style>
  .preview {
    border-radius: 12px;
    border: 1px solid var(--border);
    margin-bottom: 14px;
  }
  .preview svg {
    display: block;
    width: 100%;
    height: 80px;
  }
  .swatches {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(40px, 1fr));
    gap: 8px;
    margin-bottom: 16px;
  }
  .swatch {
    position: relative;
    aspect-ratio: 1;
    min-height: 40px;
    border-radius: 50%;
    border: 1px solid var(--border-strong);
    background: var(--swatch);
    padding: 0;
  }
  .swatch.selected {
    box-shadow:
      0 0 0 3px var(--panel-bg),
      0 0 0 5px var(--accent);
  }
  .custom {
    background: var(
      --swatch,
      conic-gradient(#f44, #fd3, #4d6, #3cf, #66f, #e4e, #f44)
    );
    cursor: pointer;
  }
  .custom input {
    position: absolute;
    inset: 0;
    opacity: 0;
    width: 100%;
    height: 100%;
    cursor: pointer;
  }
  .thickness {
    display: block;
    margin-bottom: 16px;
  }
  .label-row {
    display: flex;
    justify-content: space-between;
    font-weight: 600;
    margin-bottom: 6px;
  }
  .value {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .delete {
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
  .delete:disabled {
    color: var(--muted);
  }
</style>
