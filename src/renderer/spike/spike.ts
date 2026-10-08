/**
 * Phase 0 input spike. Answers, on the real touch monitor:
 *  - do fingers arrive as `touch` pointers (not emulated mouse)?
 *  - is two-finger pan/pinch smooth?
 *  - does the compositor steal any gestures?
 *  - does the panel report contact size (needed for palm rejection)?
 * Every finished touch sequence is logged to the terminal via the main process.
 */
import './spike.css';
import { Camera, clampZoom, type Point } from '../engine/camera';

// Gesture tuning (see PLAN.md › Input model).
const CANCEL_WINDOW_MS = 150;
const CANCEL_TRAVEL_PX = 24;
const TAP_MAX_MS = 250;
const TAP_SLOP_PX = 10;

const PEN = { color: '#1d2433', width: 3 };

interface Stroke {
  points: Point[];
  color: string;
  width: number;
}

interface TouchState {
  startX: number;
  startY: number;
  x: number;
  y: number;
}

type Mode = 'draw' | 'gesture' | 'ignore';

interface Sequence {
  startAt: number;
  mode: Mode;
  maxFingers: number;
  maxTravel: number;
  drawPointerId: number | null;
  cancelledStroke: boolean;
  extraFingersIgnored: number;
  camAtStart: Camera;
  moveEvents: number;
  coalescedSamples: number;
  contactW: [number, number];
  contactH: [number, number];
  pointerTypes: Set<string>;
}

const canvas = document.getElementById('board') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { desynchronized: true })!;
const hud = document.getElementById('hud') as HTMLPreElement;

const camera = new Camera();
const strokes: Stroke[] = [];
const redoStack: Stroke[] = [];
let live: Stroke | null = null;

const touches = new Map<number, TouchState>();
let seq: Sequence | null = null;
let gestureBase: {
  centroid: Point;
  dist: number | null;
  cam: Camera;
} | null = null;

let mouseDrawing: number | null = null;
let envText = 'loading…';
let lastSeqText = '(touch the screen)';
let lastPointerType = '-';
let maxContactSeen = 0;
let dirty = true;

// ---------- sizing & rendering ----------

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  dirty = true;
}

function render(): void {
  const dpr = window.devicePixelRatio || 1;
  const z = camera.zoom * dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(z, 0, 0, z, -camera.x * z, -camera.y * z);

  drawGrid();
  for (const s of strokes) drawStroke(s);
  if (live) drawStroke(live);

  hud.textContent = hudText();
}

function drawGrid(): void {
  let spacing = 40;
  while (spacing * camera.zoom < 14) spacing *= 5;
  const tl = camera.toWorld(0, 0);
  const br = camera.toWorld(window.innerWidth, window.innerHeight);
  ctx.beginPath();
  for (let x = Math.floor(tl.x / spacing) * spacing; x <= br.x; x += spacing) {
    ctx.moveTo(x, tl.y);
    ctx.lineTo(x, br.y);
  }
  for (let y = Math.floor(tl.y / spacing) * spacing; y <= br.y; y += spacing) {
    ctx.moveTo(tl.x, y);
    ctx.lineTo(br.x, y);
  }
  ctx.strokeStyle = '#e4e8ef';
  ctx.lineWidth = 1 / camera.zoom;
  ctx.stroke();
}

