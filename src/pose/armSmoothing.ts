import { config } from '../config';
import { L } from './landmarks';

/** `smoothing.arms`: today's chain, none, or one stage matched to the noise measured at calibration */
export type ArmSmoothingMode = 'fixed' | 'off' | 'auto';

/**
 * The arms' smoothing in force: today's chain (One-Euro at `smoothing.minCutoff` / `armBeta` on the arm landmarks,
 * then `pointing.smoothingMs`' EMA of the arm directions), none (the landmarks as MediaPipe gives them, no EMA), or
 * one stage: the arm landmarks' One-Euro with its `minCutoff` at `cutoff` Hz (`armBeta` unchanged), no EMA.
 */
export type ArmFilter = { kind: 'fixed' } | { kind: 'off' } | { kind: 'lowpass'; cutoff: number };

/** The noise of the arms measured while the player holds still (`ArmNoiseMeter`). */
export interface ArmNoise {
  /** the arm direction's (shoulder → wrist) noise, deg (standard deviation per frame) */
  deg: number;
  /** the shoulders' and wrists' coordinates' noise, normalised image units (standard deviation per frame) */
  norm: number;
  /** the frame rate it was measured at, frames per second */
  fps: number;
  /** frames it was measured on */
  frames: number;
}

/**
 * The arm angle noise (deg) at or below which the arms need no filter, and the noise `auto` filters down to above it.
 * Why 1: the poses' hystereses are 5 deg wide and the dead zones 15 deg; with 1 deg of independent noise per frame
 * two frames differ by 5 deg once in ~2000 pairs (3.5 sigma of the difference), and a mode must then hold for
 * `pointing.enterMs` besides. The recordings of play measure 0.04-0.6 deg (`ArmNoiseMeter`, one camera, good light),
 * below it: there `auto` is `off`. One constant for both ends: noise already under the target needs no filter.
 */
export const ARM_NOISE_TARGET_DEG = 1;
/**
 * `auto`'s cutoff never goes below this (Hz): a time constant of 160 ms at rest, about `fixed`'s chain at its
 * steadiest (One-Euro 2 Hz = 80 ms plus the EMA's 35 ms, both at rest). Noise that needs more is left above the
 * target rather than made to lag further (above 3.2 deg at 30 fps). The One-Euro keeps `armBeta`, so in motion it
 * opens as `fixed`'s does (a plain low-pass, beta 0, made the mean delay of a change 56-98 ms longer than `fixed`'s
 * at 0.01 of the image of added noise); the noise opens it a little at rest too (the noise's speed filtered at `dCutoff` times
 * beta: ~0.4 Hz at 0.01 of the image), so the residual comes out a little above the rule's (1.1-1.25 deg measured).
 */
export const AUTO_MIN_CUTOFF_HZ = 1;

/**
 * Residual noise of a first-order low-pass on white noise, as a ratio of standard deviations: the variance ratio is
 * alpha / (2 - alpha), with the filter's alpha for `cutoff` (Hz) at `fps` (as `OneEuroFilter.alpha`).
 */
export function noiseGain(cutoff: number, fps: number): number {
  const dt = 1 / fps;
  const tau = 1 / (2 * Math.PI * cutoff);
  const a = 1 / (1 + tau / dt);
  return Math.sqrt(a / (2 - a));
}

/**
 * The highest cutoff (Hz) whose residual noise (`noiseGain`) is `ARM_NOISE_TARGET_DEG`, for arm noise `deg` measured
 * at `fps`; null: no filter needed (at or below the target, or a cutoff at or above half the frame rate, which would
 * take off less than a quarter of the noise: noise just over the target). Never below `AUTO_MIN_CUTOFF_HZ`.
 */
export function cutoffFor(deg: number, fps: number): number | null {
  if (!(deg > ARM_NOISE_TARGET_DEG) || !(fps > 0)) return null;
  const g2 = (ARM_NOISE_TARGET_DEG / deg) ** 2;
  // alpha / (2 - alpha) = g2  =>  alpha = 2 g2 / (1 + g2); alpha = 1 / (1 + tau fps)  =>  tau = (1 / alpha - 1) / fps
  const a = (2 * g2) / (1 + g2);
  const cutoff = 1 / (2 * Math.PI * ((1 / a - 1) / fps));
  return cutoff >= fps / 2 ? null : Math.max(AUTO_MIN_CUTOFF_HZ, cutoff);
}

/**
 * The arms' filter for `mode` and the noise measured at calibration (null: none measured). Flapping control keeps
 * today's chain whatever the switch says (its detectors read the same landmarks); `auto` without a measurement
 * (keyboard start, a replay without one) is `fixed`, and so is a mode it does not know.
 */
