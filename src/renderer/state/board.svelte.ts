import {
  DEFAULT_BACKGROUND,
  HIGHLIGHTER_OPACITY,
  type AppSettings,
  type Background,
  type BoardData,
} from '../../shared/types';
import { Autosave } from '../board/autosave';
import { Editor } from '../engine/editor';
import { EraserTool } from '../engine/tools/eraser';
import { PenTool } from '../engine/tools/pen';
import type { Tool } from '../engine/tools/tool';
import { errorMessage, showToast } from '../ui/toast';

/** The open board: owns the editor and its autosave, and exposes UI state. */
class BoardController {
  editor: Editor | null = null;
  name = $state('');
  /** Library-relative path of the open board. */
  path = $state<string | null>(null);
  canUndo = $state(false);
  canRedo = $state(false);
  zoom = $state(1);
  background = $state<Background>(DEFAULT_BACKGROUND);

  private autosave: Autosave | null = null;

  attach(container: HTMLElement): Editor {
    const editor = new Editor(container);
    this.editor = editor;
    editor.history.onChange(() => {
      this.canUndo = editor.history.canUndo;
      this.canRedo = editor.history.canRedo;
    });
    let queued = false;
    editor.onCameraChange(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        this.zoom = editor.camera.zoom;
      });
    });
    editor.onBackgroundChange((bg) => (this.background = bg));
    window.addEventListener('beforeunload', () => this.autosave?.flushSync());
    return editor;
  }

  /** Show a board, saving whatever was open before. */
  async show(data: BoardData): Promise<void> {
    const editor = this.editor!;
    await this.autosave?.dispose();
    this.autosave = null;
    editor.load(data);
    this.setPath(data.path);
    this.background = data.meta.background;
    this.zoom = editor.camera.zoom;
    this.resume();
  }

  /**
   * Save everything and stop autosaving, before the board file is closed,
   * moved, or swapped for another. Pair with `resume` or `show`.
   */
  async pause(): Promise<void> {
    await this.autosave?.dispose();
    this.autosave = null;
  }

  /** Start autosaving again (no-op if it's already running). */
  resume(): void {
    if (this.autosave || !this.editor || this.path === null) return;
    this.autosave = new Autosave(this.editor, window.chalkd.board, (err) =>
      showToast(`Couldn't save: ${errorMessage(err)}`),
    );
  }

  /** The open board was renamed or moved (it's the same board). */
  setPath(path: string | null): void {
    this.path = path;
    this.name = path ? boardName(path) : '';
    document.title = path ? `${this.name} · Chalkd` : 'Chalkd';
  }

  applySettings(s: AppSettings): void {
    const editor = this.editor;
    if (!editor) return;
    editor.input.options = {
      tapGestures: s.tapGestures,
      palmContactPx: s.palmContactPx,
    };
    editor.setTool(buildTool(editor, s));
  }

  setBackground(bg: Background): void {
    this.editor?.setBackground(bg);
  }
}

function boardName(path: string): string {
  return path
    .split('/')
    .pop()!
    .replace(/\.chalkd$/, '');
}

function buildTool(editor: Editor, s: AppSettings): Tool {
  const t = s.tool;
  if (t.type === 'eraser') return new EraserTool(editor, { ...s.eraser });
  const list = t.type === 'pen' ? s.pens : s.highlighters;
  const preset = list.find((p) => p.id === t.presetId) ?? s.pens[0];
  const kind = list.includes(preset) ? t.type : 'pen';
  return new PenTool(
    editor,
    {
      kind,
      color: preset.color,
      width: preset.width,
      opacity: kind === 'highlighter' ? HIGHLIGHTER_OPACITY : 1,
    },
    s.smoothing,
  );
}

export const board = new BoardController();
