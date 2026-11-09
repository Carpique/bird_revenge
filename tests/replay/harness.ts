/**
 * Replay harness: recorded pose sessions played through the real pipeline, with the game side of `main.ts`.
 *
 * What is real: `PoseSmoother` (arm stand-in + One-Euro filters, as in `PoseTracker.process`), `PoseDetectors` (visibility
 * monitor, flap / shoot / tilt / pointing), `PoseSession` (the game's rules on the pose stream: state changes,
 * controls, staleness) and `config`.
 *
 * What is modelled:
 *  - the camera / MediaPipe: frames come from the recording at their own times (a recorded frame is taken for the
 *    tracker's raw output, so smoothing runs a second time over already smoothed data; close enough for the
 *    rules under test). `null` frames leave the filters alone (a long gap resets them, as in the tracker). A hitch is frames not delivered.
 *  - the calibration dialog: done once the player has been in frame for `config.calibration.holdMs` (the real one
 *    wants an X pose, which a recording can't give), then the countdown (`config.countdownMs`), then playing.
 *  - the ticker: 60 Hz (`tickMs`); the bird gets `PoseSession.controls` on every tick.
 *
 * Perturbations (`nullGap`, `hitch`, ...) take and return frame lists, so they compose.
 */
import tutorialJson from '../../src/tutorial/control-tutorial.json?raw';
import { config } from '../../src/config';
import { PoseDetectors, type PoseReading } from '../../src/input/poseControls';
import { PoseSession } from '../../src/input/poseSession';
import { PoseSmoother } from '../../src/pose/PoseSmoother';
import type { PoseFrame } from '../../src/pose/types';
import type { PoseRecording } from '../../src/tutorial/recording';

export const TICK_MS = 1000 / 60;

/** a frame as the tracker would deliver it, at time `t` (ms); `f` null: nobody in view */
export interface TF {
  t: number;
  f: PoseFrame | null;
}

export interface Recording {
  name: string;
  rec: PoseRecording;
  /** the frames as the tracker delivers them, from the first one */
  frames: TF[];
  /** the clip proper: before it the detectors only warm up (`startMs`..`endMs` of the recording) */
  startMs: number;
  endMs: number;
}

export function toRecording(name: string, rec: PoseRecording): Recording {
  const frames: TF[] = rec.frames.map((fr): TF => ({
    t: fr.t,
    f: fr.lm && { t: fr.t, aspect: rec.aspect, lm: fr.lm.map(([x, y, v, z]) => (z === undefined ? { x, y, v } : { x, y, v, z })) },
  }));
  return { name, rec, frames, startMs: rec.startMs, endMs: rec.endMs };
}

/** the extra recordings, `tests/replay/recordings/*.json` (see the README there) */
const extraJson = import.meta.glob<string>('./recordings/*.json', { eager: true, query: '?raw', import: 'default' });

const parse = (name: string, json: string) => toRecording(name, JSON.parse(json) as PoseRecording);

/** the instructions page's recording, the reference one */
export const tutorialRecording = () => parse('control-tutorial', tutorialJson);

/** the tutorial recording plus every `tests/replay/recordings/*.json` */
export function allRecordings(): Recording[] {
  const extra = Object.entries(extraJson).sort(([a], [b]) => a.localeCompare(b));
  return [tutorialRecording(), ...extra.map(([file, json]) => parse(file.replace(/^.*\/|\.json$/g, ''), json))];
}

export const cloneFrames = (frames: TF[]): TF[] => frames.map(({ t, f }) => ({ t, f: f && { ...f, lm: f.lm.map((p) => ({ ...p })) } }));

// ---------------------------------------------------------------------------------------------------------------
// perturbations: each returns new frames, the input is left alone
// ---------------------------------------------------------------------------------------------------------------

const inWindow = (t: number, t0: number, ms: number) => t >= t0 && (ms === Infinity || t < t0 + ms);

/** frames in [t0, t0 + ms) arrive as "nobody in view" (the tracker lost the person) */
export function nullGap(frames: TF[], t0: number, ms: number): TF[] {
  return frames.map(({ t, f }) => ({ t, f: inWindow(t, t0, ms) ? null : f && cloneFrame(f) }));
}

