<script lang="ts">
  import { onMount } from 'svelte';
  import type { Background, Pattern, Theme } from '../../shared/types';
  import { board } from '../state/board.svelte';
  import { settings } from '../state/settings.svelte';
  import Icon from './Icon.svelte';
  import { errorMessage, showToast } from './toast';

  let { onclose }: { onclose: () => void } = $props();

  const BOARD_COLORS = [
    { color: '#ffffff', label: 'White' },
    { color: '#fbf8ef', label: 'Cream' },
    { color: '#eef2f7', label: 'Pale blue' },
    { color: '#22262b', label: 'Charcoal' },
    { color: '#1f3d34', label: 'Chalkboard green' },
    { color: '#1d2a40', label: 'Navy' },
  ];
  const PATTERNS: { value: Pattern; label: string }[] = [
    { value: 'blank', label: 'Blank' },
    { value: 'dots', label: 'Dots' },
    { value: 'grid', label: 'Grid' },
    { value: 'lines', label: 'Lines' },
  ];
  const THEMES: { value: Theme; label: string }[] = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];

  const isWindows = window.chalkd.system.platform === 'win32';

  let root = $state('');
  let changingFolder = $state(false);
  let printer = $state<{ manageable: boolean; installed: boolean } | null>(null);
  let changingPrinter = $state(false);
  onMount(async () => {
    root = await window.chalkd.library.root();
    printer = await window.chalkd.print.status();
  });

  async function setPrinter(on: boolean) {
    changingPrinter = true;
    try {
      const problem = await window.chalkd.print.setInstalled(on);
      printer = await window.chalkd.print.status();
      if (problem) showToast(`Couldn't ${on ? 'add' : 'remove'} the printer: ${problem}`);
      else showToast(on ? 'Added the Chalkd printer.' : 'Removed the Chalkd printer.');
    } finally {
      changingPrinter = false;
    }
  }

  const bg = $derived(board.background);
  const isDefault = $derived(
    JSON.stringify(bg) === JSON.stringify(settings.value.defaultBackground),
  );
  const palmOn = $derived(settings.value.palmContactPx !== null);

  function setBackground(patch: Partial<Background>) {
    board.setBackground({ ...bg, ...patch });
  }

  async function changeFolder() {
    const dir = await window.chalkd.library.chooseFolder();
    if (!dir || dir === root) return;
    changingFolder = true;
    try {
      await board.pause();
      await board.show(await window.chalkd.library.setRoot(dir));
      root = dir;
    } catch (err) {
      showToast(`Couldn't use that folder: ${errorMessage(err)}`);
    } finally {
      board.resume();
      changingFolder = false;
    }
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="scrim" onpointerdown={onclose} aria-hidden="true"></div>
<aside class="panel" aria-label="Settings">
  <header>
    <h2>Settings</h2>
    <button type="button" class="icon-button" aria-label="Close settings" onclick={onclose}>
      <Icon name="close" />
    </button>
  </header>

  <section>
    <h3>This board</h3>
    <div class="field-label">Background</div>
    <div class="colors" role="radiogroup" aria-label="Board color">
      {#each BOARD_COLORS as c (c.color)}
        <button
          type="button"
          class="board-swatch"
          class:selected={bg.color === c.color}
          style:background={c.color}
          role="radio"
          aria-checked={bg.color === c.color}
          aria-label={c.label}
          title={c.label}
          onclick={() => setBackground({ color: c.color })}
        ></button>
      {/each}
    </div>
    <div class="field-label">Pattern</div>
    <div class="segmented" role="radiogroup" aria-label="Pattern">
      {#each PATTERNS as p (p.value)}
        <button
          type="button"
          role="radio"
          aria-checked={bg.pattern === p.value}
          class:on={bg.pattern === p.value}
          onclick={() => setBackground({ pattern: p.value })}>{p.label}</button
        >
      {/each}
    </div>
    <button
      type="button"
      class="wide"
      disabled={isDefault}
      onclick={() => settings.update({ defaultBackground: { ...bg } })}
    >
      {isDefault ? 'New boards already look like this' : 'Use this look for new boards'}
    </button>
  </section>

  <section>
    <h3>Writing</h3>
    <label class="field">
      <span class="field-label row"><span>Ink smoothing</span></span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        value={settings.value.smoothing}
        oninput={(e) => settings.update({ smoothing: Number(e.currentTarget.value) })}
      />
      <span class="scale"><span>Exactly as drawn</span><span>Extra smooth</span></span>
    </label>
  </section>

  <section>
    <h3>Touch</h3>
    <label class="toggle">
      <span>
        <span class="toggle-title">Palm rejection</span>
        <span class="hint">Ignore large touches. Not every touchscreen reports touch size.</span>
      </span>
      <input
        type="checkbox"
        checked={palmOn}
        onchange={(e) =>
          settings.update({ palmContactPx: e.currentTarget.checked ? 40 : null })}
      />
    </label>
    {#if palmOn}
      <label class="field">
        <span class="field-label row">
          <span>Ignore touches wider than</span>
          <span class="value">{settings.value.palmContactPx} px</span>
        </span>
        <input
          type="range"
          min="15"
          max="100"
          step="5"
          value={settings.value.palmContactPx}
          oninput={(e) => settings.update({ palmContactPx: Number(e.currentTarget.value) })}
        />
      </label>
    {/if}
    {#if isWindows}
      <p class="hint">
        Windows uses three- and four-finger swipes on the touchscreen for itself. To pan and zoom
        with them in Chalkd, turn off “Three- and four-finger touch gestures” in Windows’ touch
        settings.
      </p>
      <button type="button" class="wide" onclick={() => window.chalkd.system.openTouchSettings()}>
        Open Windows touch settings
      </button>
    {/if}
  </section>

  <section>
    <h3>Appearance</h3>
    <div class="segmented" role="radiogroup" aria-label="Theme">
      {#each THEMES as t (t.value)}
        <button
          type="button"
          role="radio"
          aria-checked={settings.value.theme === t.value}
          class:on={settings.value.theme === t.value}
          onclick={() => settings.update({ theme: t.value })}>{t.label}</button
        >
      {/each}
    </div>
    <label class="field">
      <span class="field-label row">
        <span>Toolbar size</span>
        <span class="value">{Math.round(settings.value.toolbarScale * 100)}%</span>
      </span>
      <input
        type="range"
        min="0.5"
        max="1.5"
        step="0.05"
        value={settings.value.toolbarScale}
        oninput={(e) => settings.update({ toolbarScale: Number(e.currentTarget.value) })}
      />
      <span class="scale"><span>Smaller</span><span>Larger</span></span>
    </label>
  </section>

  <section>
    <h3>Storage</h3>
    <div class="field-label">Chalkd folder</div>
    <div class="folder">
      <Icon name="folder" size={20} />
      <span class="path" title={root}>{root}</span>
    </div>
    <button type="button" class="wide" disabled={changingFolder} onclick={changeFolder}>
      {changingFolder ? 'Switching…' : 'Change folder…'}
    </button>
  </section>

  {#if printer?.manageable}
    <section>
      <h3>Printing</h3>
      <p class="hint">
        {printer.installed
          ? 'The Chalkd printer is set up. Print to it from any app and the pages open as a new board.'
          : 'Add a Chalkd printer to open anything you print as a new board. Windows asks for permission first.'}
      </p>
      <button
        type="button"
        class="wide"
        disabled={changingPrinter}
        onclick={() => setPrinter(!printer!.installed)}
      >
        {changingPrinter
          ? 'Waiting for Windows…'
          : printer.installed
            ? 'Remove the Chalkd printer'
            : 'Add the Chalkd printer…'}
      </button>
    </section>
  {/if}

  <footer>Chalkd 0.1.0 · Free software under the GPL-3.0</footer>
</aside>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: rgba(10, 14, 22, 0.25);
    z-index: 30;
  }
  .panel {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(400px, 100vw);
    overflow-y: auto;
    background: var(--panel-bg);
    color: var(--fg);
    border-left: 1px solid var(--border);
    box-shadow: var(--shadow-lg);
    z-index: 31;
    padding: 0 20px 24px;
  }
  header {
    position: sticky;
    top: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 0;
    background: var(--panel-bg);
  }
  h2 {
    margin: 0;
    font-size: 20px;
  }
  h3 {
    margin: 0 0 12px;
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
  }
  section {
    padding: 16px 0;
    border-top: 1px solid var(--border);
  }
  .field-label {
    font-weight: 600;
    margin-bottom: 8px;
  }
  .row {
    display: flex;
    justify-content: space-between;
  }
  .value {
    color: var(--muted);
    font-weight: 500;
  }
  .field {
    display: block;
    margin-top: 12px;
  }
  .scale {
    display: flex;
    justify-content: space-between;
    font-size: 13px;
    color: var(--muted);
  }
  .colors {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 10px;
    margin-bottom: 16px;
  }
  .board-swatch {
    aspect-ratio: 1;
    border-radius: 12px;
    border: 1px solid var(--border-strong);
    padding: 0;
  }
  .board-swatch.selected {
    box-shadow:
      0 0 0 3px var(--panel-bg),
      0 0 0 5px var(--accent);
  }
  .segmented {
    margin-bottom: 12px;
  }
  .wide {
    width: 100%;
    min-height: var(--touch-target);
    border-radius: 12px;
    border: 1px solid var(--border);
    background: none;
    color: var(--fg);
    font: inherit;
    font-weight: 600;
  }
  .wide:disabled {
    color: var(--muted);
    font-weight: 500;
  }
  .toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    min-height: var(--touch-target);
    margin-bottom: 8px;
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
  p.hint {
    margin: 12px 0 10px;
    line-height: 1.4;
  }
  .folder {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
    color: var(--muted);
  }
  .path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    direction: rtl;
    text-align: left;
  }
  footer {
    padding-top: 16px;
    border-top: 1px solid var(--border);
    font-size: 13px;
    color: var(--muted);
  }
</style>
