# Chalkd — Plan

A free, open-source (GPL-3.0) touch-first whiteboard for Linux, built for one teacher's classroom: a touch monitor, fingers only, on Omarchy/Hyprland.

## Decisions

| Area | Decision |
|---|---|
| Hardware | Touch monitor, fingers only (no stylus, no pressure) |
| Stack | Electron + TypeScript, HTML Canvas 2D |
| Class display | Same screen or OS-level mirroring; no separate presenter window |
| Library tree | Notebooks nest to any depth; each holds boards and sub-notebooks |
| Drawer order | Creation order, oldest on top; drag-and-drop to reorder or move into a notebook |
| Storage | Plain folders under `~/Documents/Chalkd`, one `.chalkd` file per board; no built-in sync |
| Naming | New boards are auto-named (`Oct 7 · 10:42`); rename later with a keyboard |
| Gestures | 1 finger = current tool · 2–3 fingers = pan · 4 fingers (two pairs) = pan + pinch zoom (tap-to-undo/redo was tried and dropped: it didn't register on the classroom touchscreen TV and wasn't wanted) |
| Ink | Uniform width with smoothing |
| Eraser | Partial (default) and whole-stroke modes |
| Look | White boards by default; per-board background color + pattern |
| Import | Images, PDF pages, clipboard paste |
| Export | PNG; PDF as one fit-to-content page or tiled Letter pages, chosen at export |
| License | GPL-3.0 |

## Screen layout

```
┌───────────────────────────────────────────────────────────────────────────┐
│ ☰ │ pens… [+] │ highlighters… [+] │ eraser │ select │ ↶ ↷ │ import export ·· ⚙ │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│                               board canvas                                │
│                                                                  [100%]   │
└───────────────────────────────────────────────────────────────────────────┘
```

- Touch targets are at least 48 px. Pen and highlighter strips scroll sideways when they overflow.
- Zoom pill (bottom-right) shows the zoom level; tap it for "100%" and "Fit content".
- The drawer slides over the board from the left; tapping outside it or picking a board closes it.

## Input model

- **One finger:** the current tool.
- **Two or three fingers:** pan only. The view follows the center of the fingers; spreading them does not zoom.
- **Four fingers:** pan and zoom at the same time. Two pairs of fingers (one per hand) moving apart zoom in, moving together zoom out. Zoom follows the fingers' average distance from their shared center and is anchored there. Lifting a finger drops back to pan only. Zoom range 10 %–800 %.
- **Second-finger cancel:** drawing starts the instant a finger lands, so there's no lag. If a second finger lands within ~150 ms (before the stroke has traveled far), that stroke is discarded and the gesture becomes pan/zoom.
- **Palm rejection:** ignore contacts with a large reported contact size (threshold in Settings). Only works if the monitor reports contact size; Phase 0 checks this.
- Fingers beyond the first four are ignored during a gesture.

## Tools

**Pens and highlighters.** These are global presets shared by all boards, with no limit on how many.
- Tap to select. Long-press opens an editor popover: color swatches + custom color, thickness slider with live preview, Delete.
- `+` duplicates the current preset and opens its editor.
- Defaults: pens in black, blue, red, green (3 px); highlighters in yellow, green, pink (20 px, ~40 % opacity).
- Thickness is measured in board units, so ink scales with zoom like real ink.
- Each highlighter stroke is drawn as one translucent path, so overlaps within a stroke don't darken. Highlighters always render beneath pen ink.

**Eraser**
- Partial (default): removes only what the finger passes over, splitting strokes where needed.
- Whole-stroke: touching any part of a stroke removes all of it.
- Long-press: switch mode, change size, Clear Board (with confirmation; undoable).
- Loop erase: drawing a closed loop around ink outlines it in red; a tap inside the loop then erases every stroke it encloses (one undo step). Ink the loop crosses is cut where it crosses, so only the inside goes. Touching outside, dragging, switching tools, or waiting 6 seconds dismisses the loop.
- Erases ink and highlighter only. Images are removed with Select.

**Select**
- Lasso around strokes and images, or tap an image.
- Drag to move; corner handles scale proportionally; a Delete button sits on the selection.

**Undo/redo.** Each board has its own history, kept in memory for the session. Covers drawing, erasing, move/scale, delete, clear, and import.

