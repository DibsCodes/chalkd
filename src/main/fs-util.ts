import { closeSync, fsyncSync, openSync, renameSync, writeSync } from 'node:fs';
import path from 'node:path';

/** Write a file so readers only ever see the old or the new contents. */
export function writeFileAtomic(file: string, data: string): void {
  const tmp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`,
  );
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameRetrying(tmp, file);
}

/** Errors Windows gives while something else briefly has the file open. */
const BUSY = new Set(['EPERM', 'EACCES', 'EBUSY']);
const RETRY_MS = [10, 25, 50, 100, 200, 400];

/**
 * `renameSync`, retried for a moment on Windows: antivirus, the search
 * indexer, and sync clients like OneDrive open new files for a moment, and
 * Windows won't rename a file while they do.
 */
export function renameRetrying(from: string, to: string): void {
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (
        process.platform !== 'win32' ||
        !BUSY.has(code) ||
        attempt >= RETRY_MS.length
      ) {
        throw err;
      }
      sleepSync(RETRY_MS[attempt]);
    }
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
