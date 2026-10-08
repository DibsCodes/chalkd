const VISIBLE_MS = 6000;

let host: HTMLElement | null = null;
const showing = new Map<string, HTMLElement>();

/** A short message at the bottom of the screen. Repeats don't stack. */
export function showToast(message: string): void {
  if (!host) {
    host = document.createElement('div');
    host.className = 'toasts';
    document.body.appendChild(host);
  }
  showing.get(message)?.remove();

  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = message;
  host.appendChild(el);
  showing.set(message, el);

  setTimeout(() => {
    el.remove();
    if (showing.get(message) === el) showing.delete(message);
  }, VISIBLE_MS);
}

/** Error text without Electron's "Error invoking remote method…" wrapper. */
export function errorMessage(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.replace(
    /^Error invoking remote method '[^']+': (\w*Error: )?/,
    '',
  );
}