## Board engine (renderer)

- **World and camera.** Items live in unbounded world coordinates (1 unit = 1 CSS px at 100 % zoom). The camera is `{x, y, zoom}`.
- **Items:**
  - `Stroke { id, kind: pen | highlighter, color, width, opacity, origin, points }`
  - `Image { id, assetHash, x, y, w, h }`
  - Bounding boxes live in an `rbush` R-tree, used for culling, erasing, and lasso hit-tests.
- **Stroke shape.** Points are smoothed once as they're drawn (exponential smoothing; strength set in Settings), then stored. Drawing is a round-capped line through the stored points, cached as a `Path2D`. Because smoothing is already applied to the stored points, a stroke cut in two by the eraser keeps its exact shape. (`perfect-freehand` was tried first and dropped: on every redraw it trims the start of each stroke, which made erased gaps grow.)
- **Layers:** stacked canvases, aware of `devicePixelRatio`:
  1. Background pattern (blank / grid / lines / dots). Drawn in world space so it lines up with writing; fades out when zoomed far out.
  2. Finished items, in the order images → highlighters → pen ink. Only items in view are drawn, using an R-tree query.
  3. Live layer: the stroke being drawn right now.
- **During pan/zoom:** transform a bitmap snapshot of layer 2 so it stays at 60 fps, then redraw it sharp when the fingers lift.
- **Partial erase:** sample the eraser path, look up nearby strokes in the R-tree, cut out the points inside the eraser radius, and keep the remaining pieces as new strokes.

## Storage

```
~/Documents/Chalkd/                  ← root (changeable in Settings)
├── .order.json                      ← display order of this level's children
├── Math 7/                          ← notebook = folder
│   ├── .order.json
│   ├── Unit 3 – Fractions/
│   │   ├── .order.json
│   │   └── Lesson 1.chalkd          ← board = one file
│   └── Warm-ups.chalkd
└── Science/
```

- **`.order.json`** lists children in display order. New items are added at the end. Items found on disk but not listed (for example, copied in by hand) are added at the end by modification time. Listed items that no longer exist are dropped.
- **A `.chalkd` file is a SQLite database**, using the `node:sqlite` module built into Electron's Node (no native module to rebuild). It uses a rollback journal, not WAL, so there are no sidecar files to confuse folder-sync tools. `PRAGMA application_id` marks the file as a Chalkd board, and `PRAGMA user_version` holds the format version. Tables:
  - `meta`: format version, background, last camera position
  - `items`: id, kind, z, bounding box, style JSON, points packed as Float32 relative to the stroke origin
  - `assets`: image and PDF-page bytes, stored once per content hash
- **Autosave:** changes are written in small transactions batched about every 500 ms. There's no Save button; a crash loses at most the last half-second.
- **Delete:** moves to the freedesktop trash (`shell.trashItem`), after confirmation.
- **Settings and pen presets:** `~/.config/chalkd/settings.json`. The last open board is stored there too.
- **On launch:** reopens the last board. The very first launch creates `My Notebook/` with one board in it.

## Drawer

- Shows the root folder as a tree. Notebooks expand and collapse; the current board is highlighted.
- Top buttons **+ Board** and **+ Notebook** create the item at the end of the notebook holding the current board, auto-named, and open it right away.
- Long-press then release opens a menu: Rename, Move to…, Export (boards only), Delete.
- Long-press then move starts a drag. Drop between rows to reorder; drop onto a notebook to move the item inside it (the notebook expands while you hover).
- The drawer re-scans the disk each time it opens, so changes made outside the app show up.

## Import

The Import button opens a popover:
- **Image or PDF from file…**
  - Images land centered, scaled to fit about 60 % of the view.
  - PDFs: each page is rendered with `pdf.js` at 2× and placed top to bottom with a gap, starting at the center of the view.
- **Paste** (also Ctrl+V): drops the image currently on the clipboard.

Imported bytes are copied into the board file, so deleting the original later is safe. Each picture is stored once per board (keyed by its SHA-256), even if it's used several times. Pictures nothing uses any more are cleaned out when the board is opened. Photos longer than 3000 px are scaled down; SVGs are converted to ordinary pictures. pdf.js loads only when a PDF arrives, and its font and decoder files are copied into `public/pdfjs/` at install time.

