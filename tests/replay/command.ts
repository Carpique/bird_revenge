import { config } from '../../src/config';
import { classifyArms, continuousArms, outwardElevation, type PointingIntent } from '../../src/game/pointing';
import { STEP_MS } from '../../src/game/physics';
import type { PointingOutput } from '../../src/gestures/PointingDetector';
import { pt, type Vec } from '../../src/gestures/geometry';
import { PoseDetectors } from '../../src/input/poseControls';
import type { ArmNoise } from '../../src/pose/armSmoothing';
import { L } from '../../src/pose/landmarks';
import type { PoseFrame } from '../../src/pose/types';
import { setArmNoise, SimTracker, type Recording, type Tick } from './harness';

/**
 * The command the arms give the bird on a recording of play, for the replay tests of steering: the velocity an intent
 * asks for, the arms of a raw frame, the frames in play through the pipeline, how far the pipeline's command lags
 * the same map on the raw frames, and the continuous command's frame-to-frame jumps.
 */
/** the velocity a discrete intent asks for (px per step, y down); the rest: none */
export function discreteVelocity(p: PointingIntent): Vec {
  const cfg = config.pointing;
  if (p.mode === 'fly') return { x: p.dx * cfg.cruiseSpeed * (p.speed ?? 1), y: -p.dy * cfg.cruiseSpeed * (p.speed ?? 1) };
  if (p.mode === 'drift') return { x: p.dx * cfg.driftSpeed, y: p.sink ?? 0 };
  return { x: 0, y: 0 };
}
export const velocityOf = (p: PointingIntent): Vec => (p.vx !== undefined ? { x: p.vx, y: p.vy ?? 0 } : discreteVelocity(p));

/** a raw frame's arm (shoulder → wrist, mirrored, y up): no One-Euro, no EMA */
export function rawArm(f: PoseFrame, side: 'left' | 'right'): Vec {
  const sh = pt(f, side === 'left' ? L.leftShoulder : L.rightShoulder);
  const wr = pt(f, side === 'left' ? L.leftWrist : L.rightWrist);
  const x = -(wr.x - sh.x), y = -(wr.y - sh.y);
  const n = Math.hypot(x, y) || 1;
  return { x: x / n, y: y / n };
}

export interface FrameRow {
  /** the frame's index in the recording */
  i: number;
  dt: number;
  out: PointingOutput;
}

/** the frames recorded in play with both arms visible, through the pipeline (`SimTracker`, `PoseDetectors`; the arms' noise measured at calibration: the recording's, or `armNoise`) */
export function perFrame(rec: Recording, armNoise: ArmNoise | null = rec.rec.armNoise ?? null): FrameRow[] {
  const tracker = new SimTracker();
  const det = new PoseDetectors();
  setArmNoise(tracker, det, armNoise);
  if (rec.rec.baseline) det.shoot.calibrate({ ...rec.rec.baseline });
  const st = (rec.rec.frames as { st?: string }[]).map((f) => f.st ?? 'playing');
  const rows: FrameRow[] = [];
  rec.frames.forEach(({ t, f }, i) => {
    const p = det.update(tracker.process(f), t).pointing;
    if (i + 1 >= rec.frames.length || st[i] !== 'playing' || !p?.intent) return;
    rows.push({ i, dt: Math.min(100, rec.frames[i + 1].t - t), out: p });
  });
  return rows;
}

/**
 * The lag (ms) of the pipeline's asked-for velocity behind the same map applied to each raw frame (no One-Euro, no
 * EMA, no debounce; the discrete map keeps its own hysteresis, a frame matching nothing is left out): the shift of
 * the raw series that matches the pipeline's best (least mean squared difference), refined between ticks.
 */
export function commandLag(rec: Recording, ticks: Tick[], continuous = config.pointing.continuous): number {
  const raw: { t: number; v: Vec | null }[] = [];
  let prev: PointingIntent | null = null;
  for (const { t, f } of rec.frames) {
    if (!f) {
      raw.push({ t, v: null });
      continue;
    }
    const l = rawArm(f, 'left'), r = rawArm(f, 'right');
    if (continuous) {
      raw.push({ t, v: velocityOf(continuousArms(l, r)) });
      continue;
    }
    const p = classifyArms(l, r, prev?.mode ?? null);
    if (p) prev = p;
    let v = p && discreteVelocity(p);
    if (p?.mode === 'drift' && config.pointing.descend) {
      const lowered = -(outwardElevation(l, -1) + outwardElevation(r, 1)) / 2;
      const span = Math.max(1e-6, config.pointing.descendFull - config.pointing.descendZero);
      if (lowered >= config.pointing.descendEnter) v = { x: v!.x, y: config.pointing.descendSpeed * Math.min(1, Math.max(0, (lowered - config.pointing.descendZero) / span)) };
    }
    raw.push({ t, v });
  }
  // the raw reading at each tick: the last frame by then
  const at: (Vec | null)[] = [];
  let fi = -1;
  for (let i = 0; i < ticks.length; i++) {
    while (fi + 1 < raw.length && raw[fi + 1].t <= ticks[i].t) fi++;
    at.push(fi >= 0 ? raw[fi].v : null);
  }
  const pipe = ticks.map((k) => (k.intent ? velocityOf(k.intent) : null));
  const err = (s: number) => {
    let sum = 0, n = 0;
    for (let i = s; i < ticks.length; i++) {
      const a = pipe[i], b = at[i - s];
      if (!a || !b) continue;
      sum += (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
      n++;
    }
    return n ? sum / n : Infinity;
  };
  const maxShift = Math.round(400 / STEP_MS);
  const es = Array.from({ length: maxShift + 1 }, (_, s) => err(s));
  let best = 0;
  for (let s = 1; s <= maxShift; s++) if (es[s] < es[best]) best = s;
  // parabola through the best and its neighbours
  let off = 0;
  if (best > 0 && best < maxShift) {
    const [a, b, c2] = [es[best - 1], es[best], es[best + 1]];
    const d = a - 2 * b + c2;
    if (d > 0) off = (0.5 * (a - c2)) / d;
  }
  return (best + off) * STEP_MS;
}

/** frame-to-frame jumps of the continuous command (px per step), over consecutive frames both not at rest */
export function jumps(rows: FrameRow[]): number[] {
  const js: number[] = [];
  let prev: Vec | null = null, prevI = -2;
  for (const { i, out } of rows) {
    const p = out.intent!;
    const v = p.mode === 'rest' ? null : velocityOf(p);
    if (v && prev && i === prevI + 1) js.push(Math.hypot(v.x - prev.x, v.y - prev.y));
    prev = v;
    prevI = i;
  }
  return js;
}