/** `n` frames from the first one at or after `t0` arrive as "nobody in view" */
export function nullFrames(frames: TF[], t0: number, n: number): TF[] {
  const i0 = frames.findIndex((x) => x.t >= t0);
  return cloneFrames(frames).map((x, i) => (i >= i0 && i < i0 + n ? { t: x.t, f: null } : x));
}

/** no frames at all in [t0, t0 + ms): the page stalled, no callbacks, not even null ones */
export function hitch(frames: TF[], t0: number, ms: number): TF[] {
  return cloneFrames(frames.filter(({ t }) => !inWindow(t, t0, ms)));
}

/** `landmarks` get visibility `v` in [t0, t0 + ms) */
export function lowVisibility(frames: TF[], t0: number, ms: number, landmarks: number[], v = 0.1): TF[] {
  return cloneFrames(frames).map((x) => {
    if (x.f && inWindow(x.t, t0, ms)) for (const i of landmarks) x.f.lm[i].v = v;
    return x;
  });
}

/** gaussian noise of `sigma` (normalised image units) on every landmark, seeded */
export function jitter(frames: TF[], sigma: number, seed = 1): TF[] {
  const g = rng(seed).g;
  return cloneFrames(frames).map((x) => {
    if (x.f)
      for (const p of x.f.lm) {
        p.x += sigma * g();
        p.y += sigma * g();
      }
    return x;
  });
}

/** the whole person moved by (dx, dy), normalised image units, from `t0` on (default: all) */
export function shift(frames: TF[], dx: number, dy = 0, t0 = -Infinity, ms = Infinity): TF[] {
  return cloneFrames(frames).map((x) => {
    if (x.f && inWindow(x.t, t0, ms))
      for (const p of x.f.lm) {
        p.x += dx;
        p.y += dy;
      }
    return x;
  });
}

/**
 * MediaPipe's habit: an arm it can't see gets a wrist (and elbow) guessed hanging down from the shoulder, with a
 * low visibility. In [t0, t0 + ms) the `side` arm is replaced by that guess.
 */
export function wristHallucination(frames: TF[], t0: number, ms: number, side: 'left' | 'right' = 'left', v = 0.3): TF[] {
  const [sh, el, wr] = side === 'left' ? [11, 13, 15] : [12, 14, 16];
  return cloneFrames(frames).map((x) => {
    if (x.f && inWindow(x.t, t0, ms)) {
      const lm = x.f.lm;
      const len = Math.hypot(lm[wr].x - lm[sh].x, lm[wr].y - lm[sh].y);
      lm[wr] = { x: lm[sh].x, y: lm[sh].y + len, v };
      lm[el] = { x: lm[sh].x, y: lm[sh].y + len / 2, v };
    }
    return x;
  });
}

/**
 * Only the wrist of `side` is guessed, hanging down from the shoulder, with a low visibility `v`; the elbow stays as
 * recorded and confident (the case of `pose.minWristVisibility`).
 */
export function lowWristHanging(frames: TF[], t0: number, ms: number, side: 'left' | 'right' = 'left', v = 0.15): TF[] {
  const [sh, wr] = side === 'left' ? [11, 15] : [12, 16];
  return cloneFrames(frames).map((x) => {
    if (x.f && inWindow(x.t, t0, ms)) {
      const lm = x.f.lm;
      const len = Math.hypot(lm[wr].x - lm[sh].x, lm[wr].y - lm[sh].y);
      lm[wr] = { x: lm[sh].x, y: lm[sh].y + len, v };
    }
    return x;
  });
}

const cloneFrame = (f: PoseFrame): PoseFrame => ({ ...f, lm: f.lm.map((p) => ({ ...p })) });

/** seeded random numbers: uniform `u`, standard normal `g` */
export function rng(seed: number) {
  let s = seed >>> 0;
  const u = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const g = () => {
    const a = Math.max(1e-9, u()), b = u();
    return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b);
  };
  return { u, g };
}

// ---------------------------------------------------------------------------------------------------------------
// the simulation
// ---------------------------------------------------------------------------------------------------------------

/** `PoseTracker.process` for a frame list: the real `PoseSmoother` (arm stand-in, One-Euro filters; a short gap leaves them be) */
export class SimTracker {
  private smoother = new PoseSmoother();

