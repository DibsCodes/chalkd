import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { open } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PrintInbox } from '../src/main/print-inbox';
import { SpoolClaims } from '../src/main/spool-claims';

const PDF = '%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n';

let dir: string;
let spoolFile: string;
let inbox: PrintInbox;
let claims: SpoolClaims;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'chalkd-spool-'));
  spoolFile = path.join(dir, 'incoming', 'Chalkd.pdf');
  mkdirSync(path.dirname(spoolFile));
  inbox = new PrintInbox(path.join(dir, 'printed'));
  claims = new SpoolClaims(spoolFile, inbox, 20, 50);
});
afterEach(() => {
  claims.stop();
  rmSync(dir, { recursive: true, force: true });
});

describe('SpoolClaims', () => {
  it('moves a printed file into the inbox with its title', async () => {
    writeFileSync(spoolFile, PDF);
    expect(await claims.claim('Spelling list')).toBe(true);
    expect(readdirSync(path.dirname(spoolFile))).toEqual([]);
    expect(inbox.take()!.title).toBe('Spelling list');
  });

  it('has nothing to claim when nothing was printed', async () => {
    expect(await claims.claim('x')).toBe(false);
    expect(inbox.pending()).toEqual([]);
  });

  it('waits for the spooler to finish writing', async () => {
    const handle = await open(spoolFile, 'w');
    await handle.write('%PDF-1.7\n1 0 obj\n');
    const claimed = claims.claim('Worksheet');
    await new Promise((r) => setTimeout(r, 100));
    expect(inbox.pending()).toEqual([]);
    await handle.write('<<>>\nendobj\n%%EOF\n');
    await handle.close();
    expect(await claimed).toBe(true);
    expect(inbox.take()!.title).toBe('Worksheet');
  });

  it('picks up a job nobody announced, without a title', async () => {
    claims.watch();
    writeFileSync(spoolFile, PDF);
    await new Promise((r) => setTimeout(r, 400));
    const job = inbox.take();
    expect(job).not.toBeNull();
    expect(job!.title).toBe('');
  });
});