export function armFilterFor(mode: ArmSmoothingMode, noise: ArmNoise | null, flapping = config.pointing.flapping): ArmFilter {
  if (flapping || (mode !== 'off' && mode !== 'auto')) return { kind: 'fixed' }; // anything else (a stale saved value): fixed
  if (mode === 'off') return { kind: 'off' };
  if (!noise) return { kind: 'fixed' };
  const cutoff = cutoffFor(noise.deg, noise.fps);
  return cutoff === null ? { kind: 'off' } : { kind: 'lowpass', cutoff };
}

/** The filter as the debug panel shows it: "fixed", "off", "6.1 Hz". */
export const armFilterLabel = (f: ArmFilter) => (f.kind === 'lowpass' ? `${f.cutoff.toFixed(1)} Hz` : f.kind);

/** a landmark as the meter takes it: MediaPipe's own (normalised image coordinates) */
interface Pt {
  x: number;
  y: number;
}

/** frames closer than this (ms, the two neighbours of a frame) are used; wider: a dropped stretch, the sway shows */
const MAX_SPAN_MS = 150;

/**
 * Measures the arms' noise while the player holds still (the calibration hold): fed MediaPipe's raw landmarks frame by
 * frame, it gives the noise of the arm directions (deg) and of the shoulders' and wrists' coordinates. A person
 * "holding still" sways slowly, so not the spread of the positions: each frame against the straight line between its
 * two neighbours (a second difference, weighted for uneven frame times), which a slow sway hardly moves (0.02 of
 * the image over 2 s adds ~1e-4) and white noise of sigma turns into sigma * sqrt(1 + w1^2 + w2^2). Pure: no DOM.
 * Noise MediaPipe correlates over frames (it smooths in VIDEO mode) is seen only in part, as any sway-proof meter would.
 */
export class ArmNoiseMeter {
  /** per frame: time, the two arm angles (deg, unwrapped), the shoulders' and wrists' coordinates */
  private frames: { t: number; ang: [number, number]; xy: number[] }[] = [];

  constructor(
    /** fewer frames than this: not measured */
    readonly minFrames = 15,
  ) {}

  reset() {
    this.frames = [];
  }

  get count() {
    return this.frames.length;
  }

  /** One raw frame (33 landmarks), `aspect` = width / height, `t` ms. */
  add(lm: readonly Pt[], aspect: number, t: number) {
    const prev = this.frames[this.frames.length - 1];
    if (prev && t <= prev.t) return;
    const arm = (s: number, w: number) => (Math.atan2(-(lm[w].y - lm[s].y), -(lm[w].x - lm[s].x) * aspect) * 180) / Math.PI;
    const ang: [number, number] = [arm(L.leftShoulder, L.leftWrist), arm(L.rightShoulder, L.rightWrist)];
    if (prev) for (let k = 0; k < 2; k++) ang[k] = prev.ang[k] + ((((ang[k] - prev.ang[k]) % 360) + 540) % 360) - 180;
    const xy: number[] = [];
    for (const i of [L.leftShoulder, L.rightShoulder, L.leftWrist, L.rightWrist]) xy.push(lm[i].x, lm[i].y);
    this.frames.push({ t, ang, xy });
  }

  /** The noise so far; null: too few frames (or no usable triple). */
  result(): ArmNoise | null {
    const fs = this.frames;
    if (fs.length < this.minFrames) return null;
    let angSum = 0, xySum = 0, n = 0;
    for (let i = 1; i + 1 < fs.length; i++) {
      const t0 = fs[i - 1].t, t1 = fs[i].t, t2 = fs[i + 1].t;
      if (t2 - t0 > MAX_SPAN_MS) continue;
      const w0 = (t2 - t1) / (t2 - t0), w2 = (t1 - t0) / (t2 - t0);
      const k = 1 + w0 * w0 + w2 * w2;
      const res = (a: number, b: number, c: number) => (b - (w0 * a + w2 * c)) ** 2 / k;
      angSum += (res(fs[i - 1].ang[0], fs[i].ang[0], fs[i + 1].ang[0]) + res(fs[i - 1].ang[1], fs[i].ang[1], fs[i + 1].ang[1])) / 2;
      let s = 0;
      for (let j = 0; j < fs[i].xy.length; j++) s += res(fs[i - 1].xy[j], fs[i].xy[j], fs[i + 1].xy[j]);
      xySum += s / fs[i].xy.length;
      n++;
    }
    if (n < this.minFrames - 2) return null;
    const span = fs[fs.length - 1].t - fs[0].t;
    return { deg: Math.sqrt(angSum / n), norm: Math.sqrt(xySum / n), fps: span > 0 ? ((fs.length - 1) * 1000) / span : 0, frames: fs.length };
  }
}
