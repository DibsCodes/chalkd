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
  import ExportDialog from './ui/ExportDialog.svelte';
  import ImportMenu from './ui/ImportMenu.svelte';
  import SelectionBar from './ui/SelectionBar.svelte';
  import { IMPORTABLE } from './board/import';
  import Popover from './ui/Popover.svelte';
  import PresetEditor from './ui/PresetEditor.svelte';
  import PresetPicker from './ui/PresetPicker.svelte';
  import SettingsPanel from './ui/SettingsPanel.svelte';
  import Toolbar from './ui/Toolbar.svelte';
  import ZoomPill from './ui/ZoomPill.svelte';
  import { POPOVER_SIDE } from './ui/toolbar-layout';
  import { errorMessage, showToast } from './ui/toast';

  type OpenPopover =
    | { type: 'preset'; kind: PresetKind; id: string; anchor: DOMRect }
    | { type: 'presets'; kind: PresetKind; anchor: DOMRect }
    | { type: 'eraser'; anchor: DOMRect }
    | { type: 'import'; anchor: DOMRect };

  let appEl: HTMLDivElement;
  let boardEl: HTMLDivElement;
  let popover = $state<OpenPopover | null>(null);
  let settingsOpen = $state(false);
  let drawerOpen = $state(false);
  /** Board being exported: null = the open board; undefined = no dialog. */
  let exporting = $state<string | null | undefined>(undefined);
  let ready = $state(false);
  /** Toolbar popovers open toward the board. */
  const side = $derived(POPOVER_SIDE[settings.value.toolbarPosition]);

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
        camera: () => editor.camera.state,
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
    // Anything printed while Chalkd was closed, then whatever comes later.
    window.chalkd.print.onWaiting(() => void receivePrints());
    await receivePrints();
  }

  let receiving = false;
  let printArrived = false;

  /** Turn each job from the Chalkd printer into a board, one at a time. */
  async function receivePrints() {
    printArrived = true;
    if (receiving) return;
    receiving = true;
    try {
      while (printArrived) {
        printArrived = false;
        for (let job = await window.chalkd.print.take(); job; job = await window.chalkd.print.take()) {
          // Let a picture or PDF that's still importing finish first.
          while (board.importing) await new Promise((r) => setTimeout(r, 200));
          drawerOpen = false;
          settingsOpen = false;
          popover = null;
          try {
            await board.receivePrint(job);
          } finally {
            await window.chalkd.print.done(job.id);
          }
        }
      }
    } finally {
      receiving = false;
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

  $effect(() => {
    document.documentElement.style.setProperty(
      '--toolbar-scale',
      String(settings.value.toolbarScale),
    );
  });

  $effect(() => {
    document.documentElement.dataset.toolbar = settings.value.toolbarPosition;
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
    if (popover || settingsOpen || drawerOpen || dialogs.confirm || exporting !== undefined) return;
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
    onMorePresets={(kind, el) =>
      (popover = { type: 'presets', kind, anchor: el.getBoundingClientRect() })}
    onEraserMenu={(el) => (popover = { type: 'eraser', anchor: el.getBoundingClientRect() })}
    onImport={(el) => (popover = { type: 'import', anchor: el.getBoundingClientRect() })}
    onExport={() => {
      popover = null;
      exporting = null;
    }}
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
      {side}
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
  {:else if popover?.type === 'presets'}
    {@const { kind, anchor } = popover}
    <Popover
      {anchor}
      {side}
      label={kind === 'pen' ? 'Pens' : 'Highlighters'}
      width={300}
      onclose={() => (popover = null)}
    >
      <PresetPicker
        {kind}
        onpick={() => (popover = null)}
        onedit={(id) => (popover = { type: 'preset', kind, id, anchor })}
        onadd={() => {
          const copy = settings.duplicatePreset(kind);
          popover = { type: 'preset', kind, id: copy.id, anchor };
        }}
      />
    </Popover>
  {:else if popover?.type === 'eraser'}
    <Popover
      anchor={popover.anchor}
      {side}
      label="Eraser"
      width={340}
      onclose={() => (popover = null)}
    >
      <EraserMenu
        eraser={settings.value.eraser}
        onchange={(patch) => settings.update({ eraser: { ...settings.value.eraser, ...patch } })}
        onclear={clearBoard}
      />
    </Popover>
  {:else if popover?.type === 'import'}
    <Popover
      anchor={popover.anchor}
      {side}
      label="Import"
      width={330}
      onclose={() => (popover = null)}
    >
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
    <Drawer onclose={() => (drawerOpen = false)} onexport={(path) => (exporting = path)} />
  {/if}
  {#if settingsOpen}
    <SettingsPanel onclose={() => (settingsOpen = false)} />
  {/if}
  {#if exporting !== undefined}
    <ExportDialog path={exporting} onclose={() => (exporting = undefined)} />
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
    inset: var(--board-top) var(--board-right) var(--board-bottom) var(--board-left);
    pointer-events: none;
    overflow: hidden;
  }
  .board-overlay > :global(*) {
    pointer-events: auto;
  }
  .board {
    position: absolute;
    inset: var(--board-top) var(--board-right) var(--board-bottom) var(--board-left);
    touch-action: none;
    overflow: hidden;
  }
</style>
