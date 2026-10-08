import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseLaunchArgs } from '../src/main/launch-args';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'chalkd-args-'));
  writeFileSync(path.join(dir, 'Worksheet.PDF'), '%PDF-');
  writeFileSync(path.join(dir, 'notes.txt'), 'hi');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('parseLaunchArgs', () => {
  it('reads the title the printer task passes', () => {
    expect(
      parseLaunchArgs(['chalkd.exe', '--printed=Microsoft Word - Unit 3.docx'])
        .printedTitle,
    ).toBe('Microsoft Word - Unit 3.docx');
    // Electron can put its own switches right after ours.
    expect(
      parseLaunchArgs([
        'chalkd.exe',
        '--printed=Notes',
        '--allow-file-access-from-files',
      ]).printedTitle,
    ).toBe('Notes');
    expect(
      parseLaunchArgs(['chalkd.exe', '--printed=Notes']).printedTitle,
    ).toBe('Notes');
    expect(parseLaunchArgs(['chalkd.exe', '--printed']).printedTitle).toBe('');
    expect(parseLaunchArgs(['chalkd.exe']).printedTitle).toBeNull();
  });

  it('keeps PDFs that exist, relative to where it was started', () => {
    const args = parseLaunchArgs(
      ['chalkd.exe', 'Worksheet.PDF', 'notes.txt', 'missing.pdf'],
      { cwd: dir },
    );
    expect(args.files).toEqual([path.join(dir, 'Worksheet.PDF')]);
  });

  it("skips Electron's own arguments and Chromium switches", () => {
    const args = parseLaunchArgs(
      [
        'electron.exe',
        'C:\\dev\\chalkd',
        '--allow-file-access-from-files',
        path.join(dir, 'Worksheet.PDF'),
      ],
      { skip: 2 },
    );
    expect(args).toEqual({
      printedTitle: null,
      files: [path.join(dir, 'Worksheet.PDF')],
    });
  });
});
