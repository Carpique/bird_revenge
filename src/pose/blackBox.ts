import { config, WORLD } from '../config';
import type { BirdSample } from '../game/Bird';
import { STEP_MS } from '../game/physics';
import type { PointingIntent, PointingMode } from '../game/pointing';
import type { ShootBaseline } from '../gestures/ShootDetector';
import type { PoseRecording, RecordedFrame } from '../tutorial/recording';
import type { ArmNoise } from './armSmoothing';
import type { FrameSource } from './FrameClock';

const N = 33;
/** floats per frame: x, y, z, visibility per landmark (z: the arm stand-in compares the wrists' depths) */
const STRIDE = N * 4;
/** the most frames per second the buffer is sized for (a 60 Hz camera) */
const MAX_FPS = 60;
/** a longer gap between two frames is a pause (the camera was off), not part of one stream: what came before is dropped */
export const BLACK_BOX_GAP_MS = 5000;
/**
 * the dump's `blackBox.format`: 2 = frames carry the effect (`pi`, `bd`, `dr`, `lr`); absent (1) = a dump from
 * before, with the pose and the game state only
 */
export const BLACK_BOX_FORMAT = 2;

/** pointing modes as stored (index + 1; 0: no intent) */
const MODES: readonly PointingMode[] = ['rest', 'hover', 'drift', 'fly'];
/**
 * the intent's numbers stored per frame: `PointingIntent`'s key, the dump's key, decimals in the dump, and when the
 * dump leaves it out: `never`, when 0 (`zero`: the intent reads back without it, as 0 means none), or when the intent
 * has no such key (`absent`: stored as NaN, so a 0 is kept). One more number is one more entry here and its key in
 * `BlackBoxIntent`; storage, dump and `blackBoxEffect` follow the table. A dump from before a key simply lacks it.
 */
const INTENT_KEYS: readonly { key: 'dx' | 'dy' | 'sink' | 'vx' | 'vy'; dump: 'dx' | 'dy' | 's' | 'vx' | 'vy'; decimals: number; omit: 'never' | 'zero' | 'absent' }[] = [
  { key: 'dx', dump: 'dx', decimals: 3, omit: 'never' },
  { key: 'dy', dump: 'dy', decimals: 3, omit: 'never' },
  { key: 'sink', dump: 's', decimals: 2, omit: 'zero' },
  // continuous steering's velocity (`pointing.continuous`)
  { key: 'vx', dump: 'vx', decimals: 2, omit: 'absent' },
  { key: 'vy', dump: 'vy', decimals: 2, omit: 'absent' },
];
const INTENT_STRIDE = INTENT_KEYS.length;
/** bird floats per frame: x, y, vx, vy */
const BIRD_STRIDE = 4;
/** `fx` bits: the effect's presence per frame, and the bird's flags */
const FX_INTENT = 1, FX_BIRD = 2, FX_DROPPED = 4, FX_LONG = 8, FX_GROUND = 16, FX_PERCHED = 32, FX_DYING = 64;
const U16 = 65535;

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
  /**
   * the pointing intent the bird is given now (`PoseSession.controls(...).pointing`): null when there is none (not
   * playing, a stale pose, flapping mode); absent: not recorded
   */
  intent?: PointingIntent | null;
  /** the bird when the frame arrives (`Game.birdState`); absent: not recorded */
  bird?: BirdSample | null;
  /** camera frames dropped before this one (`PoseTiming.dropped`); null or absent: unknown (no frame metadata) */
  dropped?: number | null;
  /** long render frames since the previous pose frame (`TrackingStats.longRenderFrames`); absent: not counted */
  longRender?: number;
}

/**
 * The recorded intent in a dump: the mode and `PointingIntent`'s numbers, `s` the sink (absent when 0), `vx`/`vy`
 * the velocity asked for by continuous steering (absent without it).
 */
