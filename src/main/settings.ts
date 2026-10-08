import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_SETTINGS, type AppSettings } from '../shared/types';
import { writeFileAtomic } from './fs-util';

export type { AppSettings as Settings } from '../shared/types';

/** App settings in <configDir>/settings.json. Unknown keys are preserved. */
export class SettingsStore {
  private data: AppSettings & Record<string, unknown>;
  private file: string;

  constructor(configDir: string) {
    mkdirSync(configDir, { recursive: true });
    this.file = path.join(configDir, 'settings.json');
    this.data = { ...structuredClone(DEFAULT_SETTINGS) };
    try {
      Object.assign(this.data, JSON.parse(readFileSync(this.file, 'utf8')));
    } catch {
      // Missing or unreadable: start from defaults.
    }
  }

  all(): AppSettings {
    return structuredClone(this.data);
  }

  get<K extends keyof AppSettings>(key: K): AppSettings[K] {
    return this.data[key];
  }

  set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    this.update({ [key]: value } as Partial<AppSettings>);
  }

  update(patch: Partial<AppSettings>): void {
    let changed = false;
    for (const [key, value] of Object.entries(patch)) {
      if (JSON.stringify(this.data[key]) === JSON.stringify(value)) continue;
      this.data[key] = value;
      changed = true;
    }
    if (changed) {
      writeFileAtomic(this.file, JSON.stringify(this.data, null, 2) + '\n');
    }
  }
}
