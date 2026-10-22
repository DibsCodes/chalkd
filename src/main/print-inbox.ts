import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  watch,
  writeFileSync,
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

  /**
   * Add a job from a finished PDF somewhere else: a file opened with Chalkd,
   * or what the Windows printer port wrote. With `move`, the file is taken
   * (renamed) rather than copied — on Windows that rename fails while the
   * print spooler is still writing, so a false return means "try again".
   * Returns false if the file isn't there, is still busy, or isn't a PDF.
   */
  adopt(file: string, title: string, { move = false } = {}): boolean {
    // Checked before touching it, so a half-written file stays put to retry.
    if (!isCompletePdf(file)) return false;
    const id = `${Math.floor(Date.now() / 1000)}-c${++adopted}`;
    const part = path.join(this.dir, `${id}.part`);
    try {
      if (move) renameSync(file, part);
      else copyFileSync(file, part);
    } catch {
      return false;
    }
    if (!isCompletePdf(part)) {
      // It changed under us; don't hand out a broken job.
      rmSync(part, { force: true });
      return false;
    }
    if (title) writeFileSync(path.join(this.dir, `${id}.title`), title);
    renameSync(part, path.join(this.dir, `${id}.pdf`));
    return true;
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

let adopted = 0;

/** Starts with %PDF- and has an %%EOF near the end. */
function isCompletePdf(file: string): boolean {
  let fd: number | null = null;
  try {
    const size = statSync(file).size;
    if (size < 16) return false;
    fd = openSync(file, 'r');
    const head = Buffer.alloc(5);
    readSync(fd, head, 0, 5, 0);
    const tailLength = Math.min(size, 1024);
    const tail = Buffer.alloc(tailLength);
    readSync(fd, tail, 0, tailLength, size - tailLength);
    return head.toString('latin1') === '%PDF-' && tail.includes('%%EOF');
  } catch {
    return false;
  } finally {
    if (fd !== null) closeSync(fd);
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
  let name = title
    .replace(/\s+/g, ' ')
    .trim()
    // Windows apps often put their own name in the job title.
    .replace(/^Microsoft (Word|Excel|PowerPoint) - /i, '')
    .replace(/ - (Notepad|Paint|WordPad)$/i, '')
    .trim()
    .replace(DOC_EXT, '')
    .trim();
  if (
    !name ||
    /^\(?stdin\)?$|^smbprn\.\d+|^untitled( \d+)?$|^\*?untitled$|^(print )?document$/i.test(
      name,
    )
  ) {
    return null;
  }
  if (name.length > MAX_NAME) {
    const cut = name.slice(0, MAX_NAME);
    const space = cut.lastIndexOf(' ');
    name = `${(space > MAX_NAME / 2 ? cut.slice(0, space) : cut).trim()}…`;
  }
  return name;
}