  process(f: PoseFrame | null): PoseFrame | null {
    if (!f) return null;
    const raw = f.lm.map((p) => ({ x: p.x, y: p.y, z: p.z ?? 0, visibility: p.v }));
    return { ...f, lm: this.smoother.process(raw, f.aspect, f.t)! };
  }

  /** `PoseTracker.redetect`: forget the person */
  redetect() {
    this.smoother.reset();
  }
}

export type SimState = 'calibrating' | 'countdown' | 'playing' | 'outOfFrame';

/** what the bird is told on a tick, as a mode: 'stale' (pose too old), a pointing mode, or the state when not playing */
export interface Tick {
  t: number;
  state: SimState;
  mode: string;
  /** the flying direction in degrees (mode 'fly'), 0 or 180 for drift */
  ang: number;
  /** drift with the arms lowered: the sinking speed (px per physics step), else 0 */
  sink: number;
}

export interface SimEvent {
  t: number;
  type: 'recalibrate' | 'outOfFrame' | 'resume' | 'calibrated' | 'countdownEnd' | 'redetect';
}

export interface SimResult {
  ticks: Tick[];
  events: SimEvent[];
  /** times (ms) the shoot gesture fired the poo button while playing */
  triggers: number[];
}

export interface SimOptions {
  tickMs?: number;
  /** the state at the start (default `calibrating`, as a game starts: the first frames bring the player in) */
  startState?: SimState;
}