export interface BlackBoxIntent {
  m: PointingMode;
  dx: number;
  dy: number;
  s?: number;
  vx?: number;
  vy?: number;
}

/** The recorded bird in a dump: world px, px per physics step; the flags only when true. */
export interface BlackBoxBird {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** on the ground or on something (or perched) */
  gr?: true;
  /** perched on a branch */
  pe?: true;
  /** dying */
  die?: true;
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
  /** format 2 on (each absent when not recorded): the pointing intent the bird was given (null: none) */
  pi?: BlackBoxIntent | null;
  /** the bird when the frame arrived */
  bd?: BlackBoxBird;
  /** camera frames dropped before this one (absent: unknown) */
  dr?: number;
  /** long render frames since the previous pose frame */
  lr?: number;
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
    /** `BLACK_BOX_FORMAT` (absent in older dumps: no effect recorded) */
    format?: number;
    /** where the frames' time came from at the dump (`FrameClock`), null: unknown */
    source?: FrameSource | null;
    /** camera frames dropped over the dump (frames whose drops are known), and long render frames */
    dropped?: number;
    longRender?: number;
    /** the world the bird's numbers are in: px, and the physics step its velocity is per (ms) */
    world?: { width: number; height: number; groundY: number; stepMs: number };
  };
}

/**
 * Ring buffer of the last `config.telemetry.blackBoxSeconds` of the raw pose stream, with the game state per frame
 * and the calibrations (the shoot detector's baseline), so that after a failure in play (press B) the stream can be
 * saved and replayed in the tests. Frames older than the window are dropped by time, whatever the frame rate.
 *
 * Per frame also the effect: the pointing intent the bird was given, the bird's position and velocity, the camera
 * frames dropped before it and the long render frames since the previous one (`BlackBoxContext`, format 2), so a
 * dump says what the bird was told and did, not only what the camera saw.
 *
 * Memory is bounded and allocated once: capacity = seconds * 60 fps frames, each 33 landmarks * 4 floats * 4 bytes
 * = 528 B of landmarks plus 60 B of the rest (26 B time, inference, controls, flags, state; 34 B the effect). For
 * 60 s that is 3600 frames, about 2.1 MB (a 30 fps camera fills half of it). `add` allocates nothing.
 */
export class BlackBox {
  private readonly cap: number;
  /** the window, ms: older frames are dropped */
  private readonly windowMs: number;
  /** calibrations (ms, frames' time): the one in force at the oldest frame, and those after it */
  private calibrations: { t: number; baseline: ShootBaseline; armNoise: ArmNoise | null }[] = [];
  private readonly lm: Float32Array;
  private readonly t: Float64Array;
  private readonly ms: Float32Array;
  private readonly ctl: Float32Array; // lift, tilt, hover per frame
  /** bit 0: a person (landmarks stored), 1: personDetected, 2: centred, 3: playerPresent, 4: inFrame, 5: flapping */
  private readonly flags: Uint8Array;
  private readonly state: Uint8Array;
  private readonly stateNames: string[] = [];
  /** the effect: `FX_*` bits, intent mode (index in `MODES` + 1, 0: none) and numbers, bird, drops, long renders */
  private readonly fx: Uint8Array;
  private readonly mode: Uint8Array;
  private readonly intent: Float32Array;
  private readonly bird: Float32Array;
  private readonly dropped: Uint16Array;
  private readonly longRender: Uint16Array;
  private head = 0;
  private n = 0;
  aspect = 16 / 9;

  constructor(seconds: number = config.telemetry.blackBoxSeconds) {
    this.cap = Math.max(2, Math.ceil(seconds * MAX_FPS));
    this.windowMs = seconds * 1000;
    this.lm = new Float32Array(this.cap * STRIDE);
    this.t = new Float64Array(this.cap);
    this.ms = new Float32Array(this.cap);
    this.ctl = new Float32Array(this.cap * 3);
    this.flags = new Uint8Array(this.cap);
    this.state = new Uint8Array(this.cap);
    this.fx = new Uint8Array(this.cap);
    this.mode = new Uint8Array(this.cap);
    this.intent = new Float32Array(this.cap * INTENT_STRIDE);
    this.bird = new Float32Array(this.cap * BIRD_STRIDE);
    this.dropped = new Uint16Array(this.cap);
    this.longRender = new Uint16Array(this.cap);
  }