function drawStroke(s: Stroke): void {
  const p = s.points;
  if (p.length === 0) return;
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = s.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (p.length === 1) {
    ctx.beginPath();
    ctx.arc(p[0].x, p[0].y, s.width / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(p[0].x, p[0].y);
  for (let i = 1; i < p.length - 1; i++) {
    const mx = (p[i].x + p[i + 1].x) / 2;
    const my = (p[i].y + p[i + 1].y) / 2;
    ctx.quadraticCurveTo(p[i].x, p[i].y, mx, my);
  }
  const last = p[p.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
}

function hudText(): string {
  const active = [...touches.entries()]
    .map(([id, t]) => `  #${id} at ${t.x | 0},${t.y | 0}`)
    .join('\n');
  return [
    'CHALKD · INPUT SPIKE',
    envText,
    '',
    `zoom ${(camera.zoom * 100).toFixed(0)}%   strokes ${strokes.length}   redo ${redoStack.length}`,
    `last pointerType: ${lastPointerType}   max contact seen: ${maxContactSeen.toFixed(1)}px`,
    `mode: ${seq ? seq.mode : 'idle'}   fingers down: ${touches.size}`,
    active,
    '',
    'last sequence:',
    lastSeqText,
  ].join('\n');
}

function loop(): void {
  if (dirty) {
    dirty = false;
    render();
  }
  requestAnimationFrame(loop);
}

// ---------- stroke helpers ----------

function beginStroke(e: PointerEvent): void {
  live = { points: [], color: PEN.color, width: PEN.width };
  appendPoints(e);
}

function appendPoints(e: PointerEvent): void {
  if (!live) return;
  const samples = e.getCoalescedEvents?.() ?? [];
  for (const s of samples.length ? samples : [e]) {
    live.points.push(camera.toWorld(s.clientX, s.clientY));
  }
  dirty = true;
}

function commitStroke(): void {
  if (live && live.points.length) {
    strokes.push(live);
    redoStack.length = 0;
  }
  live = null;
  dirty = true;
}

function undo(): void {
  const s = strokes.pop();
  if (s) redoStack.push(s);
  dirty = true;
}

function redo(): void {
  const s = redoStack.pop();
  if (s) strokes.push(s);
  dirty = true;
}

// ---------- touch gesture state machine ----------

function resetGestureBase(): void {
  const pts = [...touches.values()].slice(0, 2);
  if (pts.length === 0) {
    gestureBase = null;
    return;
  }
  const centroid =
    pts.length === 2
      ? { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }
      : { x: pts[0].x, y: pts[0].y };
  const dist =
    pts.length === 2
      ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
      : null;
  gestureBase = { centroid, dist, cam: camera.clone() };
}

function applyGesture(): void {
  if (!gestureBase) return;
  const pts = [...touches.values()].slice(0, 2);
  if (pts.length === 0) return;
  const base = gestureBase;
  let centroid: Point;
  let zoom = base.cam.zoom;
  if (pts.length === 2 && base.dist) {
    centroid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    zoom = clampZoom(base.cam.zoom * (dist / base.dist));
  } else {
    centroid = { x: pts[0].x, y: pts[0].y };
  }
  // Keep the world point that was under the starting centroid under the
  // current centroid: that single rule gives pan and pinch together.
  const anchor = base.cam.toWorld(base.centroid.x, base.centroid.y);
  camera.zoom = zoom;
  camera.x = anchor.x - centroid.x / zoom;
  camera.y = anchor.y - centroid.y / zoom;
  dirty = true;
}

function trackContact(e: PointerEvent): void {
  if (!seq) return;
  seq.contactW = [
    Math.min(seq.contactW[0], e.width),
    Math.max(seq.contactW[1], e.width),
  ];
  seq.contactH = [
    Math.min(seq.contactH[0], e.height),
    Math.max(seq.contactH[1], e.height),
  ];
  maxContactSeen = Math.max(maxContactSeen, e.width, e.height);
}

function onTouchDown(e: PointerEvent): void {
  const now = performance.now();
  touches.set(e.pointerId, {
    startX: e.clientX,
    startY: e.clientY,
    x: e.clientX,
    y: e.clientY,
  });

  if (!seq) {
    seq = {
      startAt: now,
      mode: 'draw',
      maxFingers: 1,
      maxTravel: 0,
      drawPointerId: e.pointerId,
      cancelledStroke: false,
      extraFingersIgnored: 0,
      camAtStart: camera.clone(),
      moveEvents: 0,
      coalescedSamples: 0,
      contactW: [Infinity, -Infinity],
      contactH: [Infinity, -Infinity],
      pointerTypes: new Set(),
    };
    beginStroke(e);
  } else {
    seq.maxFingers = Math.max(seq.maxFingers, touches.size);
    if (seq.mode === 'draw') {
      if (
        now - seq.startAt < CANCEL_WINDOW_MS &&
        seq.maxTravel < CANCEL_TRAVEL_PX
      ) {
        // A second finger arrived quickly: it was a gesture all along.
        live = null;
        seq.cancelledStroke = true;
        seq.mode = 'gesture';
        resetGestureBase();
      } else {
        seq.extraFingersIgnored++;
      }
    } else if (seq.mode === 'gesture') {
      resetGestureBase();
    }
  }
  seq.pointerTypes.add(e.pointerType);
  trackContact(e);
  dirty = true;
}

function onTouchMove(e: PointerEvent): void {
  const t = touches.get(e.pointerId);
  if (!t || !seq) return;
  t.x = e.clientX;
  t.y = e.clientY;
  seq.maxTravel = Math.max(
    seq.maxTravel,
    Math.hypot(t.x - t.startX, t.y - t.startY),
  );
  seq.moveEvents++;
  seq.coalescedSamples += e.getCoalescedEvents?.().length || 1;
  trackContact(e);

  if (seq.mode === 'draw' && e.pointerId === seq.drawPointerId) appendPoints(e);
  else if (seq.mode === 'gesture') applyGesture();
}

function onTouchUp(e: PointerEvent, cancelled: boolean): void {
  if (!touches.has(e.pointerId) || !seq) return;
  touches.delete(e.pointerId);

  if (seq.mode === 'draw' && e.pointerId === seq.drawPointerId) {
    if (cancelled) live = null;
    else commitStroke();
    seq.mode = 'ignore';
  } else if (seq.mode === 'gesture') {
    resetGestureBase();
  }

  if (touches.size === 0) endSequence(cancelled);
  dirty = true;
}

function endSequence(cancelled: boolean): void {
  const s = seq!;
  seq = null;
  gestureBase = null;
  const duration = performance.now() - s.startAt;

  let result: string;
  if (cancelled) {
    result = 'pointercancel (something else took the touch!)';
  } else if (
    s.maxFingers >= 2 &&
    s.cancelledStroke &&
    duration <= TAP_MAX_MS &&
    s.maxTravel < TAP_SLOP_PX
  ) {
    camera.copyFrom(s.camAtStart);
    if (s.maxFingers === 2) {
      undo();
      result = '2-finger tap → undo';
    } else {
      redo();
      result = `${s.maxFingers}-finger tap → redo`;
    }
  } else if (s.cancelledStroke || s.mode === 'gesture') {
    result = `pan/zoom with ${s.maxFingers} fingers`;
  } else {
    result = 'stroke';
  }

  const seconds = Math.max(duration / 1000, 0.001);
  const fmt = (r: [number, number]) =>
    Number.isFinite(r[0]) ? `${r[0].toFixed(1)}–${r[1].toFixed(1)}` : 'n/a';
  const entry = {
    result,
    pointerTypes: [...s.pointerTypes],
    fingers: s.maxFingers,
    durationMs: Math.round(duration),
    travelPx: Math.round(s.maxTravel),
    moveHz: Math.round(s.moveEvents / seconds),
    sampleHz: Math.round(s.coalescedSamples / seconds),
    contactW: fmt(s.contactW),
    contactH: fmt(s.contactH),
    extraFingersIgnored: s.extraFingersIgnored,
    zoom: Number(camera.zoom.toFixed(3)),
  };
  window.chalkd.spike.log(entry);
  lastSeqText = Object.entries(entry)
    .map(([k, v]) => `  ${k}: ${Array.isArray(v) ? v.join(',') : v}`)
    .join('\n');
}

// ---------- event wiring ----------

canvas.addEventListener('pointerdown', (e) => {
  lastPointerType = e.pointerType;
  canvas.setPointerCapture(e.pointerId);
  if (e.pointerType === 'touch') {
    onTouchDown(e);
  } else if (e.button === 0 && mouseDrawing === null) {
    mouseDrawing = e.pointerId;
    beginStroke(e);
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch') onTouchMove(e);
  else if (e.pointerId === mouseDrawing) appendPoints(e);
});

for (const type of ['pointerup', 'pointercancel'] as const) {
  canvas.addEventListener(type, (e) => {
    const cancelled = type === 'pointercancel';
    if (e.pointerType === 'touch') {
      onTouchUp(e, cancelled);
    } else if (e.pointerId === mouseDrawing) {
      mouseDrawing = null;
      if (cancelled) live = null;
      else commitStroke();
    }
  });
}

// Mouse/trackpad fallbacks so the spike is usable at a desk too.
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    if (e.ctrlKey)
      camera.zoomAt(
        e.clientX,
        e.clientY,
        camera.zoom * Math.exp(-e.deltaY * 0.002),
      );
    else camera.panBy(-e.deltaX, -e.deltaY);
    dirty = true;
  },
  { passive: false },
);

window.addEventListener('keydown', (e) => {
  if (!e.ctrlKey) return;
  if (e.key.toLowerCase() === 'z' && e.shiftKey) redo();
  else if (e.key.toLowerCase() === 'z') undo();
  else if (e.key.toLowerCase() === 'y') redo();
});

// Long-press would otherwise open Chromium's context menu.
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('resize', resize);

window.chalkd.spike.env().then((env) => {
  const displays = env.displays
    .map(
      (d: { size: string; scale: number; touchSupport: string }) =>
        `${d.size}@${d.scale}x touch:${d.touchSupport}`,
    )
    .join(' | ');
  envText = [
    `electron ${env.electron} · chrome ${env.chrome}`,
    `session ${env.sessionType || '?'} · ozone ${env.ozonePlatform} · wayland ${env.waylandDisplay || 'no'}`,
    `displays: ${displays}`,
  ].join('\n');
  window.chalkd.spike.log({ env });
  dirty = true;
});

resize();
loop();
