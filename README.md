# Chalkd

A touch-first infinite whiteboard for teachers, for Linux. Free and open source (GPL-3.0-or-later).

See [PLAN.md](PLAN.md) for the design and build phases.

## Status

**Phase 3: toolbar and tools. Usable in class on a single board.**

- **Pens and highlighters:** as many as you like. Tap one to use it. Tap it again (or long-press) to change its color or thickness, or to delete it. **+** adds a copy.
- **Highlighter:** sits underneath pen ink, so it never dulls your writing.
- **Eraser:** rubs out just what you touch, or whole strokes. Long-press it for size and Clear Board, which can be undone.
- **Undo/redo:** toolbar buttons, a two-finger tap (undo), or a three-finger tap (redo).
- **Settings (⚙):**
  - board background color and pattern, and making that the default for new boards
  - ink smoothing
  - tap gestures and palm rejection
  - light/dark theme
  - the Chalkd folder location
- **Saving:** boards autosave to `~/Documents/Chalkd` and the last board reopens on launch. Switching boards arrives with the drawer in Phase 4.

## Running

```sh
npm install
npm start          # the app (native Wayland)
npm run start:x11  # fallback through XWayland
npm run spike      # Phase 0 input spike: logs every touch to the terminal
npm test           # unit tests
npm run check      # type-check TypeScript and Svelte
npm run bench      # rendering benchmark, prints timings and quits
```

At a desk: the mouse draws, the middle button or scroll wheel pans, and Ctrl+scroll or a touchpad pinch zooms.

| Shortcut | Action |
|---|---|
| Ctrl+Z | Undo |
| Ctrl+Shift+Z or Ctrl+Y | Redo |
| Ctrl+0 | Zoom to 100% |
| Ctrl+1 | Fit content |
| Ctrl+Shift+D | Show render stats |

`CHALKD_SELFTEST=<dir> npm start` draws with a simulated mouse, saves screenshots to `<dir>`, and quits. Self-tests and benchmarks run in a throwaway library and never touch `~/Documents/Chalkd`. Set `CHALKD_SANDBOX=<dir>` to point any run at a scratch library and settings folder.
