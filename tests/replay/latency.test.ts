import { describe, expect, it } from 'vitest';
import { allRecordings } from './harness';
import { latency } from './latency';

/**
 * Responsiveness on recordings of real play (`tests/replay/recordings`, black-box dumps of the raw stream): how
 * long the bird takes to follow a new pose of the arms, and that it does not flicker for it. See `latency.ts`.
 *
 * History (median delay, ms, on 2026-11-09-gra / -trening): 276 / 280 with One-Euro beta 0.3 for the arms, the arm
 * directions' EMA 0.4 per frame (~95 ms at 23 fps) and enterMs 100; 143 / 136 with armBeta 10, smoothingMs 35 and
 * enterMs 60. Mode switches 38 / 48 per minute, flicker 2 / 2 before and 1 / 4 after.
 */
const LIMITS = {
  /** median delay, ms (was ~270 before the tuning) */
  p50: 170,
  /** 90th percentile, ms */
  p90: 300,
  /** mode changes under 200 ms, per recording */
  flicker: 6,
};

describe('latency on recordings of play', () => {
  const dumps = allRecordings().filter((r) => r.rec.level === 'black-box');

  it('there are recordings of play to measure', () => {
    expect(dumps.length).toBeGreaterThan(0);
  });

  for (const r of dumps) {
    it(`${r.name}: the bird follows a new pose of the arms quickly, without flicker`, () => {
      const m = latency(r);
      console.log(`latency ${r.name}: ${JSON.stringify(m)}`);
      expect(m.changes).toBeGreaterThan(5);
      // nearly every change of pose is followed
      expect(m.followed).toBeGreaterThanOrEqual(Math.floor(m.changes * 0.9));
      expect(m.p50).toBeLessThanOrEqual(LIMITS.p50);
      expect(m.p90).toBeLessThanOrEqual(LIMITS.p90);
      expect(m.flicker).toBeLessThanOrEqual(LIMITS.flicker);
    });
  }
});
