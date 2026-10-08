<script lang="ts">
  import { onMount } from 'svelte';
  import { runBench } from './dev/bench';
  import { mountStats } from './dev/stats';
  import { board } from './state/board.svelte';
  import { dialogs } from './state/dialogs.svelte';
  import { settings, type PresetKind } from './state/settings.svelte';
  import ConfirmDialog from './ui/ConfirmDialog.svelte';
  import EraserMenu from './ui/EraserMenu.svelte';
  import Popover from './ui/Popover.svelte';
  import PresetEditor from './ui/PresetEditor.svelte';
  import SettingsPanel from './ui/SettingsPanel.svelte';
  import Toolbar from './ui/Toolbar.svelte';
  import ZoomPill from './ui/ZoomPill.svelte';
  import { errorMessage, showToast } from './ui/toast';

  type OpenPopover =
    | { type: 'preset'; kind: PresetKind; id: string; anchor: DOMRect }
    | { type: 'eraser'; anchor: DOMRect };

  let appEl: HTMLDivElement;
  let boardEl: HTMLDivElement;
  let popover = $state<OpenPopover | null>(null);
  let settingsOpen = $state(false);
  let ready = $state(false);

  const editing = $derived.by(() => {
    if (popover?.type !== 'preset') return null;
    const { kind, id } = popover;
    const preset = settings.presets(kind).find((p) => p.id === id);
    return preset ? { kind, preset } : null;
  });

  onMount(() => {
    const editor = board.attach(boardEl);
    mountStats(appEl, editor);
    void start(editor);
  });

  async function start(editor: ReturnType<typeof board.attach>) {
    await settings.load();
    ready = true;
    if (new URLSearchParams(location.search).has('bench')) {
      await runBench(editor);
      return;
    }
    try {
      await board.show(await window.chalkd.board.openInitial());
    } catch (err) {
      showToast(`Couldn't open your board: ${errorMessage(err)}`);
    }
  }

  // Rebuild the active tool whenever its settings change.
  $effect(() => {
    const snapshot = $state.snapshot(settings.value);
    if (ready) board.applySettings(snapshot);
  });

  $effect(() => {
    const theme = settings.value.theme;
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  });

  async function clearBoard() {
    popover = null;
    const ok = await dialogs.ask({
      title: 'Clear the whole board?',
      message: 'Everything on this board will be removed. You can undo this.',
      confirmLabel: 'Clear board',
      danger: true,
    });
    if (ok) board.editor?.clearBoard();
  }

  function onKey(e: KeyboardEvent) {
    if (!e.ctrlKey || popover || settingsOpen || dialogs.confirm) return;
    const key = e.key.toLowerCase();
    const editor = board.editor;
    if (key === 'z' && e.shiftKey) editor?.redo();
    else if (key === 'z') editor?.undo();
    else if (key === 'y') editor?.redo();
    else if (key === '0') editor?.zoomToActual();
    else if (key === '1') editor?.fitContent();
    else return;
    e.preventDefault();
  }
</script>

<svelte:window onkeydown={onKey} onbeforeunload={() => settings.flush()} />

<div class="app" bind:this={appEl}>
  <Toolbar
    onEditPreset={(kind, id, el) =>
      (popover = { type: 'preset', kind, id, anchor: el.getBoundingClientRect() })}
    onEraserMenu={(el) => (popover = { type: 'eraser', anchor: el.getBoundingClientRect() })}
    onSettings={() => {
      popover = null;
      settingsOpen = true;
    }}
  />
  <div class="board" bind:this={boardEl}></div>
  <ZoomPill />

  {#if editing && popover}
    <Popover
      anchor={popover.anchor}
      label="Edit {editing.kind}"
      width={360}
      onclose={() => (popover = null)}
    >
      <PresetEditor
        kind={editing.kind}
        preset={editing.preset}
        boardColor={board.background.color}
        canDelete={settings.presets(editing.kind).length > 1}
        onchange={(patch) => settings.updatePreset(editing.kind, editing.preset.id, patch)}
        ondelete={() => {
          settings.deletePreset(editing.kind, editing.preset.id);
          popover = null;
        }}
      />
    </Popover>
  {:else if popover?.type === 'eraser'}
    <Popover anchor={popover.anchor} label="Eraser" width={340} onclose={() => (popover = null)}>
      <EraserMenu
        eraser={settings.value.eraser}
        onchange={(patch) => settings.update({ eraser: { ...settings.value.eraser, ...patch } })}
        onclear={clearBoard}
      />
    </Popover>
  {/if}

  {#if settingsOpen}
    <SettingsPanel onclose={() => (settingsOpen = false)} />
  {/if}
  <ConfirmDialog />
</div>

<style>
  .app {
    position: fixed;
    inset: 0;
  }
  .board {
    position: absolute;
    top: var(--toolbar-h);
    left: 0;
    right: 0;
    bottom: 0;
    touch-action: none;
    overflow: hidden;
  }
</style>
