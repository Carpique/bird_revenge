import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { afterEach, describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { Calibration } from '../src/gestures/Calibration';
import { PointingDetector } from '../src/gestures/PointingDetector';
import type { VisibilityOutput } from '../src/gestures/VisibilityMonitor';
import {
  ARM_NOISE_TARGET_DEG,
  armFilterFor,
  ArmNoiseMeter,
  AUTO_MIN_CUTOFF_HZ,
  cutoffFor,
  noiseGain,
  type ArmNoise,
} from '../src/pose/armSmoothing';
import { L } from '../src/pose/landmarks';
import { OneEuroFilter } from '../src/pose/OneEuroFilter';
import { PoseSmoother } from '../src/pose/PoseSmoother';
import type { PoseFrame } from '../src/pose/types';
import { rng } from './replay/harness';
import { synthPose } from './synthetic';

const ASPECT = 16 / 9;
const saved = { arms: config.smoothing.arms, flapping: config.pointing.flapping };
afterEach(() => {
  config.smoothing.arms = saved.arms;
  config.pointing.flapping = saved.flapping;
});

/** the calibration's X pose, MediaPipe's shape, with gaussian noise of `sigma` and a sideways sway of the whole body */
function stream(n: number, sigma: number, opts: { seed?: number; fps?: number; swayAmp?: number; swayPeriodMs?: number } = {}) {
  const g = rng(opts.seed ?? 1).g;
  const dt = 1000 / (opts.fps ?? 30);
  const base = synthPose({ t: 0, armLeft: 135, armRight: 135 });
  return Array.from({ length: n }, (_, k) => {
    const t = k * dt;
    const sway = (opts.swayAmp ?? 0) * Math.sin((2 * Math.PI * t) / (opts.swayPeriodMs ?? 2000));
    return { t, lm: base.lm.map((p) => ({ x: p.x + sway + sigma * g(), y: p.y + sigma * g(), z: 0, visibility: p.v })) };
  });
}

/** the arm angle noise (deg) that coordinate noise `sigma` makes on the synthetic pose: per arm, both ends, perpendicular */
function expectedDeg(sigma: number) {
  const f = synthPose({ t: 0, armLeft: 135, armRight: 135 });
  const sh = f.lm[L.leftShoulder], wr = f.lm[L.leftWrist];
  const dx = (wr.x - sh.x) * ASPECT, dy = wr.y - sh.y;
  const len = Math.hypot(dx, dy);
  // the perpendicular component of (sigma * aspect, sigma) noise at both ends
  const ux = -dy / len, uy = dx / len;
  const perp = Math.sqrt(2 * ((ux * ASPECT * sigma) ** 2 + (uy * sigma) ** 2));
  return (perp / len) * (180 / Math.PI);
}

const meterOf = (frames: ReturnType<typeof stream>) => {
  const m = new ArmNoiseMeter();
  for (const f of frames) m.add(f.lm, ASPECT, f.t);
  return m;
};

describe('ArmNoiseMeter', () => {
  it('gives the sigma of white noise on a still pose, in normalised units and in degrees of arm angle', () => {
    for (const sigma of [0.001, 0.003, 0.01]) {
      const devs: number[] = [], degs: number[] = [];
      for (let seed = 1; seed <= 20; seed++) {
        const r = meterOf(stream(36, sigma, { seed })).result()!;
        devs.push(r.norm / sigma);
        degs.push(r.deg / expectedDeg(sigma));
      }
      const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
      // over 20 holds of 1.2 s: unbiased within 5 %, a single hold within 30 %
      expect(mean(devs)).toBeGreaterThan(0.95);
      expect(mean(devs)).toBeLessThan(1.05);
      expect(mean(degs)).toBeGreaterThan(0.95);
      expect(mean(degs)).toBeLessThan(1.05);
      for (const d of [...devs, ...degs]) expect(Math.abs(d - 1)).toBeLessThan(0.3);
    }
  });

  it('a slow sway does not inflate it (the plain spread of the positions would)', () => {
    const still = meterOf(stream(36, 0.002, { seed: 3 })).result()!;
    const swaying = meterOf(stream(36, 0.002, { seed: 3, swayAmp: 0.02, swayPeriodMs: 2000 })).result()!;
    expect(swaying.norm / still.norm).toBeLessThan(1.05);
    expect(swaying.deg / still.deg).toBeLessThan(1.05);
    // for scale: the sway's own spread is 7x the noise
    expect(0.02 / Math.SQRT2 / 0.002).toBeGreaterThan(7);
  });

  it('uneven frame times (dropped frames) are weighted: still the sigma', () => {
    const frames = stream(60, 0.004, { seed: 5 }).filter((_, k) => k % 5 !== 2 && k % 7 !== 3);
    const r = meterOf(frames).result()!;
    expect(r.norm / 0.004).toBeGreaterThan(0.75);
    expect(r.norm / 0.004).toBeLessThan(1.25);
    expect(r.fps).toBeLessThan(30);
  });

  it('too few frames: not measured; reset forgets', () => {
    const m = meterOf(stream(14, 0.002));
    expect(m.result()).toBeNull();
    m.add(stream(15, 0.002)[14].lm, ASPECT, 14 * (1000 / 30));
    expect(m.result()).not.toBeNull();
    m.reset();
    expect(m.count).toBe(0);
    expect(m.result()).toBeNull();
  });

  it('a stretch of dropped frames is left out, not read as noise', () => {
    // two halves 400 ms apart, the body moved in between
    const a = stream(18, 0.002, { seed: 2 });
    const b = stream(18, 0.002, { seed: 4 }).map((f) => ({ t: f.t + 1000, lm: f.lm.map((p) => ({ ...p, x: p.x + 0.05 })) }));
    const r = meterOf([...a, ...b]).result()!;
    expect(r.norm / 0.002).toBeLessThan(1.3);
  });
});

describe('the rule: noise -> cutoff -> residual', () => {
  it('at or below the target: no filter', () => {
    expect(cutoffFor(0.3, 30)).toBeNull();
    expect(cutoffFor(ARM_NOISE_TARGET_DEG, 30)).toBeNull();
    // just above it the cutoff would be past half the frame rate: no filter either
    expect(cutoffFor(ARM_NOISE_TARGET_DEG * 1.05, 30)).toBeNull();
  });

  it('above it: the cutoff whose predicted residual is the target, lower for more noise, never below the minimum', () => {
    let prev = Infinity;
    for (const deg of [1.5, 2, 2.5, 3]) {
      const c = cutoffFor(deg, 30)!;
      expect(c).toBeLessThan(prev);
      prev = c;
      expect(deg * noiseGain(c, 30)).toBeCloseTo(ARM_NOISE_TARGET_DEG, 6);
    }
    expect(cutoffFor(10, 30)).toBe(AUTO_MIN_CUTOFF_HZ);
    // the same noise at a lower frame rate needs a lower cutoff
    expect(cutoffFor(2, 20)!).toBeLessThan(cutoffFor(2, 30)!);
  });

  it('the predicted residual is what a first-order low-pass leaves of white noise', () => {
    const g = rng(9).g;
    for (const deg of [1.6, 2.4]) {
      const c = cutoffFor(deg, 30)!;
      const f = new OneEuroFilter(c, 0, 1);
      let sum = 0, n = 0;
      for (let k = 0; k < 20000; k++) {
        const y = f.filter(deg * g(), k / 30);
        if (k > 100) {
          sum += y * y;
          n++;
        }
      }
      const residual = Math.sqrt(sum / n);
      expect(residual / ARM_NOISE_TARGET_DEG).toBeGreaterThan(0.95);
      expect(residual / ARM_NOISE_TARGET_DEG).toBeLessThan(1.05);
    }
  });
});

const noise = (deg: number): ArmNoise => ({ deg, norm: deg / 300, fps: 30, frames: 36 });

describe('armFilterFor', () => {
  it('fixed and off as named; auto from the measured noise, fixed without one; flapping always fixed', () => {
    expect(armFilterFor('fixed', noise(3), false)).toEqual({ kind: 'fixed' });
    expect(armFilterFor('off', null, false)).toEqual({ kind: 'off' });
    expect(armFilterFor('auto', null, false)).toEqual({ kind: 'fixed' });
    expect(armFilterFor('auto', noise(0.3), false)).toEqual({ kind: 'off' });
    expect(armFilterFor('auto', noise(2), false)).toEqual({ kind: 'lowpass', cutoff: cutoffFor(2, 30) });
    expect(armFilterFor('off', noise(2), true)).toEqual({ kind: 'fixed' });
    expect(armFilterFor('auto', noise(2), true)).toEqual({ kind: 'fixed' });
    expect(armFilterFor('bogus' as 'off', null, false)).toEqual({ kind: 'fixed' });
  });
});

// ---------------------------------------------------------------------------------------------------------------

/** a moving, noisy stream through a smoother in `mode` (with `armNoise`) */
function smoothed(mode: 'fixed' | 'off' | 'auto', armNoise: ArmNoise | null = null, flapping = false) {
  config.smoothing.arms = mode;
  config.pointing.flapping = flapping;
  const sm = new PoseSmoother();
  sm.armNoise = armNoise;
  const g = rng(11).g;
  const raws: NormalizedLandmark[][] = [];
  const outs = Array.from({ length: 60 }, (_, k) => {
    const t = k * 33;
    const raw = synthPose({ t, armLeft: 90 + 60 * Math.sin(k / 6), armRight: 90, legLeft: 10 * Math.sin(k / 9) }).lm.map((p) => ({
      x: p.x + 0.003 * g(),
      y: p.y + 0.003 * g(),
      z: 0,
      visibility: p.v,
    }));
    raws.push(raw);
    return sm.process(raw, ASPECT, t)!;
  });
  return { outs, raws, sm };
}

/** today's smoother, written out: a One-Euro per coordinate, `armBeta` for 13..22 */
function reference(raws: NormalizedLandmark[][]) {
  const s = config.smoothing;
  const fs = Array.from({ length: 66 }, (_, j) => new OneEuroFilter(s.minCutoff, Math.floor(j / 2) >= 13 && Math.floor(j / 2) <= 22 ? s.armBeta : s.beta, s.dCutoff));
  return raws.map((raw, k) => raw.map((p, i) => ({ x: fs[i * 2].filter(p.x, (k * 33) / 1000), y: fs[i * 2 + 1].filter(p.y, (k * 33) / 1000) })));
}

const ARMS = Array.from({ length: 10 }, (_, k) => 13 + k);
const BODY = [L.leftShoulder, L.rightShoulder, L.leftHip, L.rightHip, L.leftKnee, L.rightKnee];

describe('PoseSmoother per variant', () => {
  it('fixed is today: bit for bit', () => {
    const { outs, raws, sm } = smoothed('fixed', noise(3));
    const ref = reference(raws);
    outs.forEach((lm, k) => lm.forEach((p, i) => expect([p.x, p.y]).toEqual([ref[k][i].x, ref[k][i].y])));
    expect(sm.armFilter).toEqual({ kind: 'fixed' });
  });

  it('off: the arms (13..22) as MediaPipe gave them; the shoulders, hips and knees filtered as in fixed', () => {
    const fixed = smoothed('fixed').outs;
    const { outs, raws, sm } = smoothed('off');
    expect(sm.armFilter).toEqual({ kind: 'off' });
    outs.forEach((lm, k) => {
      for (const i of ARMS) expect([lm[i].x, lm[i].y]).toEqual([raws[k][i].x, raws[k][i].y]);
      for (const i of BODY) expect([lm[i].x, lm[i].y]).toEqual([fixed[k][i].x, fixed[k][i].y]);
    });
  });

  it('auto without a measurement is fixed; with noise under the target it is off', () => {
    const fixed = smoothed('fixed').outs;
    expect(smoothed('auto').outs).toEqual(fixed);
    const off = smoothed('off').outs;
    expect(smoothed('auto', noise(0.3)).outs).toEqual(off);
  });

  it('auto with noise: the arms at the chosen cutoff (the still arm steadier than off), the shoulders no less, the hips and knees as in fixed', () => {
    const fixed = smoothed('fixed').outs;
    const off = smoothed('off');
    const { outs, sm } = smoothed('auto', noise(2.5));
    expect(sm.armFilter).toEqual({ kind: 'lowpass', cutoff: cutoffFor(2.5, 30) });
    expect(cutoffFor(2.5, 30)!).toBeLessThan(config.smoothing.minCutoff);
    const rough = (xs: { x: number }[][], i: number) => xs.slice(1).reduce((a, lm, k) => a + Math.abs(lm[i].x - xs[k][i].x), 0);
    expect(rough(outs, L.rightWrist)).toBeLessThan(rough(off.outs, L.rightWrist) * 0.6);
    expect(rough(outs, L.leftShoulder)).toBeLessThan(rough(fixed, L.leftShoulder));
    outs.forEach((lm, k) => {
      for (const i of [L.leftHip, L.rightHip, L.leftKnee, L.rightKnee]) expect([lm[i].x, lm[i].y]).toEqual([fixed[k][i].x, fixed[k][i].y]);
    });
  });

  it('flapping control: the same landmarks whatever the switch says', () => {
    const fixed = smoothed('fixed', null, true).outs;
    expect(smoothed('off', null, true).outs).toEqual(fixed);
    expect(smoothed('auto', noise(3), true).outs).toEqual(fixed);
  });
});

describe('PointingDetector: the EMA of the arm directions belongs to the fixed chain', () => {
  /** the left arm swept from level to up in a few frames: the detector's left angle per frame */
  const sweep = (mode: 'fixed' | 'off' | 'auto', armNoise: ArmNoise | null = null, flapping = false) => {
    config.smoothing.arms = mode;
    config.pointing.flapping = flapping;
    const d = new PointingDetector();
    d.armNoise = armNoise;
    return [90, 90, 120, 150, 170, 170].map((a, k) => d.update(synthPose({ t: k * 33, armLeft: a, armRight: 90 }) as PoseFrame, true, true).left!);
  };
  it('off and a measured auto follow the frame; fixed and an unmeasured auto lag it', () => {
    const fixed = sweep('fixed'), off = sweep('off');
    // the synthetic arm's screen angle: elevation 90 -> pointing straight out (180 on the mirrored screen), 170 -> nearly up
    const raw = (a: number) => synthAngle(a);
    expect(off[3]).toBeCloseTo(raw(150), 6);
    expect(Math.abs(fixed[3] - raw(150))).toBeGreaterThan(5);
    expect(sweep('auto')).toEqual(fixed);
    expect(sweep('auto', noise(2))).toEqual(off);
    expect(sweep('auto', noise(0.3))).toEqual(off);
  });
  it('flapping control keeps the EMA whatever the switch says', () => {
    const fixed = sweep('fixed', null, true);
    expect(sweep('off', null, true)).toEqual(fixed);
  });
});

/** the left arm's direction angle on the mirrored screen for a synthetic elevation, unsmoothed */
function synthAngle(elev: number) {
  config.smoothing.arms = 'off';
  const d = new PointingDetector();
  return d.update(synthPose({ t: 0, armLeft: elev, armRight: 90 }) as PoseFrame, true, true).left!;
}

describe('Calibration measures the arms noise during its hold', () => {
  const vis = { inFrame: true, hint: null } as unknown as VisibilityOutput;
  it('fed the raw landmarks: done with the noise; without them: done, not measured', () => {
    for (const withRaw of [true, false]) {
      const c = new Calibration();
      const frames = stream(60, 0.003, { seed: 8 });
      let done = null;
      for (const f of frames) {
        const pf: PoseFrame = { t: f.t, aspect: ASPECT, lm: synthPose({ t: f.t, armLeft: 135, armRight: 135 }).lm };
        const st = c.update(pf, vis, withRaw ? f.lm : null);
        if (st.done) {
          done = st;
          break;
        }
      }
      expect(done).not.toBeNull();
      if (withRaw) {
        expect(done!.armNoise!.norm / 0.003).toBeGreaterThan(0.7);
        expect(done!.armNoise!.norm / 0.003).toBeLessThan(1.3);
        expect(done!.armNoise!.frames).toBeGreaterThanOrEqual(36);
      } else expect(done!.armNoise).toBeNull();
    }
  });
});
