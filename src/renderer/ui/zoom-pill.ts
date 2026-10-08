import type { Editor } from '../engine/editor';

/** Bottom-right zoom readout; tapping it offers 100% and Fit content. */
export function mountZoomPill(root: HTMLElement, editor: Editor): void {
  const wrap = document.createElement('div');
  wrap.className = 'zoom-pill';

  const menu = document.createElement('div');
  menu.className = 'zoom-menu';
  menu.hidden = true;

  const pill = document.createElement('button');
  pill.className = 'zoom-readout';
  pill.type = 'button';

  const item = (label: string, action: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', () => {
      menu.hidden = true;
      action();
    });
    return b;
  };
  menu.append(
    item('100%', () => editor.zoomToActual()),
    item('Fit content', () => editor.fitContent()),
  );

  pill.addEventListener('click', () => {
    menu.hidden = !menu.hidden;
  });
  // Any interaction with the board closes the menu.
  root.addEventListener('pointerdown', (e) => {
    if (!wrap.contains(e.target as Node)) menu.hidden = true;
  });

  wrap.append(menu, pill);
  root.appendChild(wrap);

  let queued = false;
  const update = () => {
    queued = false;
    pill.textContent = `${Math.round(editor.camera.zoom * 100)}%`;
  };
  editor.onCameraChange(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  });
  update();
}
