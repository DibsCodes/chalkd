import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PrintInbox, printedBoardName } from '../src/main/print-inbox';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'chalkd-print-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const put = (name: string, body = '%PDF-1.7') =>
  writeFileSync(path.join(dir, name), body);

describe('PrintInbox', () => {
  it('hands out finished jobs oldest first, with their titles', () => {
    put('1791466115-10.pdf', 'second');
    put('1791466115-10.title', 'Spelling list');
    put('1791466099-9.pdf', 'first');
    put('1791466120-11.part'); // still being written
    const inbox = new PrintInbox(dir);

    expect(inbox.pending()).toEqual(['1791466099-9', '1791466115-10']);
    const job = inbox.take()!;
    expect(job.id).toBe('1791466099-9');
    expect(job.title).toBe('');
    expect(Buffer.from(job.bytes).toString()).toBe('first');
    // Not removed until done.
    expect(inbox.take()!.id).toBe('1791466099-9');

    inbox.done(job.id);
    const next = inbox.take()!;
    expect(next.title).toBe('Spelling list');
    inbox.done(next.id);
    expect(inbox.take()).toBeNull();
    expect(readdirSync(dir)).toEqual(['1791466120-11.part']);
  });

  it('sorts job numbers numerically', () => {
    put('1791466115-9.pdf');
    put('1791466115-10.pdf');
    put('1791466114-100.pdf');
    expect(new PrintInbox(dir).pending()).toEqual([
      '1791466114-100',
      '1791466115-9',
      '1791466115-10',
    ]);
  });

  it('ignores ids that try to leave the inbox', () => {
    const inner = path.join(dir, 'inbox');
    const inbox = new PrintInbox(inner);
    put('victim.pdf');
    inbox.done('../victim');
    expect(readdirSync(dir)).toContain('victim.pdf');
  });
});

describe('printedBoardName', () => {
  it('uses the document name without its extension', () => {
    expect(printedBoardName('Fractions worksheet.pdf')).toBe(
      'Fractions worksheet',
    );
    expect(printedBoardName('  unit 3   notes.docx ')).toBe('unit 3 notes');
    expect(printedBoardName('Photosynthesis - Wikipedia')).toBe(
      'Photosynthesis - Wikipedia',
    );
  });

  it('falls back to the default name for meaningless titles', () => {
    for (const t of ['', '   ', '(stdin)', 'Untitled 1', 'smbprn.00000042'])
      expect(printedBoardName(t)).toBeNull();
  });

  it('shortens long titles at a word boundary', () => {
    const name = printedBoardName(
      'The Water Cycle: Evaporation, Condensation, Precipitation and Collection Explained for Grade 4',
    )!;
    expect(name.length).toBeLessThanOrEqual(61);
    expect(name.endsWith('…')).toBe(true);
    expect(name).toBe(
      'The Water Cycle: Evaporation, Condensation, Precipitation…',
    );
  });
});
