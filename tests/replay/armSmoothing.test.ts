import { beforeAll, describe, expect, it } from 'vitest';
import { config } from '../../src/config';
import { pt } from '../../src/gestures/geometry';
import { ARM_NOISE_TARGET_DEG, armFilterFor, armFilterLabel, ArmNoiseMeter, type ArmNoise, type ArmSmoothingMode } from '../../src/pose/armSmoothing';
import { L } from '../../src/pose/landmarks';
import type { PoseFrame } from '../../src/pose/types';
import { commandLag, jumps, perFrame, type FrameRow } from './command';
import { fly, jolts } from './flight';
import { allRecordings, jitter, simulate, type Recording, type TF } from './harness';
import { latency, type Latency } from './latency';

/**
 * The arms' smoothing (`smoothing.arms`: fixed / off / auto) on the recordings of real play (black-box dumps),
 * through the real pipeline, for the discrete map and for continuous steering: the latency metric, flicker, jolts,
 * shots, descending; the lag of the commanded velocity behind the raw arms and the continuous command's jumps; the
 * arm angle itself against a non-causal fit (lag, error in motion, noise at rest); and the same with gaussian noise
 * added to the raw landmarks (a worse camera), `auto` measuring that noise on the still part of the noisy stream.
 * Prints the tables, pins the main results.
 *
 * The noise `auto` gets for a recording: its calibration's hold where it has one (`2026-11-09-gra` starts with a
 * calibration: the `calibration.holdMs` before it), else the stillest `holdMs` of the stream in play (the least
 * wrist travel, every frame with a person and both wrists confident). The dumps predate the measurement.
 */

const dumps = allRecordings().filter((r) => r.rec.level === 'black-box');
const short = (r: Recording) => r.name.replace('2026-11-09-', '');
const MODES: ArmSmoothingMode[] = ['fixed', 'off', 'auto'];
/** added noise, normalised image units (`jitter`), each with these seeds (flicker counts are small: one seed moves them by 2-3) */
const SIGMAS = [0, 0.001, 0.002, 0.005, 0.01];
const SEEDS = [1, 2, 3];

function withCfg<T>(mode: ArmSmoothingMode, continuous: boolean, fn: () => T): T {
  const was = { arms: config.smoothing.arms, continuous: config.pointing.continuous };
  config.smoothing.arms = mode;
  config.pointing.continuous = continuous;
  try {
    return fn();
  } finally {
    config.smoothing.arms = was.arms;
    config.pointing.continuous = was.continuous;
  }
}

/** [t0, t1) of the stretch the noise is measured on (see above) */
function stillWindow(rec: Recording): [number, number] {
  const hold = config.calibration.holdMs;
  const cal = rec.rec.calibrations?.[0];
  if (cal) return [cal.t - hold, cal.t];
  const st = (rec.rec.frames as { st?: string }[]).map((f) => f.st ?? 'playing');
  const fs = rec.frames;
  const ok = (i: number) => {
    const f = fs[i].f;
    return !!f && st[i] === 'playing' && f.lm[L.leftWrist].v >= 0.6 && f.lm[L.rightWrist].v >= 0.6;
  };
  const step = (i: number) => {
    const a = fs[i - 1].f!, b = fs[i].f!;
    let d = 0;
    for (const w of [L.leftWrist, L.rightWrist]) d += Math.hypot((b.lm[w].x - a.lm[w].x) * a.aspect, b.lm[w].y - a.lm[w].y);
    return d;
  };
  let best: [number, number] = [0, hold];
  let bestTravel = Infinity;
  for (let i = 0; i < fs.length; i++) {
    let travel = 0, j = i + 1, good = ok(i);
    for (; good && j < fs.length && fs[j].t < fs[i].t + hold; j++) {
      if (!ok(j)) good = false;
      else travel += step(j);
    }
    if (good && j < fs.length && travel < bestTravel) {
      bestTravel = travel;
      best = [fs[i].t, fs[i].t + hold];
    }
  }
  return best;
}

