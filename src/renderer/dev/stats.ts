import type { Editor } from '../engine/editor';

/** Ctrl+Shift+D toggles a small overlay with render timings. */
export function mountStats(root: HTMLElement, editor: Editor): void {
  const el = document.createElement('pre');
  el.className = 'dev-stats';
  el.hidden = true;
  root.appendChild(el);

  const tick = () => {
    if (el.hidden) return;
    const s = editor.renderer.stats;
    el.textContent = [
      `items     ${editor.scene.size}`,
      `visible   ${s.visible}`,
      `render    ${s.contentMs.toFixed(2)} ms`,
      `snapshot  ${s.usingSnapshot ? 'yes' : 'no'}`,
      `zoom      ${(editor.camera.zoom * 100).toFixed(0)}%`,
    ].join('\n');
    requestAnimationFrame(tick);
  };

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd') {
      el.hidden = !el.hidden;
      tick();
    }
  });
}