/** Plays `frames` (what the tracker delivers: perturbed or not) through the pipeline and the game's rules. */
export function simulate(rec: Recording, frames: TF[], opts: SimOptions = {}): SimResult {
  const tickMs = opts.tickMs ?? TICK_MS;
  const detectors = new PoseDetectors();
  if (rec.rec.baseline) detectors.shoot.calibrate({ ...rec.rec.baseline });
  // later calibrations in the recording (a black-box dump): the shoot detector takes each baseline from its time on
  const calibrations = [...(rec.rec.calibrations ?? [])].sort((a, b) => a.t - b.t);
  let ci = 0;
  const session = new PoseSession();
  const tracker = new SimTracker();
  const out: SimResult = { ticks: [], events: [], triggers: [] };
  const ev = (t: number, type: SimEvent['type']) => out.events.push({ t, type });

  let state: SimState = opts.startState ?? 'calibrating';
  let calmSince: number | null = null;
  let countdownEnd = 0;
  let fi = 0;
  const end = rec.frames[rec.frames.length - 1].t;
  for (let tick = 0; tick <= end; tick += tickMs) {
    // the frames that arrived by now
    while (fi < frames.length && frames[fi].t <= tick) {
      const { t } = frames[fi];
      while (ci < calibrations.length && calibrations[ci].t <= t) detectors.shoot.calibrate({ ...calibrations[ci++].baseline });
      const f = tracker.process(frames[fi++].f);
      const reading: PoseReading = detectors.update(f, t);
      const step = session.update(state, reading, t);
      if (step.redetect) {
        tracker.redetect();
        ev(t, 'redetect');
      }
      if (step.recalibrate) {
        ev(t, 'recalibrate');
        calmSince = null;
      } else if (step.state !== state) {
        ev(t, step.state === 'outOfFrame' ? 'outOfFrame' : 'resume');
      }
      state = step.state;
      if (step.shoot) out.triggers.push(t);
      if (state === 'calibrating') {
        calmSince = reading.vis.inFrame && reading.vis.playerPresent ? (calmSince ?? t) : null;
        if (calmSince !== null && t - calmSince >= config.calibration.holdMs) {
          state = 'countdown';
          countdownEnd = t + config.countdownMs;
          ev(t, 'calibrated');
        }
      }
    }
    // a gap in the pose goes on between frames too (as the ticker does in main.ts)
    const gapStep = session.tick(state, tick);
    if (gapStep.recalibrate) {
      ev(tick, 'recalibrate');
      calmSince = null;
    } else if (gapStep.state !== state) {
      ev(tick, 'outOfFrame');
    }
    state = gapStep.state;
    if (state === 'countdown' && tick >= countdownEnd) {
      state = 'playing';
      ev(tick, 'countdownEnd');
    }
    const c = session.controls(state, tick);
    const p = c.pointing;
    let mode: string = state;
    let ang = 0;
    if (state === 'playing') {
      mode = p ? p.mode : 'stale';
      if (p?.mode === 'fly') ang = (Math.atan2(p.dy, p.dx) * 180) / Math.PI;
      else if (p?.mode === 'drift') ang = p.dx > 0 ? 0 : 180;
    }
    out.ticks.push({ t: tick, state, mode, ang, sink: state === 'playing' && p?.mode === 'drift' ? (p.sink ?? 0) : 0 });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// metrics
// ---------------------------------------------------------------------------------------------------------------

const angDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
/** two ticks tell the bird the same: same mode, and flying roughly the same way */
export const sameControl = (a: Tick, b: Tick) => a.mode === b.mode && (a.mode !== 'fly' || angDiff(a.ang, b.ang) < 30);

export interface Metrics {
  /** times the big calibration dialog came up */
  recalibrations: number;
  /** ms in the state outOfFrame (the soft pause) */
  outOfFrameMs: number;
  /** ms in calibrating or countdown (the game paused behind the dialog) */
  calibratingMs: number;
  /** ms playing with the pose too old to apply: the bird has no controls (it falls) */
  staleMs: number;
  /** ms playing with controls different from the clean run's */
  wrongMs: number;
  /** from the end of the perturbation until the run agrees with the clean one for `RECOVERY_HOLD_MS`; null: never */
  recoveryMs: number | null;
  /** poo triggers in the window */
  triggers: number;
  /** times the tracker was told to look again for the player */
  redetects: number;
}

export const RECOVERY_HOLD_MS = 300;

/**
 * The run `run` against the clean `ref` (same recording, no perturbation), over [from, to] ms. `perturbedUntil`:
 * where the perturbation ends, for `recoveryMs`.
 */
export function measure(run: SimResult, ref: SimResult, from: number, to: number, perturbedUntil: number): Metrics {
  const m: Metrics = { recalibrations: 0, outOfFrameMs: 0, calibratingMs: 0, staleMs: 0, wrongMs: 0, recoveryMs: null, triggers: 0, redetects: 0 };
  const dt = run.ticks.length > 1 ? run.ticks[1].t - run.ticks[0].t : TICK_MS;
  const agrees = (i: number) => run.ticks[i].state === 'playing' && run.ticks[i].mode !== 'stale' && sameControl(run.ticks[i], ref.ticks[i]);
  let streakStart: number | null = null;
  run.ticks.forEach((tk, i) => {
    if (tk.t < from || tk.t > to) return;
    if (tk.state === 'outOfFrame') m.outOfFrameMs += dt;
    else if (tk.state === 'calibrating' || tk.state === 'countdown') m.calibratingMs += dt;
    else if (tk.mode === 'stale') m.staleMs += dt;
    else if (!sameControl(tk, ref.ticks[i])) m.wrongMs += dt;
    if (tk.t >= perturbedUntil && m.recoveryMs === null) {
      if (agrees(i)) {
        streakStart ??= tk.t;
        if (tk.t - streakStart >= RECOVERY_HOLD_MS) m.recoveryMs = Math.round(streakStart - perturbedUntil);
      } else streakStart = null;
    }
  });
  const inRange = (e: { t: number }) => e.t >= from && e.t <= to;
  m.recalibrations = run.events.filter((e) => e.type === 'recalibrate' && inRange(e)).length;
  m.redetects = run.events.filter((e) => e.type === 'redetect' && inRange(e)).length;
  m.triggers = run.triggers.filter((t) => t >= from && t <= to).length;
  for (const k of ['outOfFrameMs', 'calibratingMs', 'staleMs', 'wrongMs'] as const) m[k] = Math.round(m[k]);
  return m;
}

/** ms to leave after the clean run is playing before anything counts, for the detectors to settle */
export const WARMUP_MS = 1000;

/** the clean run of a recording, and the span of it that counts: from the game playing (calibration, countdown behind it) */
export function cleanRun(rec: Recording) {
  const run = simulate(rec, rec.frames);
  const playing = run.ticks.find((tk) => tk.state === 'playing');
  const from = Math.max(rec.startMs, (playing?.t ?? 0) + WARMUP_MS);
  return { run, from, to: rec.endMs };
}
