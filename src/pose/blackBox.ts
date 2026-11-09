import { config } from '../config';
import type { PoseRecording, RecordedFrame } from '../tutorial/recording';

const N = 33;
/** floats per frame: x, y, visibility per landmark */
const STRIDE = N * 3;
/** the most frames per second the buffer is sized for (a 60 Hz camera) */
const MAX_FPS = 60;
/** a longer gap between two frames is a pause (the camera was off), not part of one stream: what came before is dropped */
export const BLACK_BOX_GAP_MS = 5000;

/** The game side of a frame, as `main.ts` sees it when the frame arrives. */
export interface BlackBoxContext {
  /** the app state after the frame (`playing`, `outOfFrame`, ...) */
  state: string;
  personDetected: boolean;
  centred: boolean;
  playerPresent: boolean;
  inFrame: boolean;
  /** the controls the pose gives the bird now */
  lift: number;
  tilt: number;
  hover: number;
  flapping: boolean;
  /** ms the pose model took on the frame */
  inferenceMs: number;
}

/** One frame of a dump: a replayable `RecordedFrame` (raw landmarks, null: nobody) plus the game side. */
export interface BlackBoxFrame extends RecordedFrame {
  /** app state */
  st: string;
  /** flags: person detected, centred, player present, in frame */
  pd: boolean;
  ce: boolean;
  pp: boolean;
  in: boolean;
  /** controls the bird got from the pose */
  ctl: { lift: number; tilt: number; hover: number; flapping: boolean };
  /** inference ms */
  ms: number;
}

/**
 * A dump of the black box: the replay suite's `PoseRecording` (`tests/replay/`, load it with `toRecording`) whose
 * frames carry the game state too, and where they come from. The landmarks are MediaPipe's own, before smoothing
 * and arm stand-ins, so the replay runs the whole pipeline on them.
 */
export interface BlackBoxDump extends PoseRecording {
  level: 'black-box';
  frames: BlackBoxFrame[];
  blackBox: {
    recordedAt: string;
    /** length of the stream, s */
    seconds: number;
    model: string;
    delegate: string;
    /** the options that differ from the defaults */
    config: Record<string, unknown>;
  };
}

/**
 * Ring buffer of the last `config.telemetry.blackBoxSeconds` of the raw pose stream, with the game state per frame,
 * so that after a failure in play (press B) the stream can be saved and replayed in the tests.
 *
 * Memory is bounded and allocated once: capacity = seconds * 60 fps frames, each 33 landmarks * 3 floats * 4 bytes
 * = 396 B of landmarks plus ~40 B of the rest. For 60 s that is 3600 frames, about 1.5 MB (a 30 fps camera fills
 * half of it). `add` allocates nothing.
 */
export class BlackBox {
  private readonly cap: number;
  private readonly lm: Float32Array;
  private readonly t: Float64Array;
  private readonly ms: Float32Array;
  private readonly ctl: Float32Array; // lift, tilt, hover per frame
  /** bit 0: a person (landmarks stored), 1: personDetected, 2: centred, 3: playerPresent, 4: inFrame, 5: flapping */
  private readonly flags: Uint8Array;
  private readonly state: Uint8Array;
  private readonly stateNames: string[] = [];
  private head = 0;
  private n = 0;
  aspect = 16 / 9;

  constructor(seconds: number = config.telemetry.blackBoxSeconds) {
    this.cap = Math.max(2, Math.ceil(seconds * MAX_FPS));
    this.lm = new Float32Array(this.cap * STRIDE);
    this.t = new Float64Array(this.cap);
    this.ms = new Float32Array(this.cap);
    this.ctl = new Float32Array(this.cap * 3);
    this.flags = new Uint8Array(this.cap);
    this.state = new Uint8Array(this.cap);
  }

  get length() {
    return this.n;
  }

  /** Seconds of stream in the buffer (at most `blackBoxSeconds`). */
  get seconds() {
    return this.n > 1 ? (this.t[this.at(this.n - 1)] - this.t[this.at(0)]) / 1000 : 0;
  }