  get length() {
    return this.n;
  }

  /** Seconds of stream in the buffer (at most `blackBoxSeconds`). */
  get seconds() {
    return this.n > 1 ? (this.t[this.at(this.n - 1)] - this.t[this.at(0)]) / 1000 : 0;
  }

  /** `raw`: MediaPipe's 33 landmarks for the frame, null: nobody. `t`: ms, the frame's time (increasing). */
  add(t: number, raw: ArrayLike<{ x: number; y: number; z?: number; visibility?: number }> | null, ctx: BlackBoxContext) {
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
        this.lm[o + k * 4] = p.x;
        this.lm[o + k * 4 + 1] = p.y;
        this.lm[o + k * 4 + 2] = p.z ?? 0;
        this.lm[o + k * 4 + 3] = p.visibility ?? 0;
      }
    }
    this.flags[i] = f;
    this.state[i] = this.stateIndex(ctx.state);
    this.addEffect(i, ctx);
    // the window is time, not frames: at 30 fps the ring would otherwise hold twice the seconds
    while (this.n > 1 && this.t[this.head] < t - this.windowMs) {
      this.head = (this.head + 1) % this.cap;
      this.n--;
    }
  }

  private addEffect(i: number, ctx: BlackBoxContext) {
    let fx = 0;
    const p = ctx.intent;
    if (p !== undefined) {
      fx |= FX_INTENT;
      this.mode[i] = p ? MODES.indexOf(p.mode) + 1 : 0;
      const o = i * INTENT_STRIDE;
      for (let k = 0; k < INTENT_STRIDE; k++) this.intent[o + k] = p?.[INTENT_KEYS[k].key] ?? (INTENT_KEYS[k].omit === 'absent' ? NaN : 0);
    }
    const b = ctx.bird;
    if (b) {
      fx |= FX_BIRD | (b.onGround ? FX_GROUND : 0) | (b.perched ? FX_PERCHED : 0) | (b.dying ? FX_DYING : 0);
      const o = i * BIRD_STRIDE;
      this.bird[o] = b.x;
      this.bird[o + 1] = b.y;
      this.bird[o + 2] = b.vx;
      this.bird[o + 3] = b.vy;
    }
    if (ctx.dropped != null) {
      fx |= FX_DROPPED;
      this.dropped[i] = Math.min(U16, Math.max(0, ctx.dropped));
    }
    if (ctx.longRender !== undefined) {
      fx |= FX_LONG;
      this.longRender[i] = Math.min(U16, Math.max(0, ctx.longRender));
    }
    this.fx[i] = fx;
  }

  /**
   * A calibration finished at `t` (ms, frames' time): the shoot detector's baseline from then on, and the arms' noise
   * measured during its hold (null: not measured), so a dump replays with the arms' smoothing the game had.
   */
  calibrated(t: number, baseline: ShootBaseline, armNoise: ArmNoise | null = null) {
    this.calibrations.push({ t, baseline: { ...baseline }, armNoise: armNoise && { ...armNoise } });
    this.pruneCalibrations();
  }

  clear() {
    this.head = 0;
    this.n = 0;
    // the calibration still holds for the frames to come
    this.calibrations = this.calibrations.slice(-1);
  }

  /** The buffer as a replayable dump (allocates: call on the hotkey, not per frame). Null when it is empty. */
  dump(
    info: { model: string; delegate: string; config: Record<string, unknown>; flapping: boolean; source?: FrameSource | null },
    now = new Date(),
  ): BlackBoxDump | null {
    if (this.n === 0) return null;
    const t0 = this.t[this.at(0)];
    this.pruneCalibrations();
    const before = this.calibrations.filter((c) => c.t <= t0);
    const during = this.calibrations.filter((c) => c.t > t0);
    const frames: BlackBoxFrame[] = [];
    let last = -Infinity;
    let dropped = 0;
    let longRender = 0;
    for (let k = 0; k < this.n; k++) {
      const i = this.at(k);
      const f = this.flags[i];
      let lm: [number, number, number, number][] | null = null;
      if (f & 1) {
        lm = [];
        for (let p = 0; p < N; p++) {
          const o = i * STRIDE + p * 4;
          lm.push([round(this.lm[o], 4), round(this.lm[o + 1], 4), round(this.lm[o + 3], 2), round(this.lm[o + 2], 4)]);
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
        ...this.effectOf(i),
      });
      if (this.fx[i] & FX_DROPPED) dropped += this.dropped[i];
      if (this.fx[i] & FX_LONG) longRender += this.longRender[i];
    }
    return {
      version: 1,
      level: 'black-box',
      aspect: this.aspect,
      flapping: info.flapping,
      // the baseline in force at the first frame, and the calibrations after it, so the replay shoots as the game did
      baseline: before.length ? { ...before[before.length - 1].baseline } : null,
      ...(before.length && before[before.length - 1].armNoise ? { armNoise: { ...before[before.length - 1].armNoise! } } : {}),
      ...(during.length
        ? { calibrations: during.map((c) => ({ t: Math.round(c.t - t0), baseline: { ...c.baseline }, ...(c.armNoise ? { armNoise: { ...c.armNoise } } : {}) })) }
        : {}),
      startMs: 0,
      endMs: last,
      frames,
      blackBox: {
        recordedAt: now.toISOString(),
        seconds: last / 1000,
        model: info.model,
        delegate: info.delegate,
        config: info.config,
        format: BLACK_BOX_FORMAT,
        source: info.source ?? null,
        dropped,
        longRender,
        world: { width: WORLD.width, height: WORLD.height, groundY: WORLD.groundY, stepMs: round(STEP_MS, 3) },
      },
    };
  }

  /** a frame's effect as dump keys, each only when recorded */
  private effectOf(i: number): Pick<BlackBoxFrame, 'pi' | 'bd' | 'dr' | 'lr'> {
    const fx = this.fx[i];
    const e: Pick<BlackBoxFrame, 'pi' | 'bd' | 'dr' | 'lr'> = {};
    if (fx & FX_INTENT) {
      const m = this.mode[i];
      if (m === 0) e.pi = null;
      else {
        const o = i * INTENT_STRIDE;
        const pi: BlackBoxIntent = { m: MODES[m - 1], dx: 0, dy: 0 };
        for (let k = 0; k < INTENT_STRIDE; k++) {
          const { dump, decimals, omit } = INTENT_KEYS[k];
          const v = round(this.intent[o + k], decimals);
          if (omit === 'never' || (omit === 'zero' && v) || (omit === 'absent' && !Number.isNaN(v))) pi[dump] = v;
        }
        e.pi = pi;
      }
    }
    if (fx & FX_BIRD) {
      const o = i * BIRD_STRIDE;
      const bd: BlackBoxBird = { x: round(this.bird[o], 1), y: round(this.bird[o + 1], 1), vx: round(this.bird[o + 2], 2), vy: round(this.bird[o + 3], 2) };
      if (fx & FX_GROUND) bd.gr = true;
      if (fx & FX_PERCHED) bd.pe = true;
      if (fx & FX_DYING) bd.die = true;
      e.bd = bd;
    }
    if (fx & FX_DROPPED) e.dr = this.dropped[i];
    if (fx & FX_LONG) e.lr = this.longRender[i];
    return e;
  }

  /** Keeps the calibration in force at the oldest frame and the later ones (a handful at most). */
  private pruneCalibrations() {
    if (this.n === 0) return;
    const t0 = this.t[this.head];
    let k = 0;
    while (k + 1 < this.calibrations.length && this.calibrations[k + 1].t <= t0) k++;
    if (k > 0) this.calibrations = this.calibrations.slice(k);
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

const isArmNoise = (n: unknown): n is ArmNoise =>
  !!n && typeof n === 'object' && ['deg', 'norm', 'fps', 'frames'].every((k) => typeof (n as Record<string, unknown>)[k] === 'number');

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
    // the arms' noise measured at calibration: absent in older dumps (not measured, `auto` replays as `fixed`)
    ...(isArmNoise(d.armNoise) ? { armNoise: d.armNoise } : {}),
    ...(Array.isArray(d.calibrations)
      ? { calibrations: d.calibrations.map((c) => ({ t: c.t, baseline: c.baseline, ...(isArmNoise(c.armNoise) ? { armNoise: c.armNoise } : {}) })) }
      : {}),
    startMs: d.startMs ?? 0,
    endMs: d.endMs ?? end,
    frames: d.frames.map((f) => ({ t: f.t, lm: f.lm })),
  };
}

