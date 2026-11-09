import {
  cleanRun, hitch, jitter, lowVisibility, lowWristHanging, measure, nullGap, shift, simulate, wristHallucination,
  type Metrics, type Recording, type TF,
} from './harness';

/**
 * A perturbation of a recording, applied at `t0` (ms), lasting `ms`.
 * `build` returns the frames the tracker would deliver; the rest of the clip is untouched.
 */
export interface Scenario {
  name: string;
  /** how long the perturbation lasts (ms; 0 for one lasting the whole clip) */
  ms: number;
  build: (frames: TF[], t0: number) => TF[];
}

/** landmark indices: both wrists, elbows */
export const LEFT_ARM = [13, 15];
export const RIGHT_ARM = [14, 16];

export const nullGapScenario = (ms: number): Scenario => ({ name: `null gap ${ms} ms`, ms, build: (f, t0) => nullGap(f, t0, ms) });
export const hitchScenario = (ms: number): Scenario => ({ name: `hitch ${ms} ms`, ms, build: (f, t0) => hitch(f, t0, ms) });

/** the scenarios of the metrics table (and of the tests that pin the behaviour) */
export const SCENARIOS: Scenario[] = [
  nullGapScenario(34),
  nullGapScenario(100),
  nullGapScenario(340),
  nullGapScenario(510),
  nullGapScenario(680),
  nullGapScenario(1020),
  nullGapScenario(1500),
  nullGapScenario(2000),
  nullGapScenario(3500),
  hitchScenario(340),
  hitchScenario(680),
  hitchScenario(1500),
  { name: 'left arm low visibility 600 ms', ms: 600, build: (f, t0) => lowVisibility(f, t0, 600, LEFT_ARM, 0.1) },
  { name: 'both arms low visibility 600 ms', ms: 600, build: (f, t0) => lowVisibility(f, t0, 600, [...LEFT_ARM, ...RIGHT_ARM], 0.1) },
  { name: 'left wrist hallucination 300 ms', ms: 300, build: (f, t0) => wristHallucination(f, t0, 300, 'left') },
  { name: 'left wrist hanging v=0.15 340 ms', ms: 340, build: (f, t0) => lowWristHanging(f, t0, 340, 'left') },
  { name: 'left wrist hanging v=0.15 1000 ms', ms: 1000, build: (f, t0) => lowWristHanging(f, t0, 1000, 'left') },
  { name: 'both wrists hanging v=0.15 1000 ms', ms: 1000, build: (f, t0) => lowWristHanging(lowWristHanging(f, t0, 1000, 'left'), t0, 1000, 'right') },
  { name: 'jitter sigma 0.008', ms: 0, build: (f) => jitter(f, 0.008) },
  { name: 'jitter sigma 0.03', ms: 0, build: (f) => jitter(f, 0.03) },
  { name: 'off-centre 0.15', ms: 0, build: (f) => shift(f, 0.15) },
  { name: 'off-centre 0.3', ms: 0, build: (f) => shift(f, 0.3) },
  { name: 'off-centre 0.35 for 2000 ms', ms: 2000, build: (f, t0) => shift(f, 0.35, 0, t0, 2000) },
];

/** where in the clip the perturbations are inserted (ms): spread over it, from the warm-up to a few seconds before its end */
export function insertionPoints(from: number, to: number, n = 4): number[] {
  return Array.from({ length: n }, (_, i) => Math.round(from + ((to - 8000 - from) * (i + 0.5)) / n));
}

export interface ScenarioResult {
  scenario: string;
  /** one entry per insertion point */
  runs: Metrics[];
  /** the mean of each metric over the insertion points (recoveryMs: of those that recovered) */
  mean: Metrics;
}

/** a metric by name, as a number (recoveryMs: null counts as not recovered) */
const num = (m: Metrics, k: keyof Metrics) => m[k] ?? NaN;

export function runScenario(rec: Recording, sc: Scenario, clean = cleanRun(rec)): ScenarioResult {
  const { run: ref, from, to } = clean;
  const points = insertionPoints(from, to);
  // a perturbation of the whole clip is run once, and measured from the warm-up on
  const spots = sc.ms === 0 ? [from] : points;
  const runs = spots.map((t0) => {
    const frames = sc.build(rec.frames, t0);
    return measure(simulate(rec, frames), ref, from, to, sc.ms === 0 ? to : t0 + sc.ms);
  });
  const keys = Object.keys(runs[0]) as (keyof Metrics)[];
  const mean = {} as Metrics;
  for (const k of keys) {
    const v = runs.map((r) => num(r, k)).filter((x) => Number.isFinite(x));
    (mean as unknown as Record<string, number | null>)[k] = v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
  }
  return { scenario: sc.name, runs, mean };
}
