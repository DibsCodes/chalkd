import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  watch,
} from 'node:fs';
import path from 'node:path';
import type { PrintJob } from '../shared/types';

/**
 * The folder the Chalkd printer (scripts/printer/chalkd-backend) drops
 * jobs into. Each job is `<id>.pdf` plus an optional `<id>.title`; the PDF
 * is renamed into place last, so a `.pdf` file is always complete.
 */
export class PrintInbox {
  constructor(readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  /** Ids of finished jobs, oldest first (ids start with a timestamp). */
  pending(): string[] {
    let names: string[];
    try {
      names = readdirSync(this.dir);
    } catch {
      return [];
    }
    return names
      .filter((n) => n.endsWith('.pdf'))
      .map((n) => n.slice(0, -4))
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  }

  /** The oldest job, or null. It stays in the inbox until `done`. */
  take(): PrintJob | null {
    const id = this.pending()[0];
    if (id === undefined) return null;
    const titleFile = path.join(this.dir, `${id}.title`);
    return {
      id,
      title: existsSync(titleFile) ? readFileSync(titleFile, 'utf8') : '',
      bytes: readFileSync(path.join(this.dir, `${id}.pdf`)),
    };
  }

  done(id: string): void {
    // Ids come back from the renderer; never let one point elsewhere.
    if (id !== path.basename(id)) return;
    rmSync(path.join(this.dir, `${id}.pdf`), { force: true });
    rmSync(path.join(this.dir, `${id}.title`), { force: true });
  }

  /** Call `onJob` whenever a job may have arrived. Returns a stop function. */
  watch(onJob: () => void): () => void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const watcher = watch(this.dir, (_event, name) => {
      if (name && !name.endsWith('.pdf')) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(onJob, 150);
    });
    return () => {
      if (timer) clearTimeout(timer);
      watcher.close();
    };
  }
}

/** Common document extensions to drop from job titles. */
const DOC_EXT =
  /\.(pdf|odt|ods|odp|odg|docx?|xlsx?|pptx?|rtf|txt|html?|png|jpe?g|gif|webp|svg)$/i;
const MAX_NAME = 60;

/**
 * A board name from a print job's title, or null to use the usual
 * date-and-time name. "fractions-worksheet.pdf" becomes
 * "fractions-worksheet"; spool names like "(stdin)" and blank titles
 * get the default.
 */
export function printedBoardName(title: string): string | null {
  let name = title.replace(/\s+/g, ' ').trim().replace(DOC_EXT, '').trim();
  if (!name || /^\(?stdin\)?$|^smbprn\.\d+|^untitled( \d+)?$/i.test(name)) {
    return null;
  }
  if (name.length > MAX_NAME) {
    const cut = name.slice(0, MAX_NAME);
    const space = cut.lastIndexOf(' ');
    name = `${(space > MAX_NAME / 2 ? cut.slice(0, space) : cut).trim()}…`;
  }
  return name;
}
