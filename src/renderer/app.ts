import './app.css';
import { runBench } from './dev/bench';
import { mountStats } from './dev/stats';
import { Editor } from './engine/editor';
import { mountZoomPill } from './ui/zoom-pill';

const root = document.getElementById('app')!;
const board = document.getElementById('board')!;

const editor = new Editor(board);
mountZoomPill(root, editor);
mountStats(root, editor);

window.addEventListener('keydown', (e) => {
  if (!e.ctrlKey) return;
  const key = e.key.toLowerCase();
  if (key === 'z' && e.shiftKey) editor.redo();
  else if (key === 'z') editor.undo();
  else if (key === 'y') editor.redo();
  else if (key === '0') editor.zoomToActual();
  else if (key === '1') editor.fitContent();
  else return;
  e.preventDefault();
});

// Long-press would otherwise open Chromium's context menu.
window.addEventListener('contextmenu', (e) => e.preventDefault());

if (new URLSearchParams(location.search).has('bench')) runBench(editor);