/** the meter fed the frames in `win`, as the calibration feeds it MediaPipe's raw landmarks */
function measure(frames: TF[], win: [number, number]): ArmNoise | null {
  const m = new ArmNoiseMeter();
  for (const { t, f } of frames) if (f && t >= win[0] && t < win[1]) m.add(f.lm, f.aspect, t);
  return m.result();
}

// ---------------------------------------------------------------------------------------------------------------
// the arm angle against a non-causal fit (the review's c_filters table)
// ---------------------------------------------------------------------------------------------------------------

const DEG = 180 / Math.PI;
const rawAngle = (f: PoseFrame, side: 'left' | 'right') => {
  const sh = pt(f, side === 'left' ? L.leftShoulder : L.rightShoulder);
  const wr = pt(f, side === 'left' ? L.leftWrist : L.rightWrist);
  return Math.atan2(-(wr.y - sh.y), -(wr.x - sh.x)) * DEG;
};
const unwrap = (a: number[]) => {
  const o = [a[0]];
  for (let i = 1; i < a.length; i++) o.push(o[i - 1] + ((((a[i] - a[i - 1]) % 360) + 540) % 360) - 180);
  return o;
};
/** local weighted quadratic fit over +-`w` ms: the value and the slope (deg/s) at each sample */
function reference(ts: number[], xs: number[], w = 120) {
  const val: number[] = [], vel: number[] = [];
  for (let i = 0; i < ts.length; i++) {
    const s = [0, 0, 0, 0, 0], y = [0, 0, 0];
    for (let j = i; j >= 0 && ts[i] - ts[j] <= w; j--) acc(j);
    for (let j = i + 1; j < ts.length && ts[j] - ts[i] <= w; j++) acc(j);
    function acc(j: number) {
      const d = (ts[j] - ts[i]) / 1000, k = 1 - (Math.abs(ts[j] - ts[i]) / (w + 1)) ** 2;
      for (let p = 0; p < 5; p++) s[p] += k * d ** p;
      for (let p = 0; p < 3; p++) y[p] += k * xs[j] * d ** p;
    }
    const A = [[s[0], s[1], s[2]], [s[1], s[2], s[3]], [s[2], s[3], s[4]]];
    const det = (m: number[][]) =>
      m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const D = det(A);
    if (Math.abs(D) < 1e-12) {
      val.push(xs[i]);
      vel.push(0);
      continue;
    }
    const rep = (c: number) => A.map((r, k) => r.map((v, m) => (m === c ? y[k] : v)));
    val.push(det(rep(0)) / D);
    vel.push(det(rep(1)) / D);
  }
  return { val, vel };
}
const interp = (ts: number[], xs: number[], t: number) => {
  if (t <= ts[0]) return xs[0];
  let lo = 0, hi = ts.length - 1;
  if (t >= ts[hi]) return xs[hi];
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (ts[m] <= t) lo = m;
    else hi = m;
  }
  return xs[lo] + ((xs[hi] - xs[lo]) * (t - ts[lo])) / (ts[hi] - ts[lo]);
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

interface AngleStats {
  /** ms: the shift of the fit that matches the pipeline's angle best while the arm moves faster than 100 deg/s */
  lag: number;
  /** RMS error against the fit while moving (> 100 deg/s), deg */
  moving: number;
  /** RMS of the frame-to-frame step minus the fit's, at rest (< 20 deg/s), deg */
  noise: number;
}

