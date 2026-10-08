# Chalkd on Windows

## Building

On Windows, from a checkout:

```sh
npm install
npm run make
```

This writes:

- `out/make/squirrel.windows/x64/Chalkd-<version>-Setup.exe`: the installer.
  It installs for the current user without admin rights, into
  `%LOCALAPPDATA%\chalkd`, and adds Start menu and desktop shortcuts plus
  **Send to › Chalkd** (opens a PDF as a new board). Uninstall from
  Settings › Apps.
- `out/make/zip/win32/x64/Chalkd-win32-x64-<version>.zip`: a portable copy.
  The printer and Send to need the installer.

CI (`.github/workflows/build.yml`) builds both and attaches them to each
GitHub release.

After changing the icons in `packaging/icons`, run `npm run icons:ico` to
rebuild `chalkd.ico`.

## Where things live

| What                 | Where                                                 |
| -------------------- | ----------------------------------------------------- |
| Notebooks and boards | `Documents\Chalkd` (Settings › Storage can change it) |
| Settings             | `%APPDATA%\chalkd\settings.json`                      |
| Printer inbox        | `%LOCALAPPDATA%\Chalkd Printer\`                      |

If Documents is synced by OneDrive, boards sync too. Chalkd retries saves
that OneDrive or antivirus briefly block, but if boards ever show up as
"online only", choose a folder outside OneDrive in Settings › Storage.

## The Chalkd printer

Windows has no CUPS, so `scripts/printer-windows/install.ps1` builds the same
feature from Windows' own parts:

1. A printer named **Chalkd** using the built-in _Microsoft Print To PDF_
   driver, whose port is a file path, so each job is written to
   `%LOCALAPPDATA%\Chalkd Printer\incoming\Chalkd.pdf` with no save dialog.
2. The print service's "document printed" event (307, in
   `Microsoft-Windows-PrintService/Operational`, which the script turns on).
3. A scheduled task for the user that runs on that event and starts Chalkd
   with `--printed=<document title>`. A running Chalkd gets that from the
   second launch (one instance at a time); otherwise this starts it.
4. Chalkd moves the file into its inbox and opens it as a board named after
   the document. If the task doesn't fire, Chalkd still picks the file up
   after a few seconds, with the usual date-and-time name.

People add it from **Settings › Printing › Add the Chalkd printer…**, which
asks Windows for admin permission (on a school PC, IT may need to approve
it). It's set up for the person who added it. Uninstalling Chalkd removes it
(Windows asks for permission again).

By hand, from an admin PowerShell:

```powershell
.\scripts\printer-windows\install.ps1 -SpoolFile "$env:LOCALAPPDATA\Chalkd Printer\incoming\Chalkd.pdf" -Launch "$env:LOCALAPPDATA\chalkd\chalkd.exe" -User "$env:USERDOMAIN\$env:USERNAME"
.\scripts\printer-windows\uninstall.ps1
```

## Touch

Windows 11 uses three- and four-finger touchscreen swipes for switching apps
and showing the desktop, so they never reach Chalkd's pan and four-finger
zoom. Chalkd says so once on touchscreens, and Settings › Touch links to the
Windows setting ("Three- and four-finger touch gestures") that turns them
off. Two-finger panning works either way.

## Code signing

The installer is unsigned for now, so Windows SmartScreen shows "Windows
protected your PC" the first time; **More info › Run anyway** gets past it.
To sign, get a code-signing certificate (Azure Trusted Signing is the
cheapest option) and build with:

```sh
WINDOWS_CERTIFICATE_FILE=path/to/cert.pfx WINDOWS_CERTIFICATE_PASSWORD=... npm run make
```

## Not done yet

- An MSI for IT departments that deploy software to many PCs
  (`@electron-forge/maker-wix`).
- Double-clicking a `.chalkd` file to open it.
- Automatic updates (Squirrel supports them; they need an update server or
  `update-electron-app`).