  /** `raw`: MediaPipe's 33 landmarks for the frame, null: nobody. `t`: ms, the frame's time (increasing). */
  add(t: number, raw: ArrayLike<{ x: number; y: number; visibility?: number }> | null, ctx: BlackBoxContext) {
    if (this.n > 0 && t - this.t[this.at(this.n - 1)] > BLACK_BOX_GAP_MS) this.clear();
    const i = (this.head + this.n) % this.cap;
    if (this.n < this.cap) this.n++;
    else this.head = (this.head + 1) % this.cap;
    this.t[i] = t;
    this.ms[i] = ctx.inferenceMs;
    this.ctl[i * 3] = ctx.lift;
    this.ctl[i * 3 + 1] = ctx.tilt;
    this.ctl[i * 3 + 2] = ctx.hover;
    let f = (ctx.personDetected ? 2 : 0) | (ctx.centred ? 4 : 0) | (ctx.playerPresent ? 8 : 0) | (ctx.inFrame ? 16 : 0) | (ctx.flapping ? 32 : 0);
    if (raw && raw.length >= N) {
      f |= 1;
      const o = i * STRIDE;
      for (let k = 0; k < N; k++) {
        const p = raw[k];
        this.lm[o + k * 3] = p.x;
        this.lm[o + k * 3 + 1] = p.y;
        this.lm[o + k * 3 + 2] = p.visibility ?? 0;
      }
    }
    this.flags[i] = f;
    this.state[i] = this.stateIndex(ctx.state);
  }

  clear() {
    this.head = 0;
    this.n = 0;
  }

  /** The buffer as a replayable dump (allocates: call on the hotkey, not per frame). Null when it is empty. */
  dump(info: { model: string; delegate: string; config: Record<string, unknown>; flapping: boolean }, now = new Date()): BlackBoxDump | null {
    if (this.n === 0) return null;
    const t0 = this.t[this.at(0)];
    const frames: BlackBoxFrame[] = [];
    let last = -Infinity;
    for (let k = 0; k < this.n; k++) {
      const i = this.at(k);
      const f = this.flags[i];
      let lm: [number, number, number][] | null = null;
      if (f & 1) {
        lm = [];
        for (let p = 0; p < N; p++) {
          const o = i * STRIDE + p * 3;
          lm.push([round(this.lm[o], 4), round(this.lm[o + 1], 4), round(this.lm[o + 2], 2)]);
        }
      }
      // times as whole ms from the first frame, kept increasing for the replay
      const t = Math.max(Math.round(this.t[i] - t0), last + 1);
      last = t;
      frames.push({
        t,
        lm,
        st: this.stateNames[this.state[i]],
        pd: !!(f & 2),
        ce: !!(f & 4),
        pp: !!(f & 8),
        in: !!(f & 16),
        ctl: { lift: round(this.ctl[i * 3], 1), tilt: round(this.ctl[i * 3 + 1], 1), hover: round(this.ctl[i * 3 + 2], 2), flapping: !!(f & 32) },
        ms: round(this.ms[i], 1),
      });
    }
    return {
      version: 1,
      level: 'black-box',
      aspect: this.aspect,
      flapping: info.flapping,
      baseline: null,
      startMs: 0,
      endMs: last,
      frames,
      blackBox: {
        recordedAt: now.toISOString(),
        seconds: last / 1000,
        model: info.model,
        delegate: info.delegate,
        config: info.config,
      },
    };
  }

  private at(k: number) {
    return (this.head + k) % this.cap;
  }

  private stateIndex(s: string) {
    let i = this.stateNames.indexOf(s);
    if (i < 0) i = this.stateNames.push(s) - 1; // a handful of names, once each
    return i;
  }
}

/**
 * Reads a dump (a parsed JSON file) back as a `PoseRecording` for the replay suite; throws on anything else.
 * Frames of a plain recording (`Recorder`, the tutorial recorder) are fine too: only `t` and `lm` are needed.
 */
export function parseBlackBox(json: unknown): PoseRecording {
  const d = json as Partial<PoseRecording> | null;
  if (!d || d.version !== 1 || !Array.isArray(d.frames) || typeof d.aspect !== 'number') throw new Error('not a pose recording');
  let prev = -Infinity;
  for (const f of d.frames) {
    if (typeof f.t !== 'number' || f.t <= prev) throw new Error('frame times must increase');
    if (f.lm !== null && (!Array.isArray(f.lm) || f.lm.length !== N)) throw new Error('a frame needs 33 landmarks or null');
    prev = f.t;
  }
  const end = d.frames.length ? d.frames[d.frames.length - 1].t : 0;
  return {
    version: 1,
    level: d.level ?? 'black-box',
    aspect: d.aspect,
    flapping: d.flapping ?? config.pointing.flapping,
    baseline: d.baseline ?? null,
    startMs: d.startMs ?? 0,
    endMs: d.endMs ?? end,
    frames: d.frames.map((f) => ({ t: f.t, lm: f.lm })),
  };
}

const round = (x: number, d: number) => {
  const m = 10 ** d;
  return Math.round(x * m) / m;
};
