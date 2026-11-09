import { expect, it } from 'vitest';
import { allRecordings, cleanRun, type Metrics } from './harness';
import { runScenario, SCENARIOS } from './scenarios';

/**
 * Prints the replay metrics, per recording and perturbation, as a table (run with `npx vitest run
 * tests/replay/metrics.test.ts`), to compare before / after a change in tracking. Each value is the mean over the
 * insertion points of the perturbation in the clip. `VITE_REPLAY_JSON=1` also prints them as JSON (one line after the table), for diffing.
 *
 *   recal    times the big calibration dialog came up
 *   oof ms   soft pause (outOfFrame)
 *   calib ms game paused behind the calibration dialog / countdown
 *   stale ms playing, but the pose too old to apply: the bird has no controls and falls
 *   wrong ms playing with controls different from the clean run's
 *   recov ms from the end of the perturbation until the game agrees with the clean run again (- : whole-clip ones)
 *   shoot    poo triggers in the clip
 *   redet    times the tracker was told to look for the player afresh
 */
const COLUMNS: [keyof Metrics, string][] = [
  ['recalibrations', 'recal'],
  ['outOfFrameMs', 'oof ms'],
  ['calibratingMs', 'calib ms'],
  ['staleMs', 'stale ms'],
  ['wrongMs', 'wrong ms'],
  ['recoveryMs', 'recov ms'],
  ['triggers', 'shoot'],
  ['redetects', 'redet'],
];

it('prints the metrics of every perturbation', () => {
  const all: Record<string, Record<string, Metrics>> = {};
  const lines: string[] = [];
  for (const rec of allRecordings()) {
    const clean = cleanRun(rec);
    const pad = (s: string, n: number) => s.padStart(n);
    lines.push(`\n== ${rec.name}: clip ${(clean.from / 1000).toFixed(1)}..${(clean.to / 1000).toFixed(1)} s, mean over the insertion points`);
    lines.push(['scenario'.padEnd(34), ...COLUMNS.map(([, h]) => pad(h, 9))].join(' '));
    all[rec.name] = {};
    for (const sc of SCENARIOS) {
      const r = runScenario(rec, sc, clean);
      all[rec.name][sc.name] = r.mean;
      for (const v of Object.values(r.mean)) if (v !== null) expect(Number.isFinite(v)).toBe(true);
      lines.push([sc.name.padEnd(34), ...COLUMNS.map(([k]) => pad(r.mean[k] === null ? '-' : String(r.mean[k]), 9))].join(' '));
    }
  }
  console.log(lines.join('\n'));
  if (import.meta.env.VITE_REPLAY_JSON) console.log(`REPLAY_METRICS_JSON ${JSON.stringify(all)}`);
});
