const VISIBLE_MS = 6000;

let host: HTMLElement | null = null;
const showing = new Map<string, HTMLElement>();

/**
 * A short message at the bottom of the screen. Toasts with the same `key`
 * (the message itself by default) replace each other instead of stacking.
 */
export function showToast(message: string, key = message): void {
  if (!host) {
    host = document.createElement('div');
    host.className = 'toasts';
    document.body.appendChild(host);
  }
  showing.get(key)?.remove();

  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = message;
  host.appendChild(el);
  showing.set(key, el);

  setTimeout(() => {
    if (showing.get(key) === el) hideToast(key);
  }, VISIBLE_MS);
}

export function hideToast(key: string): void {
  showing.get(key)?.remove();
  showing.delete(key);
}

/** Error text without Electron's "Error invoking remote method…" wrapper. */
export function errorMessage(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text
    .replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '')
    .replace(/^TRASH_FAILED: /, 'Couldn’t move it to the trash: ');
}
