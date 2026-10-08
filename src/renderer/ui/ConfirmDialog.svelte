<script lang="ts">
  import { dialogs } from '../state/dialogs.svelte';
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && dialogs.confirm?.resolve(false)} />

{#if dialogs.confirm}
  {@const req = dialogs.confirm}
  <div class="scrim" onpointerdown={() => req.resolve(false)} aria-hidden="true"></div>
  <div class="dialog" role="alertdialog" aria-labelledby="confirm-title" aria-describedby="confirm-message">
    <h2 id="confirm-title">{req.title}</h2>
    <p id="confirm-message">{req.message}</p>
    <div class="actions">
      <button type="button" onclick={() => req.resolve(false)}>Cancel</button>
      <button type="button" class="primary" class:danger={req.danger} onclick={() => req.resolve(true)}>
        {req.confirmLabel}
      </button>
    </div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: rgba(10, 14, 22, 0.35);
    z-index: 40;
  }
  .dialog {
    position: fixed;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: min(420px, calc(100vw - 32px));
    padding: 24px;
    border-radius: 18px;
    background: var(--panel-bg);
    color: var(--fg);
    box-shadow: var(--shadow-lg);
    z-index: 41;
  }
  h2 {
    margin: 0 0 8px;
    font-size: 20px;
  }
  p {
    margin: 0 0 20px;
    color: var(--muted);
    line-height: 1.45;
  }
  .actions {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
  }
  button {
    min-width: 110px;
    height: var(--touch-target);
    padding: 0 18px;
    border-radius: 12px;
    border: 1px solid var(--border);
    background: none;
    color: var(--fg);
    font: inherit;
    font-weight: 600;
  }
  .primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .primary.danger {
    background: var(--danger);
    border-color: var(--danger);
  }
</style>
