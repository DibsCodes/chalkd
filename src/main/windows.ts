import { app, shell } from 'electron';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Windows-only plumbing: the Squirrel installer's events, the "Send to"
 * shortcut, and the Chalkd printer (scripts/printer-windows), which stands
 * in for the CUPS printer on Linux.
 */

export const PRINTER_NAME = 'Chalkd';

/** Where Squirrel puts the launcher that always starts the newest version. */
function installedExe(): string | null {
  const exe = path.resolve(
    path.dirname(process.execPath),
    '..',
    path.basename(process.execPath),
  );
  const update = path.resolve(
    path.dirname(process.execPath),
    '..',
    'Update.exe',
  );
  return existsSync(update) && existsSync(exe) ? exe : null;
}

/** How to start this Chalkd from outside: a program and its first arguments. */
function launcher(): { command: string; args: string[] } {
  const exe = installedExe();
  if (exe) return { command: exe, args: [] };
  // From source (npm start), Electron needs to be told where the app is.
  return {
    command: process.execPath,
    args: process.defaultApp ? [app.getAppPath()] : [],
  };
}

function sendToShortcut(): string {
  return path.join(
    app.getPath('appData'),
    'Microsoft',
    'Windows',
    'SendTo',
    'Chalkd.lnk',
  );
}

/**
 * Handle the Squirrel installer running us with --squirrel-install and
 * friends. Returns true if it did, and the app should quit right away.
 */
export function handleSquirrelEvent(): boolean {
  if (process.platform !== 'win32') return false;
  const event = process.argv[1];
  if (!event?.startsWith('--squirrel-')) return false;
  const update = path.resolve(
    path.dirname(process.execPath),
    '..',
    'Update.exe',
  );
  const exe = path.basename(process.execPath);
  const target = installedExe() ?? process.execPath;
  switch (event) {
    case '--squirrel-install':
    case '--squirrel-updated':
      // Start menu and desktop shortcuts, and "Send to › Chalkd" for PDFs.
      spawnSync(update, ['--createShortcut', exe]);
      shell.writeShortcutLink(sendToShortcut(), {
        target,
        description: 'Open a PDF as a new board in Chalkd',
        icon: target,
        iconIndex: 0,
      });
      return true;
    case '--squirrel-uninstall':
      spawnSync(update, ['--removeShortcut', exe]);
      rmSync(sendToShortcut(), { force: true });
      // Removing the printer needs admin rights, so Windows asks. It runs on
      // its own: Squirrel only waits a few seconds for us.
      if (printerScripts()) runElevated('uninstall', {}, { wait: false });
      return true;
    case '--squirrel-obsolete':
      return true;
    default:
      // --squirrel-firstrun: the first normal start after installing.
      return false;
  }
}

// ---------- the Chalkd printer ----------

/** Where the Chalkd printer writes each job, and the inbox it lands in. */
export function windowsPrintPaths(): { spoolFile: string; inbox: string } {
  const base = path.join(
    process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'),
    'Chalkd Printer',
  );
  return {
    spoolFile: path.join(base, 'incoming', 'Chalkd.pdf'),
    inbox: path.join(base, 'printed'),
  };
}

function printerScripts(): string | null {
  const dir = app.isPackaged
    ? path.join(process.resourcesPath, 'printer-windows')
    : path.join(app.getAppPath(), 'scripts', 'printer-windows');
  return existsSync(path.join(dir, 'install.ps1')) ? dir : null;
}

/** Is the Chalkd printer set up on this PC? */
export function printerInstalled(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `if (Get-Printer -Name '${PRINTER_NAME}' -ErrorAction SilentlyContinue) { 'yes' }`,
      ],
      { windowsHide: true, timeout: 20000 },
      (err, stdout) => resolve(!err && stdout.trim() === 'yes'),
    );
  });
}

/**
 * Add or remove the Chalkd printer. Both need admin rights, so Windows asks
 * first. Resolves to null on success, or a message saying what went wrong.
 */
export async function setPrinter(on: boolean): Promise<string | null> {
  if (!printerScripts())
    return "This copy of Chalkd doesn't include the printer.";
  if (!on) return runElevated('uninstall', {});
  const { spoolFile } = windowsPrintPaths();
  mkdirSync(path.dirname(spoolFile), { recursive: true });
  const { command, args } = launcher();
  return runElevated('install', {
    SpoolFile: spoolFile,
    Launch: command,
    LaunchArgs: args.map((a) => `"${a}"`).join(' '),
    User: `${process.env.USERDOMAIN ?? os.hostname()}\\${os.userInfo().username}`,
  });
}

const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * Run scripts/printer-windows/<script>.ps1 as an administrator. Windows
 * shows its "allow this app to make changes" prompt first.
 */
function runElevated(
  script: 'install' | 'uninstall',
  params: Record<string, string>,
  { wait = true } = {},
): Promise<string | null> {
  const dir = printerScripts()!;
  const log = path.join(os.tmpdir(), `chalkd-printer-${process.pid}.log`);
  rmSync(log, { force: true });
  const call = [
    `& ${psQuote(path.join(dir, `${script}.ps1`))}`,
    ...Object.entries(params).map(([k, v]) => `-${k} ${psQuote(v)}`),
  ].join(' ');
  // The elevated PowerShell can't print back to us, so errors go to a file.
  const inner = `try { ${call} } catch { $_.ToString() | Out-File -Encoding utf8 ${psQuote(log)}; exit 1 }`;
  const encoded = Buffer.from(inner, 'utf16le').toString('base64');
  const outer = [
    '$p = Start-Process -FilePath powershell.exe -Verb RunAs -WindowStyle Hidden -PassThru',
    `-ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','${encoded}'`,
    wait ? '; $p.WaitForExit(); exit $p.ExitCode' : '',
  ].join(' ');

  if (!wait) {
    spawn('powershell.exe', ['-NoProfile', '-Command', outer], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', outer],
      { windowsHide: true },
      (err, _stdout, stderr) => {
        if (!err) return resolve(null);
        if (/cancel/i.test(stderr)) {
          return resolve('Windows didn’t give permission, so nothing changed.');
        }
        let message = '';
        try {
          message = readFileSync(log, 'utf8').replace(/^﻿/, '').trim();
        } catch {
          message = stderr.trim();
        }
        rmSync(log, { force: true });
        resolve(message || 'Something went wrong.');
      },
    );
  });
}
