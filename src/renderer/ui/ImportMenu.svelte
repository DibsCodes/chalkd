<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';

  let { onfile, onpaste }: { onfile: () => void; onpaste: () => void } = $props();

  let canPaste = $state(false);
  onMount(async () => {
    canPaste = await window.chalkd.import.clipboardHasImage();
  });
</script>

<div class="menu">
  <button type="button" onclick={onfile}>
    <Icon name="file" size={20} />
    <span>
      <span class="title">Picture or PDF…</span>
      <span class="hint">PNG, JPEG, WebP, GIF, SVG, or PDF</span>
    </span>
  </button>
  <button type="button" disabled={!canPaste} onclick={onpaste}>
    <Icon name="clipboard" size={20} />
    <span>
      <span class="title">Paste picture</span>
      <span class="hint">{canPaste ? 'From the clipboard (Ctrl+V)' : 'Nothing to paste right now'}</span>
    </span>
  </button>
  <p class="tip">You can also drag files onto the board.</p>
</div>

<style>
  .menu {
    display: flex;
    flex-direction: column;
    margin: -8px;
  }
  button {
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: 60px;
    padding: 6px 12px;
    border: 0;
    border-radius: 10px;
    background: none;
    color: var(--fg);
    font: inherit;
    text-align: left;
  }
  button:active:not(:disabled) {
    background: var(--hover);
  }
  button:disabled {
    opacity: 0.5;
  }
  .title {
    display: block;
    font-weight: 600;
  }
  .hint,
  .tip {
    display: block;
    font-size: 13px;
    color: var(--muted);
  }
  .tip {
    margin: 6px 12px 4px;
  }
</style>
