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
  renameSync(tmp, file);
}