/** the pipeline's arm angles (`PointingOutput.left / right`, `rows` from `perFrame`) against the fit of the recording's raw angle */
function angleStats(rec: Recording, rows: FrameRow[]): AngleStats {
  const lags: number[] = [], movs: number[] = [], noises: number[] = [];
  for (const side of ['left', 'right'] as const) {
    // frames where the wrist is trusted, so the raw angle is the one the pipeline uses too (references: the clean recording)
    const ok = rows.filter((r) => rec.frames[r.i].f!.lm[side === 'left' ? L.leftWrist : L.rightWrist].v >= 0.6 && r.out[side] !== null);
    const ts = ok.map((r) => rec.frames[r.i].t);
    const raw = unwrap(ok.map((r) => rawAngle(rec.frames[r.i].f!, side)));
    const ref = reference(ts, raw);
    const o = ok.map((r, i) => r.out[side]! + Math.round((raw[i] - r.out[side]!) / 360) * 360);
    const moving = ts.map((_, i) => Math.abs(ref.vel[i]) > 100), still = ts.map((_, i) => Math.abs(ref.vel[i]) < 20);
    const cont = ts.map((t, i) => i > 2 && t - ts[i - 3] < 400);
    let best = { tau: 0, e: Infinity };
    for (let tau = -50; tau <= 300; tau += 5) {
      let e = 0, n = 0;
      for (let i = 0; i < ts.length; i++)
        if (moving[i] && cont[i]) {
          e += (o[i] - interp(ts, ref.val, ts[i] - tau)) ** 2;
          n++;
        }
      e = Math.sqrt(e / n);
      if (e < best.e) best = { tau, e };
    }
    lags.push(best.tau);
    movs.push(Math.sqrt(mean(o.flatMap((x, i) => (moving[i] && cont[i] ? [(x - ref.val[i]) ** 2] : [])))));
    noises.push(Math.sqrt(mean(o.flatMap((x, i) => (i && still[i] && still[i - 1] && cont[i] ? [(x - o[i - 1] - (ref.val[i] - ref.val[i - 1])) ** 2] : [])))));
  }
  return { lag: mean(lags), moving: mean(movs), noise: mean(noises) };
}

// ---------------------------------------------------------------------------------------------------------------

interface Run {
  lat: Latency;
  jolts: number;
  shots: number;
  descMs: number;
  /** the commanded velocity's lag behind the same map on the raw frames, ms */
  lag: number;
  /** continuous steering: the command's frame-to-frame jumps, px per step */
  jumps: number[];
  /** the arm angle (the same under both maps) */
  angle: AngleStats;
}

/** one configuration (`smoothing.arms`, the map: in `config`) on `frames`: the recording's own, or with noise added */
function run(rec: Recording, frames: TF[], armNoise: ArmNoise | null): Run {
  const continuous = config.pointing.continuous;
  const res = simulate(rec, frames, { startState: 'playing', armNoise });
  const ticks = res.ticks.filter((k) => k.state === 'playing');
  const rows = perFrame({ ...rec, frames }, armNoise);
  return {
    lat: latency(rec, { ticks }),
    jolts: jolts(fly(ticks)),
    shots: res.triggers.length,
    descMs: Math.round(ticks.filter((k) => k.mode === 'drift' && k.sink > 0).length * (1000 / 60)),
    lag: commandLag(rec, ticks, continuous),
    jumps: continuous ? jumps(rows) : [],
    angle: angleStats(rec, rows),
  };
}

type Map2 = 'discrete' | 'continuous';
const MAPS: Map2[] = ['discrete', 'continuous'];

interface RecResult {
  win: [number, number];
  /** the noise measured on the still stretch, per added sigma, per seed (sigma 0: the recording, one) */
  noise: Map<number, (ArmNoise | null)[]>;
  /** per added sigma (0: the recording), per map, per mode, per seed */
  runs: Map<number, Record<Map2, Record<ArmSmoothingMode, Run[]>>>;
}

const results = new Map<string, RecResult>();
const q = (xs: number[], p: number) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(p * (xs.length - 1))] : NaN);
const table = (head: string[], rows: (string | number)[][]) =>
  [head, ...rows].map((r) => r.map((x, i) => String(x).padStart(i === 0 ? 18 : Math.max(7, head[i].length))).join(' ')).join('\n');
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '-');
const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : '-');
const avg = (xs: number[]) => mean(xs.filter(Number.isFinite));
const sum = (rs: Run[], fn: (r: Run) => number) => rs.reduce((a, r) => a + fn(r), 0);
/** a run's numbers for `rec`, `sigma`, `map`, `mode` (all seeds) */
const runsOf = (rec: string, sigma: number, map: Map2, mode: ArmSmoothingMode) => results.get(rec)!.runs.get(sigma)![map][mode];
const clean = (rec: string, map: Map2, mode: ArmSmoothingMode) => runsOf(rec, 0, map, mode)[0];

