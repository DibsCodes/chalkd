<script lang="ts">
  import { settings, type PresetKind } from '../state/settings.svelte';
  import Icon from './Icon.svelte';
  import PresetSwatch from './PresetSwatch.svelte';
  import { press } from './press';

  let {
    kind,
    onpick,
    onedit,
    onadd,
  }: {
    kind: PresetKind;
    onpick: () => void;
    onedit: (id: string) => void;
    onadd: () => void;
  } = $props();

  /** Same as in the toolbar: tap selects; tapping the selected one (or long-pressing) edits it. */
  function tap(id: string) {
    if (settings.isSelected(kind, id)) {
      onedit(id);
    } else {
      settings.selectTool({ type: kind, presetId: id });
      onpick();
    }
  }
</script>

<div class="grid" role="radiogroup" aria-label={kind === 'pen' ? 'All pens' : 'All highlighters'}>
  {#each settings.presets(kind) as p (p.id)}
    {@const selected = settings.isSelected(kind, p.id)}
    <button
      type="button"
      class="tool"
      class:selected
      role="radio"
      aria-checked={selected}
      aria-label="{kind} {p.color}, {p.width} px"
      use:press={{ onTap: () => tap(p.id), onLongPress: () => onedit(p.id) }}
    >
      <PresetSwatch {kind} preset={p} />
    </button>
  {/each}
  <button type="button" class="tool add" aria-label="Add a {kind}" onclick={onadd}>
    <Icon name="plus" size={20} />
  </button>
</div>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, var(--touch-target));
    gap: 8px;
  }
  .tool {
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
  .tool:active {
    background: var(--hover);
  }
  .tool.selected {
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .add {
    color: var(--muted);
  }
</style>
