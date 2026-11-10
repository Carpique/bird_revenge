/**
 * How quickly the bird's intent follows the arms on a recording of play, and how steady it stays.
 *
 * The reference is the raw geometry: `classifyArms` on MediaPipe's own landmarks of each frame, with no smoothing,
 * no EMA and no debounce. Wherever that reading holds still for `STABLE_MS` it is a pose the player took; a change
 * from one such pose to another is a change the bird should follow. Its delay is from the first frame of the new
 * pose to the full pipeline (`simulate`: One-Euro, arm stand-in, wrist gate, detectors, session; 60 Hz ticks)
 * telling the bird the same, for at least `MATCH_HOLD_MS`. A change to one arm pointing (`pointing.oneArm`) waits
 * `oneArmEnterMs` on purpose, so it is counted apart (`oneArm`), not in the delays of the poses.
 *
 * Only for recordings of the raw stream (`BlackBox` dumps): the tutorial recording is smoothed already.
 *
 * `opts.frames`: what the pipeline gets instead of the recording (a worse camera: `jitter`), the reference staying
 * the recording's own frames; `opts.sim`: options for `simulate` (the arms' measured noise); `opts.ticks`: the
 * pipeline's ticks in play where the caller simulated them already (with those frames and options).
 */
import { classifyArms, type PointingIntent } from '../../src/game/pointing';
import { pt } from '../../src/gestures/geometry';
import { L } from '../../src/pose/landmarks';
import type { PoseFrame } from '../../src/pose/types';
import { simulate, type Recording, type SimOptions, type TF, type Tick } from './harness';

const STABLE_MS = 300;
const MATCH_HOLD_MS = 150;
/** the pipeline must agree within this long after the new pose's segment ends, or the change counts as missed */
const MATCH_WINDOW_MS = 1500;
/** frames reading something else for up to this long (ms) do not end a held pose */
const BRIDGE_MS = 100;

export interface Latency {
  /** pose changes in the raw geometry */
  changes: number;
  /** ms from a new pose to the bird told the same: median, 90th percentile, mean; and how many were followed at all */
  p50: number;
  p90: number;
  mean: number;
  followed: number;
  /** changes of the bird's mode per minute of play, and of those how many lasted under 200 ms (flicker) */
  switchesPerMin: number;
  flicker: number;
  /** changes to one arm pointing (not among `changes`): how many, how many followed, the median and the longest delay, ms */
  oneArm: { changes: number; followed: number; p50: number; max: number };
}

const dirOf = (f: PoseFrame, side: 'left' | 'right') => {
  const sh = pt(f, side === 'left' ? L.leftShoulder : L.rightShoulder);
  const wr = pt(f, side === 'left' ? L.leftWrist : L.rightWrist);
  const x = -(wr.x - sh.x), y = -(wr.y - sh.y);
  const n = Math.hypot(x, y) || 1;
  return { x: x / n, y: y / n };
};
const ang = (p: { dx: number; dy: number }) => (Math.atan2(p.dy, p.dx) * 180) / Math.PI;
const angDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
const same = (a: PointingIntent | null, b: PointingIntent | null) =>
  !!a && !!b && a.mode === b.mode && (a.mode !== 'fly' || angDiff(ang(a), ang(b)) < 30) && (a.mode !== 'drift' || a.dx === b.dx);
/** the same pose of the arms: as `same`, and one arm pointing is not both */
const samePose = (a: PointingIntent, b: PointingIntent) => same(a, b) && !!a.oneArm === !!b.oneArm;
const quantile = (xs: number[], q: number) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(q * (xs.length - 1))] : NaN);

export function latency(rec: Recording, opts: { frames?: TF[]; sim?: SimOptions; ticks?: Tick[] } = {}): Latency {
  // the raw geometry, frame by frame
  const raw = rec.frames.map(({ t, f }) => ({ t, nobody: !f, p: f ? classifyArms(dirOf(f, 'left'), dirOf(f, 'right'), null) : null }));
  // a pose held: the same reading frame after frame; a frame with nobody in view ends it, and so does a gap of
  // more than BRIDGE_MS of frames reading something else (a single odd frame in a held pose is noise)
  const segs: { t0: number; t1: number; p: PointingIntent }[] = [];
  let cur: { t0: number; t1: number; p: PointingIntent } | null = null;
  for (const e of raw) {
    if (e.nobody) cur = null;
    else if (e.p && cur && samePose(e.p, cur.p) && e.t - cur.t1 <= BRIDGE_MS) cur.t1 = e.t;
    else if (e.p) segs.push((cur = { t0: e.t, t1: e.t, p: e.p }));
  }
  const stable = segs.filter((s) => s.t1 - s.t0 >= STABLE_MS);

  // the full pipeline, as the game plays it (a dump starts in play)
  const ticks = opts.ticks ?? simulate(rec, opts.frames ?? rec.frames, { ...opts.sim, startState: 'playing' }).ticks.filter((k) => k.state === 'playing');
  const intents = ticks.map((k) => ({
    t: k.t,
    p: (k.mode === 'fly'
      ? { mode: 'fly', dx: Math.cos((k.ang * Math.PI) / 180), dy: Math.sin((k.ang * Math.PI) / 180) }
      : k.mode === 'drift'
        ? { mode: 'drift', dx: k.ang === 0 ? 1 : -1, dy: 0 }
        : k.mode === 'rest' || k.mode === 'hover'
          ? { mode: k.mode, dx: 0, dy: 0 }
          : null) as PointingIntent | null,
  }));

  const delays: number[] = [], oneArmDelays: number[] = [];
  let changes = 0, oneArmChanges = 0;
  for (let i = 1; i < stable.length; i++) {
    const s = stable[i];
    if (samePose(s.p, stable[i - 1].p)) continue;
    if (s.p.oneArm) oneArmChanges++;
    else changes++;
    // followed: the bird told the same for MATCH_HOLD_MS in full, within the window
    let start: number | null = null;
    let followedAt: number | null = null;
    for (const e of intents) {
      if (e.t < s.t0 - 50) continue;
      if (e.t > s.t1 + MATCH_WINDOW_MS) break;
      if (same(e.p, s.p)) {
        start ??= e.t;
        if (e.t - start >= MATCH_HOLD_MS) {
          followedAt = start;
          break;
        }
      } else start = null;
    }
    if (followedAt !== null) (s.p.oneArm ? oneArmDelays : delays).push(Math.max(0, followedAt - s.t0));
  }

  const modes: { t0: number; t1: number }[] = [];
  let prev: string | null = null;
  for (const e of intents) {
    const m = e.p?.mode ?? 'none';
    if (m === prev) modes[modes.length - 1].t1 = e.t;
    else modes.push({ t0: e.t, t1: e.t });
    prev = m;
  }
  const minutes = ticks.length ? (ticks[ticks.length - 1].t - ticks[0].t) / 60000 : 1;
  return {
    changes,
    p50: Math.round(quantile(delays, 0.5)),
    p90: Math.round(quantile(delays, 0.9)),
    mean: delays.length ? Math.round(delays.reduce((a, b) => a + b, 0) / delays.length) : NaN,
    followed: delays.length,
    switchesPerMin: Math.round((modes.length / minutes) * 10) / 10,
    flicker: modes.filter((m) => m.t1 - m.t0 < 200).length,
    oneArm: { changes: oneArmChanges, followed: oneArmDelays.length, p50: Math.round(quantile(oneArmDelays, 0.5)), max: oneArmDelays.length ? Math.round(Math.max(...oneArmDelays)) : NaN },
  };
}
