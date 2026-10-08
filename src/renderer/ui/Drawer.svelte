<script lang="ts" module>
  import { SvelteSet } from 'svelte/reactivity';

  /** Expanded notebooks, kept while the app runs so the drawer reopens as it was left. */
  const expanded = new SvelteSet<string>();
</script>

<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { LibraryState, TreeNode } from '../../shared/types';
  import { board } from '../state/board.svelte';
  import { dialogs } from '../state/dialogs.svelte';
  import Icon from './Icon.svelte';
  import Popover from './Popover.svelte';
  import { errorMessage, showToast } from './toast';

  let {
    onclose,
    onexport,
  }: { onclose: () => void; onexport: (path: string) => void } = $props();

  const LONG_PRESS_MS = 450;
  const SCROLL_SLOP_PX = 10;
  const DRAG_START_PX = 6;
  const HOVER_EXPAND_MS = 600;
  const EDGE_SCROLL_PX = 56;

  interface Row {
    node: TreeNode;
    depth: number;
    /** Placeholder shown inside an empty, expanded notebook. */
    empty?: boolean;
  }
  type Drop =
    | { kind: 'before' | 'after'; row: Row }
    | { kind: 'into'; row: Row };

  let tree = $state<TreeNode[]>([]);
  let loaded = $state(false);
  let busy = $state(false);
  let renaming = $state<string | null>(null);
  let draft = $state('');
  let menu = $state<{ node: TreeNode; anchor: DOMRect } | null>(null);
  let moving = $state<TreeNode | null>(null);
  let drag = $state<{ node: TreeNode; x: number; y: number; drop: Drop | null } | null>(null);
  let listEl: HTMLDivElement;

  const rows = $derived(flatten(tree, 0));
  const current = $derived(board.path);

  onMount(async () => {
    try {
      apply(await window.chalkd.library.tree());
      if (current) for (const a of ancestors(current)) expanded.add(a);
      loaded = true;
      await tick();
      listEl?.querySelector('.row.current')?.scrollIntoView({ block: 'center' });
    } catch (err) {
      showToast(`Couldn't read your notebooks: ${errorMessage(err)}`);
    }
  });

  // ---------- helpers ----------

  function flatten(nodes: TreeNode[], depth: number): Row[] {
    const out: Row[] = [];
    for (const node of nodes) {
      out.push({ node, depth });
      if (node.type === 'notebook' && expanded.has(node.path)) {
        const kids = node.children ?? [];
        if (kids.length) out.push(...flatten(kids, depth + 1));
        else out.push({ node, depth: depth + 1, empty: true });
      }
    }
    return out;
  }

  function rowKey(row: Row): string {
    return row.empty ? row.node.path + '#empty' : row.node.path;
  }

  function parentOf(path: string): string {
    const i = path.lastIndexOf('/');
    return i < 0 ? '' : path.slice(0, i);
  }

  function baseName(path: string): string {
    return path.slice(path.lastIndexOf('/') + 1);
  }

  function ancestors(path: string): string[] {
    const parts = path.split('/').slice(0, -1);
    return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
  }

  function isInside(path: string, ancestor: string): boolean {
    return path === ancestor || path.startsWith(ancestor + '/');
  }

  function siblingsOf(path: string): TreeNode[] {
    const parent = parentOf(path);
    if (!parent) return tree;
    return find(tree, parent)?.children ?? [];
  }

  function find(nodes: TreeNode[], path: string): TreeNode | null {
    for (const n of nodes) {
      if (n.path === path) return n;
      if (n.children && isInside(path, n.path)) {
        const hit = find(n.children, path);
        if (hit) return hit;
      }
    }
    return null;
  }

  function countBoards(node: TreeNode): number {
    if (node.type === 'board') return 1;
    return (node.children ?? []).reduce((sum, c) => sum + countBoards(c), 0);
  }

  function apply(state: LibraryState) {
    tree = state.tree;
    // Keep renamed or moved notebooks (and everything inside) expanded.
    const m = state.moved;
    if (m && m.from !== m.to) {
      // Copy first: the loop adds to the set it would otherwise be iterating.
      // oxlint-disable-next-line unicorn/no-useless-spread
      for (const p of [...expanded]) {
        if (isInside(p, m.from)) {
          expanded.delete(p);
          expanded.add(m.to + p.slice(m.from.length));
        }
      }
    }
  }

  const TRASH_FAILED = Symbol('trash failed');

  /** Run a library change with autosave paused, so nothing writes mid-move. */
  async function mutate(
    op: () => Promise<LibraryState>,
    opts: { quietTrashError?: boolean } = {},
  ): Promise<LibraryState | typeof TRASH_FAILED | null> {
    if (busy) return null;
    busy = true;
    try {
      await board.pause();
      const state = await op();
      apply(state);
      if (state.reopened) await board.show(state.reopened);
      else board.setPath(state.current);
      return state;
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      if (opts.quietTrashError && raw.includes('TRASH_FAILED')) return TRASH_FAILED;
      showToast(errorMessage(err));
      return null;
    } finally {
      board.resume();
      busy = false;
    }
  }

  // ---------- actions ----------

  async function openBoard(path: string) {
    if (path === current) {
      onclose();
      return;
    }
    if (busy) return;
    busy = true;
    try {
      await board.pause();
      await board.show(await window.chalkd.board.open(path));
      onclose();
    } catch (err) {
      showToast(`Couldn't open that board: ${errorMessage(err)}`);
    } finally {
      board.resume();
      busy = false;
    }
  }

  async function newBoard(notebook: string) {
    if (busy) return;
    busy = true;
    try {
      await board.pause();
      await board.show(await window.chalkd.library.createBoard(notebook));
      onclose();
    } catch (err) {
      showToast(`Couldn't create a board: ${errorMessage(err)}`);
    } finally {
      board.resume();
      busy = false;
    }
  }

  async function newNotebook(parent: string) {
    if (busy) return;
    busy = true;
    try {
      await board.pause();
      const data = await window.chalkd.library.createNotebook(parent);
      await board.show(data);
      apply(await window.chalkd.library.tree());
      // Open the new notebook and offer to name it right away.
      const notebook = parentOf(data.path);
      for (const a of [...ancestors(notebook), notebook]) expanded.add(a);
      startRename(find(tree, notebook)!);
    } catch (err) {
      showToast(`Couldn't create a notebook: ${errorMessage(err)}`);
    } finally {
      board.resume();
      busy = false;
    }
  }

  async function duplicate(path: string) {
    if (busy) return;
    busy = true;
    try {
      await board.pause();
      const data = await window.chalkd.library.duplicate(path);
      await board.show(data);
      apply(await window.chalkd.library.tree());
      // Offer to name the copy right away.
      startRename(find(tree, data.path)!);
    } catch (err) {
      showToast(`Couldn't duplicate the board: ${errorMessage(err)}`);
    } finally {
      board.resume();
      busy = false;
    }
  }

  function startRename(node: TreeNode) {
    menu = null;
    renaming = node.path;
    draft = node.name;
  }

  async function commitRename() {
    const path = renaming;
    renaming = null;
    if (!path) return;
    const node = find(tree, path);
    const name = draft.trim();
    if (!node || !name || name === node.name) return;
    await mutate(() => window.chalkd.library.rename(path, name));
  }

  async function remove(node: TreeNode) {
    menu = null;
    const boards = countBoards(node);
    const ok = await dialogs.ask(
      node.type === 'board'
        ? {
            title: `Delete “${node.name}”?`,
            message: 'The board will be moved to the trash.',
            confirmLabel: 'Delete board',
            danger: true,
          }
        : {
            title: `Delete notebook “${node.name}”?`,
            message:
              boards === 0
                ? 'The notebook is empty. It will be moved to the trash.'
                : `It holds ${boards} board${boards === 1 ? '' : 's'}. Everything will be moved to the trash.`,
            confirmLabel: 'Delete notebook',
            danger: true,
          },
    );
    if (!ok) return;
    const path = node.path;
    const state = await mutate(() => window.chalkd.library.delete(path), { quietTrashError: true });
    if (state !== TRASH_FAILED) return;
    const permanent = await dialogs.ask({
      title: 'The trash isn’t available here',
      message: `Your system couldn’t move “${node.name}” to the trash (this happens on some USB drives and network folders). Delete it permanently instead? This can’t be undone.`,
      confirmLabel: 'Delete permanently',
      danger: true,
    });
    if (permanent) await mutate(() => window.chalkd.library.delete(path, true));
  }

  async function moveTo(node: TreeNode, parent: string, before: string | null) {
    const state = await mutate(() => window.chalkd.library.move(node.path, parent, before));
    if (state && parent) for (const a of [...ancestors(parent), parent]) expanded.add(a);
  }

  /** Notebooks a node may be moved into ('' = top level). */
  function destinations(node: TreeNode): { path: string; name: string; depth: number }[] {
    const out = [{ path: '', name: 'Top level', depth: 0 }];
    const walk = (nodes: TreeNode[], depth: number) => {
      for (const n of nodes) {
        if (n.type !== 'notebook' || isInside(n.path, node.path)) continue;
        out.push({ path: n.path, name: n.name, depth });
        walk(n.children ?? [], depth + 1);
      }
    };
    walk(tree, 1);
    return out;
  }

  function tapRow(row: Row) {
    if (row.empty) return;
    if (row.node.type === 'board') void openBoard(row.node.path);
    else if (expanded.has(row.node.path)) expanded.delete(row.node.path);
    else expanded.add(row.node.path);
  }

  // ---------- press, long-press, and drag ----------

  let press: {
    row: Row;
    el: HTMLElement;
    id: number;
    sx: number;
    sy: number;
    armed: boolean;
    timer: ReturnType<typeof setTimeout> | null;
  } | null = null;
  let hoverTimer: ReturnType<typeof setTimeout> | null = null;
  let hoverPath: string | null = null;
  let scrollFrame = 0;

  function rowDown(e: PointerEvent, row: Row) {
    if (busy || renaming || press || row.empty || e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    press = {
      row,
      el,
      id: e.pointerId,
      sx: e.clientX,
      sy: e.clientY,
      armed: false,
      timer: setTimeout(() => {
        if (press) {
          press.timer = null;
          press.armed = true;
          press.el.classList.add('armed');
        }
      }, LONG_PRESS_MS),
    };
  }

  function listMove(e: PointerEvent) {
    if (!press || e.pointerId !== press.id) return;
    const moved = Math.hypot(e.clientX - press.sx, e.clientY - press.sy);
    if (!press.armed) {
      if (moved > SCROLL_SLOP_PX) endPress(); // they're scrolling
      return;
    }
    if (!drag && moved > DRAG_START_PX) {
      drag = { node: press.row.node, x: e.clientX, y: e.clientY, drop: null };
      startEdgeScroll();
    }
    if (drag) {
      drag.x = e.clientX;
      drag.y = e.clientY;
      drag.drop = dropAt(e.clientX, e.clientY);
      hoverToExpand(drag.drop);
    }
  }

  function listUp(e: PointerEvent) {
    if (!press || e.pointerId !== press.id) return;
    const { row, armed, el } = press;
    if (drag) {
      const d = drag.drop;
      endPress();
      if (d) void dropOn(row.node, d);
    } else {
      endPress();
      if (armed) menu = { node: row.node, anchor: el.getBoundingClientRect() };
      else tapRow(row);
    }
  }

  function endPress() {
    if (press?.timer) clearTimeout(press.timer);
    press?.el.classList.remove('armed');
    press = null;
    drag = null;
    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTimer = null;
    hoverPath = null;
    cancelAnimationFrame(scrollFrame);
  }

  /** Once a long-press is armed, stop the list from scrolling under the finger. */
  function blockScrollWhileArmed(node: HTMLElement) {
    const stop = (e: TouchEvent) => {
      if (press?.armed) e.preventDefault();
    };
    node.addEventListener('touchmove', stop, { passive: false });
    return { destroy: () => node.removeEventListener('touchmove', stop) };
  }

  function dropAt(x: number, y: number): Drop | null {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-row]');
    if (!el || !drag) return null;
    const row = rows[Number(el.dataset.row)];
    if (!row) return null;
    const dragged = drag.node;
    if (row.empty) {
      return isInside(row.node.path, dragged.path) ? null : { kind: 'into', row };
    }
    if (row.node.path === dragged.path) return null;
    if (dragged.type === 'notebook' && isInside(row.node.path, dragged.path)) return null;
    const r = el.getBoundingClientRect();
    const f = (y - r.top) / r.height;
    if (row.node.type === 'notebook') {
      if (f < 0.25) return { kind: 'before', row };
      if (f > 0.75 && !expanded.has(row.node.path)) return { kind: 'after', row };
      return { kind: 'into', row };
    }
    return { kind: f < 0.5 ? 'before' : 'after', row };
  }

  function hoverToExpand(d: Drop | null) {
    const path = d?.kind === 'into' && !d.row.empty ? d.row.node.path : null;
    if (path === hoverPath) return;
    hoverPath = path;
    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTimer = null;
    if (path && !expanded.has(path)) {
      hoverTimer = setTimeout(() => expanded.add(path), HOVER_EXPAND_MS);
    }
  }

  function startEdgeScroll() {
    const step = () => {
      if (!drag) return;
      const r = listEl.getBoundingClientRect();
      if (drag.y < r.top + EDGE_SCROLL_PX) listEl.scrollTop -= 8;
      else if (drag.y > r.bottom - EDGE_SCROLL_PX) listEl.scrollTop += 8;
      scrollFrame = requestAnimationFrame(step);
    };
    scrollFrame = requestAnimationFrame(step);
  }

  async function dropOn(node: TreeNode, d: Drop) {
    let parent: string;
    let before: string | null;
    if (d.kind === 'into') {
      parent = d.row.node.path;
      before = null;
    } else {
      parent = parentOf(d.row.node.path);
      if (d.kind === 'before') {
        before = baseName(d.row.node.path);
      } else {
        const sibs = siblingsOf(d.row.node.path);
        const i = sibs.findIndex((s) => s.path === d.row.node.path);
        const next = sibs.slice(i + 1).find((s) => s.path !== node.path);
        before = next ? baseName(next.path) : null;
      }
    }
    // Dropping right where it already is does nothing.
    const sibs = siblingsOf(node.path);
    const i = sibs.findIndex((s) => s.path === node.path);
    const nextName = sibs[i + 1] ? baseName(sibs[i + 1].path) : null;
    if (parent === parentOf(node.path) && before === nextName) return;
    await moveTo(node, parent, before);
  }

  function focusSelect(el: HTMLInputElement) {
    el.focus();
    el.select();
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape' && !renaming && !menu && !moving && !dialogs.confirm) onclose();
  }}
