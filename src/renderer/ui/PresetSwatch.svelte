<script lang="ts">
  import { HIGHLIGHTER_OPACITY, type Preset } from '../../shared/types';
  import type { PresetKind } from '../state/settings.svelte';

  let { kind, preset }: { kind: PresetKind; preset: Preset } = $props();
</script>

{#if kind === 'pen'}
  <span
    class="pen-dot"
    style:background={preset.color}
    style:--d="{Math.max(8, Math.min(30, preset.width * 2.4))}px"
  ></span>
{:else}
  <span
    class="hl-chip"
    style:background={preset.color}
    style:opacity={HIGHLIGHTER_OPACITY + 0.35}
    style:--h="{Math.max(8, Math.min(22, preset.width * 0.6))}px"
  ></span>
{/if}

<style>
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
</style>
