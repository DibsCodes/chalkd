import { existsSync } from 'node:fs';
import path from 'node:path';

export interface LaunchArgs {
  /** Set when the Chalkd printer's task started us: the job's title. */
  printedTitle: string | null;
  /** PDFs to open as boards ("Open with", "Send to", or the command line). */
  files: string[];
}

/**
 * Read what Chalkd was started with: `--printed=<title>` from the printer's
 * task, or PDF files. Electron and Chromium add switches of their own
 * (especially to a second instance's argv), so anything else is ignored.
 * The title has to be part of the same argument: Electron moves its own
 * switches in among a second instance's arguments.
 */
export function parseLaunchArgs(
  argv: string[],
  { skip = 1, cwd = process.cwd() }: { skip?: number; cwd?: string } = {},
): LaunchArgs {
  const result: LaunchArgs = { printedTitle: null, files: [] };
  for (const arg of argv.slice(skip)) {
    if (arg === '--printed') {
      result.printedTitle = '';
    } else if (arg.startsWith('--printed=')) {
      result.printedTitle = arg.slice('--printed='.length);
    } else if (!arg.startsWith('-') && /\.pdf$/i.test(arg)) {
      const file = path.resolve(cwd, arg);
      if (existsSync(file)) result.files.push(file);
    }
  }
  return result;
}

/** How many leading argv entries are Electron's, not ours. */
export function argvSkip(): number {
  return process.defaultApp ? 2 : 1;
}
