import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { writeFileAtomic } from './fs-util';

export interface Settings {
  /** Library folder; null means the default (~/Documents/Chalkd). */
  rootDir: string | null;
  /** Last open board, relative to the library root. */
  lastBoard: string | null;
}

const DEFAULTS: Settings = { rootDir: null, lastBoard: null };

/** App settings in <configDir>/settings.json. Unknown keys are preserved. */
export class SettingsStore {
  private data: Settings & Record<string, unknown>;
  private file: string;

  constructor(configDir: string) {
    mkdirSync(configDir, { recursive: true });
    this.file = path.join(configDir, 'settings.json');
    this.data = { ...DEFAULTS };
    try {
      Object.assign(this.data, JSON.parse(readFileSync(this.file, 'utf8')));
    } catch {
      // Missing or unreadable: start from defaults.
    }
  }

  get<K extends keyof Settings>(key: K): Settings[K] {
    return this.data[key];
  }

  set<K extends keyof Settings>(key: K, value: Settings[K]): void {
    if (this.data[key] === value) return;
    this.data[key] = value;
    writeFileAtomic(this.file, JSON.stringify(this.data, null, 2) + '\n');
  }
}
