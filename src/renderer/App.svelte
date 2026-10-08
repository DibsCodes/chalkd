<script lang="ts">
  import { onMount } from 'svelte';
  import { runBench } from './dev/bench';
  import { mountStats } from './dev/stats';
  import { board } from './state/board.svelte';
  import { dialogs } from './state/dialogs.svelte';
  import { settings, type PresetKind } from './state/settings.svelte';
  import ConfirmDialog from './ui/ConfirmDialog.svelte';
  import Drawer from './ui/Drawer.svelte';
  import EraserMenu from './ui/EraserMenu.svelte';
  import ImportMenu from './ui/ImportMenu.svelte';
  import SelectionBar from './ui/SelectionBar.svelte';
  import { IMPORTABLE } from './board/import';
  import Popover from './ui/Popover.svelte';
  import PresetEditor from './ui/PresetEditor.svelte';
  import SettingsPanel from './ui/SettingsPanel.svelte';
  import Toolbar from './ui/Toolbar.svelte';
  import ZoomPill from './ui/ZoomPill.svelte';
  import { errorMessage, showToast } from './ui/toast';

  type OpenPopover =
    | { type: 'preset'; kind: PresetKind; id: string; anchor: DOMRect }
    | { type: 'eraser'; anchor: DOMRect }
    | { type: 'import'; anchor: DOMRect };

  let appEl: HTMLDivElement;
  let boardEl: HTMLDivElement;
  let popover = $state<OpenPopover | null>(null);
  let settingsOpen = $state(false);
  let drawerOpen = $state(false);
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
    if (new URLSearchParams(location.search).has('selftest')) {
      // Lets the self-test import generated files without a file dialog.
      (window as unknown as Record<string, unknown>).__chalkdTest = {
        import: (files: { name: string; mime: string; b64: string }[]) =>
          board.import(
            files.map((f) => ({
              name: f.name,
              mime: f.mime,
              bytes: Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0)),
            })),
          ),
      };
    }
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

  /** Files dragged in from the file manager. */
  async function onDrop(e: DragEvent) {
    e.preventDefault();
    const files = [...(e.dataTransfer?.files ?? [])].filter((f) => IMPORTABLE.test(f.type));
    if (!files.length) return;
    await board.import(
      await Promise.all(
        files.map(async (f) => ({
          name: f.name,
          mime: f.type,
          bytes: new Uint8Array(await f.arrayBuffer()),
        })),
      ),
    );
  }

  async function importFromFile() {
    popover = null;
    await board.import(await window.chalkd.import.chooseFiles());
  }

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
    if (popover || settingsOpen || drawerOpen || dialogs.confirm) return;
    if (e.target instanceof HTMLInputElement) return;
    const key = e.key.toLowerCase();
    const editor = board.editor;
    if (!e.ctrlKey) {
      if ((key === 'delete' || key === 'backspace') && board.hasSelection) board.deleteSelection();
      else if (key === 'escape') board.clearSelection();
      else return;
      e.preventDefault();
      return;
    }
    if (key === 'v') void board.paste();
    else if (key === 'a' && settings.value.tool.type === 'select') board.selectAll();
    else if (key === 'z' && e.shiftKey) editor?.redo();
    else if (key === 'z') editor?.undo();
    else if (key === 'y') editor?.redo();
    else if (key === '0') editor?.zoomToActual();
    else if (key === '1') editor?.fitContent();
    else return;
    e.preventDefault();
  }
</script>

<svelte:window
  onkeydown={onKey}
  onbeforeunload={() => settings.flush()}
  ondragover={(e) => e.preventDefault()}
  ondrop={onDrop}
/>

<div class="app" bind:this={appEl}>
  <Toolbar
    onMenu={() => {
      popover = null;
      drawerOpen = true;
    }}
    onEditPreset={(kind, id, el) =>
      (popover = { type: 'preset', kind, id, anchor: el.getBoundingClientRect() })}
    onEraserMenu={(el) => (popover = { type: 'eraser', anchor: el.getBoundingClientRect() })}
    onImport={(el) => (popover = { type: 'import', anchor: el.getBoundingClientRect() })}
    onSettings={() => {
      popover = null;
      settingsOpen = true;
    }}
  />
  <div class="board" bind:this={boardEl}></div>
  <div class="board-overlay">
    <SelectionBar />
  </div>
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
  {:else if popover?.type === 'import'}
    <Popover anchor={popover.anchor} label="Import" width={330} onclose={() => (popover = null)}>
      <ImportMenu
        onfile={importFromFile}
        onpaste={() => {
          popover = null;
          void board.paste();
        }}
      />
    </Popover>
  {/if}

  {#if drawerOpen}
    <Drawer onclose={() => (drawerOpen = false)} />
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
  .board-overlay {
    position: absolute;
    top: var(--toolbar-h);
    left: 0;
    right: 0;
    bottom: 0;
    pointer-events: none;
    overflow: hidden;
  }
  .board-overlay > :global(*) {
    pointer-events: auto;
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