/>

<div class="scrim" onpointerdown={onclose} aria-hidden="true"></div>
<nav class="drawer" aria-label="Notebooks">
  <header>
    <h2>Notebooks</h2>
    <button type="button" class="icon-button" aria-label="Close" onclick={onclose}>
      <Icon name="close" />
    </button>
  </header>

  <div class="create">
    <button
      type="button"
      disabled={busy}
      onclick={() => newBoard(current ? parentOf(current) : '')}
    >
      <Icon name="plus" size={20} /> Board
    </button>
    <button
      type="button"
      disabled={busy}
      onclick={() => newNotebook(current ? parentOf(current) : '')}
    >
      <Icon name="plus" size={20} /> Notebook
    </button>
  </div>

  <div
    class="list"
    role="tree"
    tabindex="-1"
    bind:this={listEl}
    use:blockScrollWhileArmed
    onpointermove={listMove}
    onpointerup={listUp}
    onpointercancel={endPress}
  >
    {#each rows as row, i (rowKey(row))}
      {@const node = row.node}
      {@const isDrop = !!drag?.drop && rowKey(drag.drop.row) === rowKey(row)}
      {#if row.empty}
        <div
          class="row empty"
          data-row={i}
          class:drop-into={isDrop}
          style:--depth={row.depth}
        >
          No boards yet
        </div>
      {:else}
        <div
          class="row"
          role="treeitem"
          tabindex="0"
          aria-selected={node.path === current}
          aria-expanded={node.type === 'notebook' ? expanded.has(node.path) : undefined}
          data-row={i}
          class:current={node.path === current}
          class:dragging={drag?.node.path === node.path}
          class:drop-before={isDrop && drag?.drop?.kind === 'before'}
          class:drop-after={isDrop && drag?.drop?.kind === 'after'}
          class:drop-into={isDrop && drag?.drop?.kind === 'into'}
          style:--depth={row.depth}
          onpointerdown={(e) => rowDown(e, row)}
          oncontextmenu={(e) => {
            e.preventDefault();
            menu = { node, anchor: e.currentTarget.getBoundingClientRect() };
          }}
          onkeydown={(e) => {
            if (renaming) return;
            if (e.key === 'Enter') tapRow(row);
            else if (e.key === 'F2') startRename(node);
            else if (e.key === 'Delete') void remove(node);
          }}
        >
          {#if node.type === 'notebook'}
            <span class="chevron" class:open={expanded.has(node.path)}>
              <Icon name="chevron" size={18} />
            </span>
            <Icon name="notebook" size={20} />
          {:else}
            <span class="chevron"></span>
            <Icon name="board" size={20} />
          {/if}
          {#if renaming === node.path}
            <input
              class="rename"
              bind:value={draft}
              use:focusSelect
              onpointerdown={(e) => e.stopPropagation()}
              onkeydown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') void commitRename();
                else if (e.key === 'Escape') renaming = null;
              }}
              onblur={commitRename}
              aria-label="New name"
            />
          {:else}
            <span class="name">{node.name}</span>
          {/if}
        </div>
      {/if}
    {:else}
      {#if loaded}<p class="hint">No notebooks yet.</p>{/if}
    {/each}
  </div>
  <p class="footer-hint">Long-press an item to rename, duplicate, move, or delete it. Long-press and drag to reorder.</p>
</nav>

{#if drag}
  <div class="ghost" style:left="{drag.x + 14}px" style:top="{drag.y - 22}px">
    <Icon name={drag.node.type === 'board' ? 'board' : 'notebook'} size={18} />
    {drag.node.name}
  </div>
{/if}

{#if menu}
  {@const node = menu.node}
  <Popover anchor={menu.anchor} label="{node.name} options" width={260} onclose={() => (menu = null)}>
    <div class="menu">
      <button type="button" onclick={() => startRename(node)}>
        <Icon name="pencil" size={20} /> Rename
      </button>
      {#if node.type === 'notebook'}
        <button
          type="button"
          onclick={() => {
            const notebook = node.path; // read before `menu` (and so `node`) is cleared
            menu = null;
            void newBoard(notebook);
          }}
        >
          <Icon name="plus" size={20} /> New board here
        </button>
      {/if}
      {#if node.type === 'board'}
        <button
          type="button"
          onclick={() => {
            const board = node.path; // read before `menu` (and so `node`) is cleared
            menu = null;
            onexport(board);
          }}
        >
          <Icon name="share" size={20} /> Export…
        </button>
        <button
          type="button"
          onclick={() => {
            const board = node.path; // read before `menu` (and so `node`) is cleared
            menu = null;
            void duplicate(board);
          }}
        >
          <Icon name="copy" size={20} /> Duplicate
        </button>
      {/if}
      <button
        type="button"
        onclick={() => {
          moving = node; // before clearing `menu`, which `node` comes from
          menu = null;
        }}
      >
        <Icon name="move" size={20} /> Move to…
      </button>
      <button type="button" class="danger" onclick={() => remove(node)}>
        <Icon name="trash" size={20} /> Delete
      </button>
    </div>
  </Popover>
{/if}

{#if moving}
  {@const node = moving}
  <div class="move-scrim" onpointerdown={() => (moving = null)} aria-hidden="true"></div>
  <div class="move-dialog" role="dialog" aria-label="Move {node.name}">
    <h3>Move “{node.name}” to…</h3>
    <div class="destinations">
      {#each destinations(node) as d (d.path)}
        <button
          type="button"
          style:--depth={d.depth}
          disabled={d.path === parentOf(node.path)}
          aria-label="Move into {d.name}"
          onclick={() => {
            const item = node; // read before `moving` (and so `node`) is cleared
            moving = null;
            void moveTo(item, d.path, null);
          }}
        >
          <Icon name={d.path ? 'notebook' : 'folder'} size={20} />
          {d.name}
          {#if d.path === parentOf(node.path)}<span class="here">(here now)</span>{/if}
        </button>
      {/each}
    </div>
    <button type="button" class="cancel" onclick={() => (moving = null)}>Cancel</button>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: rgba(10, 14, 22, 0.25);
    z-index: 30;
  }
  .drawer {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    width: min(360px, 100vw);
    display: flex;
    flex-direction: column;
    background: var(--panel-bg);
    color: var(--fg);
    border-right: 1px solid var(--border);
    box-shadow: var(--shadow-lg);
    z-index: 31;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 8px 8px 20px;
  }
  h2 {
    margin: 0;
    font-size: 20px;
  }
  .create {
    display: flex;
    gap: 8px;
    padding: 0 16px 12px;
    border-bottom: 1px solid var(--border);
  }
  .create button {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: var(--touch-target);
    border-radius: 12px;
    border: 1px solid var(--border);
    background: none;
    color: var(--fg);
    font: inherit;
    font-weight: 600;
  }
  .list {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
    touch-action: pan-y;
  }
  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 52px;
    padding: 0 12px 0 calc(8px + var(--depth) * 22px);
    border-radius: 12px;
    color: var(--fg);
    transition: transform 120ms ease;
  }
  .row:active {
    background: var(--hover);
  }
  .row.current {
    background: var(--accent-soft);
    font-weight: 600;
  }
  :global(.row.armed) {
    transform: scale(1.02);
    background: var(--hover);
    box-shadow: var(--shadow);
  }
  .row.dragging {
    opacity: 0.4;
  }
  .row.drop-into {
    box-shadow: inset 0 0 0 2px var(--accent);
    background: var(--accent-soft);
  }
  .row.drop-before::before,
  .row.drop-after::after {
    content: '';
    position: absolute;
    left: calc(8px + var(--depth) * 22px);
    right: 8px;
    height: 3px;
    border-radius: 2px;
    background: var(--accent);
  }
  .row.drop-before::before {
    top: -2px;
  }
  .row.drop-after::after {
    bottom: -2px;
  }
  .row.empty {
    color: var(--muted);
    font-style: italic;
    padding-left: calc(38px + var(--depth) * 22px);
  }
  .chevron {
    display: grid;
    place-items: center;
    width: 18px;
    color: var(--muted);
    transition: transform 120ms ease;
  }
  .chevron.open {
    transform: rotate(90deg);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rename {
    flex: 1;
    min-width: 0;
    height: 38px;
    padding: 0 10px;
    border-radius: 8px;
    border: 2px solid var(--accent);
    background: var(--panel-bg);
    color: var(--fg);
    font: inherit;
    user-select: text;
  }
  .hint,
  .footer-hint {
    color: var(--muted);
    font-size: 13px;
    padding: 0 16px;
  }
  .footer-hint {
    margin: 0;
    padding: 12px 20px 16px;
    border-top: 1px solid var(--border);
  }
  .ghost {
    position: fixed;
    z-index: 40;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    border-radius: 12px;
    background: var(--panel-bg);
    color: var(--fg);
    box-shadow: var(--shadow-lg);
    font-weight: 600;
    pointer-events: none;
  }
  .menu {
    display: flex;
    flex-direction: column;
    margin: -8px;
  }
  .menu button,
  .destinations button {
    display: flex;
    align-items: center;
    gap: 12px;
    height: var(--touch-target);
    padding: 0 12px;
    border: 0;
    border-radius: 10px;
    background: none;
    color: var(--fg);
    font: inherit;
    font-weight: 500;
    text-align: left;
  }
  .menu button:active,
  .destinations button:active {
    background: var(--hover);
  }
  .menu .danger {
    color: var(--danger);
  }
  .move-scrim {
    position: fixed;
    inset: 0;
    background: rgba(10, 14, 22, 0.35);
    z-index: 37;
  }
  .move-dialog {
    position: fixed;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: min(420px, calc(100vw - 32px));
    max-height: calc(100vh - 80px);
    display: flex;
    flex-direction: column;
    padding: 20px;
    border-radius: 18px;
    background: var(--panel-bg);
    color: var(--fg);
    box-shadow: var(--shadow-lg);
    z-index: 38;
  }
  .move-dialog h3 {
    margin: 0 0 12px;
  }
  .destinations {
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }
  .destinations button {
    padding-left: calc(12px + var(--depth) * 20px);
  }
  .destinations button:disabled {
    color: var(--muted);
  }
  .here {
    font-size: 13px;
  }
  .cancel {
    margin-top: 12px;
    height: var(--touch-target);
    border-radius: 12px;
    border: 1px solid var(--border);
    background: none;
    color: var(--fg);
    font: inherit;
    font-weight: 600;
  }
</style>
