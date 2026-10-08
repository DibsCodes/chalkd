# Chalkd

A touch-first infinite whiteboard for teachers, for Linux. Free and open source (GPL-3.0-or-later).

See [PLAN.md](PLAN.md) for the design and build phases.

## Status

**Phase 2: saving.** Boards autosave to `~/Documents/Chalkd` (one `.chalkd` file per board), and the last board reopens on launch. There's no way to switch boards yet; that's Phase 4.

On the board:
- one finger draws smooth, uniform-width ink
- two fingers pan and pinch-zoom (10%–800%)
- a two-finger tap undoes; a three-finger tap redoes
- the zoom pill in the bottom-right offers 100% and Fit content

## Running

```sh
npm install
npm start          # the app (native Wayland)
npm run start:x11  # fallback through XWayland
npm run spike      # Phase 0 input spike: logs every touch to the terminal
npm test           # unit tests
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