beforeAll(() => {
  for (const rec of dumps) {
    const win = stillWindow(rec);
    const noise = new Map<number, (ArmNoise | null)[]>();
    const runs = new Map<number, Record<Map2, Record<ArmSmoothingMode, Run[]>>>();
    for (const s of SIGMAS) {
      const streams = s ? SEEDS.map((seed) => jitter(rec.frames, s, seed)) : [rec.frames];
      const ns = streams.map((f) => measure(f, win));
      noise.set(s, ns);
      const byMap = {} as Record<Map2, Record<ArmSmoothingMode, Run[]>>;
      for (const map of MAPS) {
        byMap[map] = {} as Record<ArmSmoothingMode, Run[]>;
        for (const m of MODES) byMap[map][m] = withCfg(m, map === 'continuous', () => streams.map((f, k) => run(rec, f, ns[k])));
      }
      runs.set(s, byMap);
    }
    results.set(rec.name, { win, noise, runs });
  }

  const R = dumps.map((r) => ({ name: short(r), key: r.name, res: results.get(r.name)! }));
  const lines: string[] = [];
  const filt = (n: ArmNoise | null) => armFilterLabel(armFilterFor('auto', n, false));
  lines.push(`== noise measured on the still stretch (ArmNoiseMeter): arm angle deg / coordinates (1e-3 of the image) -> auto (added noise: mean over seeds ${SEEDS.join(', ')}; auto per seed)`);
  lines.push(table(['recording', 'window ms', 'fps', ...SIGMAS.flatMap((s) => [`+${s} deg`, 'norm', 'auto'])], R.map(({ name, res }) => [
    name, `${Math.round(res.win[0])}..${Math.round(res.win[1])}`, f1(res.noise.get(0)![0]?.fps ?? NaN),
    ...SIGMAS.flatMap((s) => {
      const ns = res.noise.get(s)!;
      return [f2(avg(ns.map((n) => n?.deg ?? NaN))), f2(avg(ns.map((n) => n?.norm ?? NaN)) * 1000), ns.map(filt).join(' / ')];
    }),
  ])));
  for (const map of MAPS) {
    const cont = map === 'continuous';
    lines.push(`== ${map} map, the recordings as they are: latency changes / followed, p50 / p90 / mean ms, switches/min, flicker, jolts, shots, descending ms, command lag ms${cont ? ', jumps p50 / p95 / p99 px/step' : ''}`);
    lines.push(table(['recording', 'mode', 'chg', 'fol', 'p50', 'p90', 'mean', 'sw/min', 'flick', 'jolts', 'shots', 'desc', 'lag', ...(cont ? ['j50', 'j95', 'j99'] : [])],
      R.flatMap(({ name, key }) => MODES.map((m) => {
        const r = clean(key, map, m);
        return [name, m, r.lat.changes, r.lat.followed, r.lat.p50, r.lat.p90, r.lat.mean, r.lat.switchesPerMin, r.lat.flicker, r.jolts, r.shots, r.descMs, Math.round(r.lag),
          ...(cont ? [f2(q(r.jumps, 0.5)), f2(q(r.jumps, 0.95)), f2(q(r.jumps, 0.99))] : [])];
      }))));
  }
  lines.push('== arm angle against a non-causal quadratic fit of the raw angle (+-120 ms): lag ms, RMS error moving (> 100 deg/s) deg, noise at rest (RMS step) deg');
  lines.push(table(['recording', ...MODES.flatMap((m) => [`${m} lag`, 'moving', 'rest'])], R.map(({ name, key }) => [name, ...MODES.flatMap((m) => {
    const a = clean(key, 'discrete', m).angle;
    return [Math.round(a.lag), f1(a.moving), f2(a.noise)];
  })])));
  lines.push(`== added noise, discrete map, seeds ${SEEDS.join(', ')}: flicker (sum), mean delay ms (mean), p50 (mean), followed / changes (sum), jolts (sum), shots (sum)`);
  lines.push(table(['recording', 'sigma', 'deg', ...MODES.flatMap((m) => [`${m} fl`, 'mean', 'p50', 'fol', 'jolt', 'shot'])], R.flatMap(({ name, key, res }) => SIGMAS.slice(1).map((s) => [
    name, s, f2(avg(res.noise.get(s)!.map((n) => n?.deg ?? NaN))),
    ...MODES.flatMap((m) => {
      const rs = runsOf(key, s, 'discrete', m);
      return [sum(rs, (r) => r.lat.flicker), Math.round(avg(rs.map((r) => r.lat.mean))), Math.round(avg(rs.map((r) => r.lat.p50))), `${sum(rs, (r) => r.lat.followed)}/${sum(rs, (r) => r.lat.changes)}`, sum(rs, (r) => r.jolts), sum(rs, (r) => r.shots)];
    }),
  ]))));
  lines.push('== added noise, continuous map: flicker (sum), mean delay ms (mean), jumps p95 / p99 px/step (all seeds), jolts (sum)');
  lines.push(table(['recording', 'sigma', ...MODES.flatMap((m) => [`${m} fl`, 'mean', 'j95', 'j99', 'jolt'])], R.flatMap(({ name, key }) => SIGMAS.slice(1).map((s) => [
    name, s,
    ...MODES.flatMap((m) => {
      const rs = runsOf(key, s, 'continuous', m);
      const js = rs.flatMap((r) => r.jumps);
      return [sum(rs, (r) => r.lat.flicker), Math.round(avg(rs.map((r) => r.lat.mean))), f2(q(js, 0.95)), f2(q(js, 0.99)), sum(rs, (r) => r.jolts)];
    }),
  ]))));
  lines.push('== added noise: the arm angle, lag ms / error moving deg / noise at rest deg (mean over seeds)');
  lines.push(table(['recording', 'sigma', ...MODES.flatMap((m) => [`${m} lag`, 'moving', 'rest'])], R.flatMap(({ name, key }) => SIGMAS.slice(1).map((s) => [name, s, ...MODES.flatMap((m) => {
    const as = runsOf(key, s, 'discrete', m).map((r) => r.angle);
    return [Math.round(avg(as.map((a) => a.lag))), f1(avg(as.map((a) => a.moving))), f2(avg(as.map((a) => a.noise)))];
  })]))));
  console.log(`\narm smoothing (smoothing.arms) on the recordings of play\n${lines.join('\n')}\n`);
}, 300_000);

