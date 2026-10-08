import {
  DEFAULT_BACKGROUND,
  HIGHLIGHTER_OPACITY,
  type AppSettings,
  type Background,
  type BoardData,
  type Bounds,
  type ExportOptions,
  type ImportFile,
} from '../../shared/types';
import { Autosave } from '../board/autosave';
import {
  contentArea,
  pdfHtml,
  renderPng,
  type ExportSource,
} from '../board/export';
import { AssetStore } from '../engine/assets';
import { importFiles } from '../board/import';
import { Editor } from '../engine/editor';
import { EraserTool } from '../engine/tools/eraser';
import { PenTool } from '../engine/tools/pen';
import { SelectTool } from '../engine/tools/select';
import type { Tool } from '../engine/tools/tool';
import { errorMessage, hideToast, showToast } from '../ui/toast';

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
  /** The current selection's size and on-board position (select tool only). */
  selection = $state<{
    count: number;
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  importing = $state(false);

  private autosave: Autosave | null = null;
  private selectTool: SelectTool | null = null;

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
        this.updateSelection();
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
    editor.input.options = { palmContactPx: s.palmContactPx };
    const tool = buildTool(editor, s);
    editor.setTool(tool);
    this.selectTool = tool instanceof SelectTool ? tool : null;
    this.selectTool?.onChange(() => this.updateSelection());
    this.updateSelection();
  }

  deleteSelection(): void {
    this.selectTool?.deleteSelection();
  }

  selectAll(): void {
    this.selectTool?.selectAll();
  }

  clearSelection(): void {
    this.selectTool?.clearSelection();
  }

  get hasSelection(): boolean {
    return (this.selectTool?.selected.length ?? 0) > 0;
  }

  /** Place pictures and PDF pages on the board. */
  async import(files: ImportFile[]): Promise<void> {
    const editor = this.editor;
    if (!editor || !files.length || this.importing) return;
    this.importing = true;
    try {
      const placed = await importFiles(editor, files, (m) =>
        showToast(m, 'import-progress'),
      );
      if (!placed)
        showToast(
          'Chalkd can import pictures (PNG, JPEG, WebP, GIF, SVG) and PDFs.',
        );
    } catch (err) {
      showToast(`Couldn't import that: ${errorMessage(err)}`);
    } finally {
      hideToast('import-progress');
      this.importing = false;
    }
  }

  /**
   * What to export: the open board as it is right now, or another board
   * read straight from disk (exporting from the drawer).
   */
  async exportSource(path: string | null): Promise<ExportSource> {
    const editor = this.editor!;
    if (path === null || path === this.path) {
      return {
        name: this.name,
        items: editor.scene.all(),
        assets: editor.assets,
        background: editor.background,
      };
    }
    const data = await window.chalkd.board.read(path);
    const assets = new AssetStore();
    assets.load(data.assets);
    return {
      name: data.name,
      items: data.items,
      assets,
      background: data.meta.background,
    };
  }

  /** The region an export covers, or null if there's nothing to export. */
  exportArea(
    src: ExportSource,
    opts: ExportOptions,
    isOpenBoard: boolean,
  ): Bounds | null {
    if (opts.format === 'png' && opts.area === 'view' && isOpenBoard) {
      return this.editor!.renderer.viewBounds();
    }
    return contentArea(src.items);
  }

  /** Export and save. Resolves to the saved path, or null if cancelled. */
  async export(
    src: ExportSource,
    area: Bounds,
    opts: ExportOptions,
  ): Promise<string | null> {
    if (opts.format === 'png') {
      return window.chalkd.export.png(
        src.name,
        await renderPng(src, area, opts.background),
      );
    }
    return window.chalkd.export.pdf(src.name, pdfHtml(src, area, opts));
  }

  /** Paste the picture on the clipboard, if there is one. */
  async paste(): Promise<void> {
    const file = await window.chalkd.import.clipboardImage();
    if (file) await this.import([file]);
    else showToast('There’s no picture on the clipboard to paste.');
  }

  private updateSelection(): void {
    const editor = this.editor;
    const tool = this.selectTool;
    const b = tool?.bounds();
    if (!editor || !tool || !b || !tool.selected.length) {
      this.selection = null;
      return;
    }
    const tl = editor.camera.toScreen(b.minX, b.minY);
    const br = editor.camera.toScreen(b.maxX, b.maxY);
    this.selection = {
      count: tool.selected.length,
      x: tl.x,
      y: tl.y,
      w: br.x - tl.x,
      h: br.y - tl.y,
    };
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
  if (t.type === 'select') return new SelectTool(editor);
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
