import { existsSync, mkdirSync, watch } from 'node:fs';
import path from 'node:path';
import type { PrintInbox } from './print-inbox';

const RETRY_MS = 500;
/** Give up on a file the spooler never lets go of. */
const GIVE_UP_MS = 60_000;
/**
 * How long a new file waits for the printer's task to claim it with its
 * title, before Chalkd takes it without one.
 */
const UNTITLED_AFTER_MS = 4000;

/**
 * Moves what the Windows Chalkd printer writes (one fixed file, see
 * scripts/printer-windows/install.ps1) into the print inbox as a job.
 *
 * The printer's task tells us the title (`claim(title)`); a watcher on the
 * file catches jobs the task missed, without a title. Until the spooler has
 * finished writing, Windows won't let the file be moved, so claims retry.
 */
export class SpoolClaims {
  private stopWatch: (() => void) | null = null;

  constructor(
    readonly spoolFile: string,
    private inbox: PrintInbox,
    private retryMs = RETRY_MS,
    private untitledAfterMs = UNTITLED_AFTER_MS,
  ) {}

  /** Take the file now if it's there, retrying while it's still being written. */
  claim(title = ''): Promise<boolean> {
    const started = Date.now();
    return new Promise((resolve) => {
      const attempt = () => {
        if (!existsSync(this.spoolFile)) return resolve(false);
        if (this.inbox.adopt(this.spoolFile, title, { move: true }))
          return resolve(true);
        // Gone (claimed elsewhere, or not a PDF and removed)?
        if (!existsSync(this.spoolFile)) return resolve(false);
        if (Date.now() - started > GIVE_UP_MS) return resolve(false);
        setTimeout(attempt, this.retryMs);
      };
      attempt();
    });
  }

  /** Watch for jobs the task doesn't announce. Also claims a leftover job now. */
  watch(): void {
    const dir = path.dirname(this.spoolFile);
    mkdirSync(dir, { recursive: true });
    let timer: ReturnType<typeof setTimeout> | null = null;
    const later = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void this.claim(), this.untitledAfterMs);
    };
    const watcher = watch(dir, (_event, name) => {
      if (!name || name === path.basename(this.spoolFile)) later();
    });
    if (existsSync(this.spoolFile)) later();
    this.stopWatch = () => {
      if (timer) clearTimeout(timer);
      watcher.close();
    };
  }

  stop(): void {
    this.stopWatch?.();
    this.stopWatch = null;
  }
}