describe('arm smoothing variants on the recordings of play', () => {
  const names = dumps.map((r) => r.name);
  const NOISY = SIGMAS.slice(1);

  it('there are recordings of play', () => {
    expect(dumps.length).toBeGreaterThanOrEqual(3);
  });

  it('the arms of the recordings are quieter than the target: auto is off on them (and so the same as off)', () => {
    for (const n of names) {
      const noise = results.get(n)!.noise.get(0)![0]!;
      expect(noise.deg, n).toBeLessThan(ARM_NOISE_TARGET_DEG);
      expect(armFilterFor('auto', noise, false), n).toEqual({ kind: 'off' });
      for (const map of MAPS) expect(clean(n, map, 'auto').lat, n).toEqual(clean(n, map, 'off').lat);
    }
  });

  it('the meter sees the added noise: about the arm angle the coordinates make, auto filtering from 0.005 of the image', () => {
    for (const n of names) {
      const at = (s: number) => avg(results.get(n)!.noise.get(s)!.map((x) => x!.deg));
      // twice the noise, twice the measure (on top of the recording's own)
      expect(at(0.01) / at(0.005), n).toBeGreaterThan(1.8);
      expect(at(0.01) / at(0.005), n).toBeLessThan(2.2);
      for (const x of results.get(n)!.noise.get(0.01)!) expect(armFilterFor('auto', x, false).kind, n).toBe('lowpass');
      for (const x of results.get(n)!.noise.get(0.001)!) expect(armFilterFor('auto', x, false).kind, n).toBe('off');
    }
  });

  it('without the chain the bird follows sooner (discrete map: mean delay 160 / 95 / 122 -> 130 / 63 / 89 ms)', () => {
    for (const n of names) {
      const f = clean(n, 'discrete', 'fixed'), o = clean(n, 'discrete', 'off');
      expect(o.lat.mean, n).toBeLessThan(f.lat.mean - 20);
      expect(o.lat.p50, n).toBeLessThan(f.lat.p50 - 25);
      expect(o.lat.followed, n).toBeGreaterThanOrEqual(f.lat.followed);
      expect(o.lag, n).toBeLessThan(f.lag);
      // continuous steering: the command's lag behind the raw arms, and its jumps stay small
      const fc = clean(n, 'continuous', 'fixed'), oc = clean(n, 'continuous', 'off');
      expect(oc.lag, n).toBeLessThan(fc.lag);
      expect(q(oc.jumps, 0.99), n).toBeLessThan(3.5);
    }
  });

  it('...at the cost of a little more flicker (5 / 1 / 5 -> 6 / 1 / 6); no jolts, the same shots', () => {
    for (const n of names) {
      const f = clean(n, 'discrete', 'fixed'), o = clean(n, 'discrete', 'off');
      expect(o.lat.flicker, n).toBeLessThanOrEqual(f.lat.flicker + 1);
      for (const map of MAPS)
        for (const m of MODES) {
          expect(clean(n, map, m).jolts, `${n} ${map} ${m}`).toBe(0);
          expect(clean(n, map, m).shots, `${n} ${map} ${m}`).toBe(clean(n, map, 'fixed').shots);
        }
    }
  });

  it("the arm angle: the chain lags 30-35 ms and adds error in motion, without lowering MediaPipe's noise at rest", () => {
    for (const n of names) {
      const f = clean(n, 'discrete', 'fixed').angle, o = clean(n, 'discrete', 'off').angle;
      expect(f.lag, n).toBeGreaterThanOrEqual(25);
      expect(f.lag, n).toBeLessThanOrEqual(40);
      expect(Math.abs(o.lag), n).toBeLessThanOrEqual(5);
      expect(f.moving, n).toBeGreaterThan(2.5 * o.moving);
      expect(o.noise, n).toBeLessThan(0.45);
      expect(Math.abs(o.noise - f.noise), n).toBeLessThan(0.1);
    }
  });

  it('added noise: the arms\' filter does not touch the shoot gesture (the same shots in every mode), no jolts', () => {
    for (const n of names)
      for (const s of NOISY)
        for (const map of MAPS)
          for (const m of MODES) {
            const rs = runsOf(n, s, map, m), ref = runsOf(n, s, map, 'fixed');
            expect(rs.map((r) => r.shots), `${n} ${s} ${map} ${m}`).toEqual(ref.map((r) => r.shots));
            expect(sum(rs, (r) => r.jolts), `${n} ${s} ${map} ${m}`).toBe(0);
          }
  });

  it('added noise, discrete map: off and auto stay faster than fixed at every level; flicker barely rises with the noise', () => {
    for (const n of names)
      for (const s of NOISY) {
        const meanOf = (m: ArmSmoothingMode) => avg(runsOf(n, s, 'discrete', m).map((r) => r.lat.mean));
        const fl = (m: ArmSmoothingMode) => sum(runsOf(n, s, 'discrete', m), (r) => r.lat.flicker);
        expect(meanOf('off'), `${n} ${s}`).toBeLessThan(meanOf('fixed') - 15);
        expect(meanOf('auto'), `${n} ${s}`).toBeLessThan(meanOf('fixed') - 10);
        // the flicker off / auto add is that of the clean stream (the lag no longer hides the sweep between poses), not the noise's
        expect(fl('off'), `${n} ${s}`).toBeLessThanOrEqual(fl('fixed') + 3 * SEEDS.length);
        expect(fl('auto'), `${n} ${s}`).toBeLessThanOrEqual(fl('fixed') + 3 * SEEDS.length);
      }
  });

  it('added noise: auto brings the arm angle at rest back to about the target, at half the lag of fixed', () => {
    for (const n of names) {
      const a = runsOf(n, 0.01, 'discrete', 'auto').map((r) => r.angle), o = runsOf(n, 0.01, 'discrete', 'off').map((r) => r.angle);
      const f = runsOf(n, 0.01, 'discrete', 'fixed').map((r) => r.angle);
      expect(avg(a.map((x) => x.noise)), n).toBeLessThan(1.5 * ARM_NOISE_TARGET_DEG);
      expect(avg(a.map((x) => x.noise)), n).toBeLessThan(avg(o.map((x) => x.noise)) / 2);
      expect(avg(a.map((x) => x.lag)), n).toBeLessThan(avg(f.map((x) => x.lag)) * 0.7);
    }
  });

  it('added noise, continuous map: off flickers ever more, auto holds near fixed and stays faster', () => {
    for (const n of names) {
      const fl = (m: ArmSmoothingMode) => sum(runsOf(n, 0.01, 'continuous', m), (r) => r.lat.flicker);
      const meanOf = (m: ArmSmoothingMode) => avg(runsOf(n, 0.01, 'continuous', m).map((r) => r.lat.mean));
      expect(fl('off'), n).toBeGreaterThan(fl('fixed') * 1.4);
      expect(fl('auto'), n).toBeLessThanOrEqual(fl('fixed') * 1.25);
      expect(meanOf('auto'), n).toBeLessThan(meanOf('fixed'));
    }
  });

  it('the default stays fixed: off (and auto, the same on these recordings) flicker more than fixed on the recordings', () => {
    // the rule for a new default: on each recording, discrete map, flicker no higher than fixed's, 0 jolts, the same
    // shots, and with added noise flicker no higher than fixed's at every level
    const passes = (m: ArmSmoothingMode) =>
      names.every((n) => {
        const r = clean(n, 'discrete', m), f = clean(n, 'discrete', 'fixed');
        const noisyOk = NOISY.every((s) => sum(runsOf(n, s, 'discrete', m), (x) => x.lat.flicker) <= sum(runsOf(n, s, 'discrete', 'fixed'), (x) => x.lat.flicker));
        return r.lat.flicker <= f.lat.flicker && r.jolts === 0 && r.shots === f.shots && noisyOk;
      });
    expect(passes('off')).toBe(false);
    expect(passes('auto')).toBe(false);
  });
});

describe('flapping control is untouched by the switch', () => {
  it('the same controls frame by frame on a recording of play, whatever smoothing.arms says', () => {
    const was = { flapping: config.pointing.flapping, arms: config.smoothing.arms };
    config.pointing.flapping = true;
    try {
      const rec = dumps[0];
      const noisy: ArmNoise = { deg: 3, norm: 0.01, fps: 28, frames: 34 };
      const controls = (mode: ArmSmoothingMode) => {
        config.smoothing.arms = mode;
        const out: string[] = [];
        simulate(rec, rec.frames, { startState: 'playing', armNoise: noisy, onFrame: (_f, st, c) => out.push(JSON.stringify([st, c])) });
        return out;
      };
      const fixed = controls('fixed');
      expect(fixed.length).toBeGreaterThan(1000);
      expect(controls('off')).toEqual(fixed);
      expect(controls('auto')).toEqual(fixed);
    } finally {
      Object.assign(config.pointing, { flapping: was.flapping });
      config.smoothing.arms = was.arms;
    }
  });
});