/** One frame's effect as `blackBoxEffect` reads it back: null where it was not recorded. */
export interface BlackBoxEffectFrame {
  /** ms from the dump's first frame (the frame's `t`) */
  t: number;
  /** whether the intent was recorded on this frame (false: `intent` null means unknown, not "no intent") */
  hasIntent: boolean;
  /** the pointing intent the bird was given; null: none (or not recorded, see `hasIntent`) */
  intent: PointingIntent | null;
  bird: BirdSample | null;
  /** camera frames dropped before this one; null: unknown */
  dropped: number | null;
  /** long render frames since the previous pose frame; null: not counted */
  longRender: number | null;
}

/** What `blackBoxEffect` returns: the header's totals and the frames. */
export interface BlackBoxEffect {
  format: number;
  source: FrameSource | null;
  dropped: number;
  longRender: number;
  world: { width: number; height: number; groundY: number; stepMs: number } | null;
  frames: BlackBoxEffectFrame[];
}

/**
 * Reads the effect back from a dump (a parsed JSON file): per frame the intent the bird was given and the bird's
 * state, for tests and analysis scripts. Null for a dump without it (written before format 2, or a plain recording).
 * Frames parallel `parseBlackBox(json).frames`.
 */
export function blackBoxEffect(json: unknown): BlackBoxEffect | null {
  const d = json as Partial<BlackBoxDump> | null;
  const h = d?.blackBox;
  if (!h || typeof h.format !== 'number' || h.format < 2 || !Array.isArray(d.frames)) return null;
  return {
    format: h.format,
    source: h.source ?? null,
    dropped: h.dropped ?? 0,
    longRender: h.longRender ?? 0,
    world: h.world ?? null,
    frames: d.frames.map((f) => ({
      t: f.t,
      hasIntent: f.pi !== undefined,
      intent: f.pi ? intentOf(f.pi) : null,
      bird: f.bd ? birdOf(f.bd) : null,
      dropped: typeof f.dr === 'number' ? f.dr : null,
      longRender: typeof f.lr === 'number' ? f.lr : null,
    })),
  };
}

const intentOf = (p: BlackBoxIntent): PointingIntent => {
  const out: PointingIntent = { mode: p.m, dx: 0, dy: 0 };
  for (const { key, dump, omit } of INTENT_KEYS) {
    const v = p[dump];
    if (typeof v === 'number' && (v || omit !== 'zero')) out[key] = v;
  }
  return out;
};
const birdOf = (b: BlackBoxBird): BirdSample => ({ x: b.x, y: b.y, vx: b.vx, vy: b.vy, onGround: !!b.gr, perched: !!b.pe, dying: !!b.die });

const round = (x: number, d: number) => {
  const m = 10 ** d;
  return Math.round(x * m) / m;
};
