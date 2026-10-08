# Chalkd

A touch-first infinite whiteboard for teachers, for Linux. Free and open source (GPL-3.0-or-later).

See [PLAN.md](PLAN.md) for the design and build phases.

## Status

**Phase 0: input spike.** A bare canvas for checking touch input on real hardware:
- one finger draws
- two fingers pan and pinch-zoom
- a two-finger tap undoes; a three-finger tap redoes

Each finished touch is logged to the terminal as a `[spike] {…}` line.

## Running

```sh
npm install
npm start          # native Wayland
npm run start:x11  # fallback through XWayland
```

At a desk: the mouse draws, the scroll wheel pans, and Ctrl+scroll or a touchpad pinch zooms. Ctrl+Z / Ctrl+Shift+Z undo and redo.
