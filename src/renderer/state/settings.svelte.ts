import {
  DEFAULT_SETTINGS,
  type ActiveTool,
  type AppSettings,
  type Preset,
} from '../../shared/types';

export type PresetKind = 'pen' | 'highlighter';

const WRITE_DELAY_MS = 250;

/** App settings, reactive for the UI and written back to disk shortly after each change. */
class SettingsState {
  value = $state<AppSettings>(structuredClone(DEFAULT_SETTINGS));
  private pending: Partial<AppSettings> = {};
  private timer: ReturnType<typeof setTimeout> | null = null;

  async load(): Promise<void> {
    this.value = await window.chalkd.settings.get();
  }

  update(patch: Partial<AppSettings>): void {
    Object.assign(this.value, patch);
    Object.assign(this.pending, patch);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), WRITE_DELAY_MS);
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!Object.keys(this.pending).length) return;
    const patch = $state.snapshot(this.pending) as Partial<AppSettings>;
    this.pending = {};
    void window.chalkd.settings.update(patch);
  }

  // ---------- presets ----------

  presets(kind: PresetKind): Preset[] {
    return kind === 'pen' ? this.value.pens : this.value.highlighters;
  }

  selectTool(tool: ActiveTool): void {
    this.update({ tool });
  }

  isSelected(kind: PresetKind, id: string): boolean {
    const t = this.value.tool;
    return t.type === kind && t.presetId === id;
  }

  updatePreset(kind: PresetKind, id: string, patch: Partial<Preset>): void {
    this.setPresets(
      kind,
      this.presets(kind).map((p) => (p.id === id ? { ...p, ...patch } : p)),
    );
  }

  /** Copy a preset (the selected one, if it's this kind), select and return the copy. */
  duplicatePreset(kind: PresetKind): Preset {
    const list = this.presets(kind);
    const t = this.value.tool;
    const sourceIndex = Math.max(
      0,
      t.type === kind
        ? list.findIndex((p) => p.id === t.presetId)
        : list.length - 1,
    );
    const copy: Preset = { ...list[sourceIndex], id: crypto.randomUUID() };
    const next = [...list];
    next.splice(sourceIndex + 1, 0, copy);
    this.setPresets(kind, next);
    this.selectTool({ type: kind, presetId: copy.id });
    return copy;
  }

  deletePreset(kind: PresetKind, id: string): void {
    const list = this.presets(kind);
    if (list.length <= 1) return;
    const index = list.findIndex((p) => p.id === id);
    const next = list.filter((p) => p.id !== id);
    this.setPresets(kind, next);
    if (this.isSelected(kind, id)) {
      this.selectTool({
        type: kind,
        presetId: next[Math.min(index, next.length - 1)].id,
      });
    }
  }

  private setPresets(kind: PresetKind, list: Preset[]): void {
    this.update(kind === 'pen' ? { pens: list } : { highlighters: list });
  }
}

export const settings = new SettingsState();
