import { L } from '../pose/landmarks';
import type { RecordedFrame } from '../tutorial/recording';

/** the landmarks whose movement the timeline plots (and the recorder watches for the player standing still) */
export const MOTION_POINTS = [L.leftShoulder, L.rightShoulder, L.leftElbow, L.rightElbow, L.leftWrist, L.rightWrist, L.leftHip, L.rightHip];

/** the shortest clip, ms */
const MIN_CLIP_MS = 500;
/** px either side of a handle that grab it */
const GRAB_PX = 10;
const PAD = 12;

type Drag = 'start' | 'end' | 'playhead';

/**
 * A movie-editor style strip under a recording: how much the player moves over time, the clip's in and out
 * handles (drag them, or nudge the last one touched by a frame with `nudge`) and a playhead (click or drag
 * anywhere else to scrub).
 */
export class ClipTimeline {
  /** the in or out handle moved */
  onTrim: (startMs: number, endMs: number) => void = () => {};
  /** the user moved the playhead (or a handle) to `t`: show that moment */
  onScrub: (t: number) => void = () => {};
  /** where the playhead is (ms), drawn when not null */
  playhead: number | null = null;
  startMs = 0;
  endMs = 0;

  private ctx: CanvasRenderingContext2D;
  private frames: RecordedFrame[] = [];
  /** per frame, how fast the player moves, 0..1 */
  private motion: number[] = [];
  private drag: Drag | null = null;
  private lastHandle: 'start' | 'end' = 'end';

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      const x = e.offsetX;
      if (Math.abs(x - this.x(this.startMs)) <= GRAB_PX) this.drag = 'start';
      else if (Math.abs(x - this.x(this.endMs)) <= GRAB_PX) this.drag = 'end';
      else this.drag = 'playhead';
      this.dragTo(x);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.drag) this.dragTo(e.offsetX);
      else {
        const near = [this.startMs, this.endMs].some((t) => Math.abs(e.offsetX - this.x(t)) <= GRAB_PX);
        canvas.style.cursor = near ? 'ew-resize' : 'pointer';
      }
    });
    const release = () => (this.drag = null);
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
  }

  get duration() {
    return this.frames.at(-1)?.t ?? 0;
  }

  set(frames: RecordedFrame[], aspect: number, startMs: number, endMs: number) {
    this.frames = frames;
    this.startMs = startMs;
    this.endMs = endMs;
    this.playhead = null;
    const speeds = frames.map((f, i) => {
      const prev = frames[i - 1];
      if (!f.lm || !prev?.lm || f.t === prev.t) return 0;
      let d = 0;
      for (const j of MOTION_POINTS) d += Math.hypot((f.lm[j][0] - prev.lm[j][0]) * aspect, f.lm[j][1] - prev.lm[j][1]);
      return d / (f.t - prev.t);
    });
    const max = Math.max(1e-9, ...speeds);
    this.motion = speeds.map((s) => s / max);
  }

  /** Move the handle touched last by `frames` frames (negative: earlier). */
  nudge(frames: number) {
    const t = this.lastHandle === 'start' ? this.startMs : this.endMs;
    let i = this.frames.findIndex((f) => f.t >= t);
    if (i < 0) i = this.frames.length - 1;
    i = Math.max(0, Math.min(this.frames.length - 1, i + frames));
    this.moveHandle(this.lastHandle, this.frames[i].t);
  }

  draw() {
    const c = this.canvas, ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!this.frames.length) return;

    // the movement plot
    ctx.beginPath();
    ctx.moveTo(this.x(0), h);
    this.frames.forEach((f, i) => ctx.lineTo(this.x(f.t), h - 4 - this.motion[i] * (h - 10)));
    ctx.lineTo(this.x(this.duration), h);
    ctx.fillStyle = 'rgba(43,43,43,0.35)';
    ctx.fill();
    // frames without a person
    ctx.fillStyle = 'rgba(192,57,43,0.35)';
    for (const f of this.frames) if (!f.lm) ctx.fillRect(this.x(f.t) - 1, 0, 2, h);

    // outside the clip, greyed out
    const xs = this.x(this.startMs), xe = this.x(this.endMs);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillRect(0, 0, xs, h);
    ctx.fillRect(xe, 0, w - xe, h);
    for (const [x, color] of [[xs, '#1e7a32'], [xe, '#c0392b']] as const) {
      ctx.fillStyle = color;
      ctx.fillRect(x - 2, 0, 4, h);
      ctx.beginPath();
      ctx.moveTo(x - 7, 0);
      ctx.lineTo(x + 7, 0);
      ctx.lineTo(x, 9);
      ctx.fill();
    }
    if (this.playhead !== null) {
      const x = this.x(this.playhead);
      ctx.fillStyle = '#2b2b2b';
      ctx.fillRect(x - 1, 0, 2, h);
    }
  }

  private x(t: number) {
    const w = this.canvas.clientWidth;
    return PAD + (t / Math.max(1, this.duration)) * (w - 2 * PAD);
  }

  private tAt(x: number) {
    const w = this.canvas.clientWidth;
    return Math.max(0, Math.min(this.duration, ((x - PAD) / (w - 2 * PAD)) * this.duration));
  }

  private dragTo(x: number) {
    const t = this.tAt(x);
    if (this.drag === 'playhead') {
      this.playhead = t;
      this.onScrub(t);
    } else if (this.drag) this.moveHandle(this.drag, t);
  }

  private moveHandle(handle: 'start' | 'end', t: number) {
    this.lastHandle = handle;
    if (handle === 'start') this.startMs = Math.max(0, Math.min(t, this.endMs - MIN_CLIP_MS));
    else this.endMs = Math.min(this.duration, Math.max(t, this.startMs + MIN_CLIP_MS));
    this.playhead = handle === 'start' ? this.startMs : this.endMs;
    this.onTrim(this.startMs, this.endMs);
    this.onScrub(this.playhead);
  }
}