### Print to Chalkd

A "Chalkd" printer (CUPS) lets any app print straight onto a board. Each printout becomes a **new board, named after the document, in the notebook of the open board**, and Chalkd switches to it; the pages are placed like an imported PDF. Jobs printed while Chalkd is closed open the next time it starts.

- `scripts/printer/chalkd-backend` is the CUPS backend. It's installed root-owned with mode 0700, so CUPS runs it as root, and it writes each job into the printing user's `~/.local/share/chalkd/printed/` *as that user* (`<time>-<job>.pdf` plus a `.title` file, renamed into place last, mode 0600).
- `scripts/printer/chalkd.ppd` has no driver: CUPS converts what's printed to PDF and hands it straight over.
- The app watches that folder, takes one job at a time, and deletes it once its board exists. The main process remembers which board each job became, so a window reload partway through can't make a second board.
- Setup needs admin rights once: `npm run printer:install` (and `printer:uninstall`). Packaging will do this at install time.

## Export

The Export button (also in the drawer menu) opens a dialog:
- **PNG:** whole board or current view, at 2×.
- **PDF:** one page fitted to the content, or tiled across Letter or A4 pages at real size (1 board unit = 1/96 inch). Paper choice is in the export dialog itself, not Settings. Portrait or landscape is picked to use fewer pages.
- **Board background:** optional (color and pattern), so dark boards don't burn printer ink.
- The dialog remembers your last choices and the folder you last exported to.

PDFs are made by rendering the board to SVG in a hidden window and using Electron's `printToPDF`, so ink stays sharp when printed.

## Settings (⚙)

- **This board:** background color and pattern (blank / grid / lines / dots, with spacing).
- **App:**
  - Chalkd folder location
  - Default background for new boards
  - UI theme (light / dark / system)
  - Toolbar size (50–150%)
  - Smoothing strength
  - Palm-rejection threshold

## Project layout

Built with Electron Forge using its Vite + TypeScript template. The canvas engine is plain TypeScript with no framework; the toolbar, drawer, popovers, and dialogs use Svelte.

```
src/
  main/        window, IPC, file system, .chalkd (SQLite), trash, export
  preload/     typed bridge between main and renderer
  renderer/
    engine/    camera, input router, renderer, items, spatial index, history, tools/
    ui/        Toolbar, Drawer, PresetEditor, EraserMenu, Settings, ExportDialog
```

## Build phases

Each phase ends with something to try on the touch monitor.

0. **Input spike.** A full-window canvas that logs pointer type, contact size, and timing, with 1-finger drawing, 2-finger pan/zoom, and 2-finger tap. Run under Hyprland.
   *Done when* all four are confirmed:
   - touches arrive as `touch` pointers under native Wayland
   - pinch is smooth
   - Hyprland doesn't take over the gestures
   - we know whether the monitor reports contact size
1. **Canvas core.** Camera, smoothed strokes, R-tree culling, layered rendering, second-finger cancel, undo/redo, zoom pill. Everything stays in memory.
2. **Persistence.** The `.chalkd` format, autosave, creating the root folder on first run, reopening the last board.
3. **Toolbar and tools.** Pen and highlighter presets with their editor, eraser (both modes, size, clear), settings panel, backgrounds. → **Usable in class on a single board.**
4. **Drawer.** The tree, `.order.json`, create / rename / delete, long-press menu, drag to reorder or move, Move to….
5. **Select and import.** Lasso select / move / scale / delete; images, PDFs, paste.
6. **Export and packaging.** PNG and PDF export; PKGBUILD, `.desktop` file, and icon for Omarchy; README; LICENSE.

## Later

- Shapes with hold-to-snap
- Laser pointer
- Text boxes
- Screen snip import
- Export a whole notebook as one PDF
- Presenter window for an extended display
- Z-order controls
- Copy/duplicate selections
- Undo history that survives restarts

## Risks to watch

- **Touch under Electron on Wayland/Hyprland.** This is the whole point of Phase 0. Fallback: run under XWayland.
- **Palm rejection** needs the monitor to report contact size, and many cheap touch panels don't.
- **File picker:** it comes from the desktop portal and may not be touch-friendly. An in-app picker can come later.
- **Big PDFs** (dozens of pages at 2×) increase memory use and may need pages decoded on demand.
