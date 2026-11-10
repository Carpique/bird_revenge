import { describe, expect, it } from 'vitest';
import { config } from '../../src/config';
import { allRecordings } from './harness';
import { latency } from './latency';

// the poses, not continuous steering (the default): what these tests measure
config.pointing.continuous = false;

/**
 * Responsiveness on recordings of real play (`tests/replay/recordings`, black-box dumps of the raw stream): how
 * long the bird takes to follow a new pose of the arms, and that it does not flicker for it. See `latency.ts`.
 *
 * History (median delay, ms, on 2026-11-09-gra / -trening): 276 / 280 with One-Euro beta 0.3 for the arms, the arm
 * directions' EMA 0.4 per frame (~95 ms at 23 fps) and enterMs 100; 143 / 136 with armBeta 10, smoothingMs 35 and
 * enterMs 60. Mode switches 38 / 48 per minute, flicker 2 / 2 before and 1 / 4 after.
 *
 * One arm pointing (`pointing.oneArm`) waits `oneArmEnterMs` before the bird flies by it, so those changes are
 * counted apart: the poses' delays are the same with it and without (the second player's recordings, 2026-11-10,
 * are where it was held).
 */
const LIMITS = {
  /** median delay, ms (was ~270 before the tuning) */
  p50: 170,
  /** 90th percentile, ms */
  p90: 300,
  /** mode changes under 200 ms, per recording */
  flicker: 6,
  /** a change to one arm pointing: followed within `oneArmEnterMs` plus this, ms */
  oneArmSlack: 200,
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
      if (m.oneArm.followed) expect(m.oneArm.max).toBeLessThanOrEqual(config.pointing.oneArmEnterMs + LIMITS.oneArmSlack);
    });
  }

  it('one arm pointing: held on the recordings (not on the first one), and followed', () => {
    const held = Object.fromEntries(dumps.map((r) => [r.name, latency(r).oneArm]));
    console.log(`one arm ${JSON.stringify(held)}`);
    const total = Object.values(held).reduce((a, o) => a + o.changes, 0);
    expect(total).toBeGreaterThanOrEqual(3);
    expect(Object.values(held).reduce((a, o) => a + o.followed, 0)).toBe(total);
    if ('2026-11-10-drugi-gracz-2' in held) expect(held['2026-11-10-drugi-gracz-2'].changes).toBeGreaterThanOrEqual(1);
  });

  it('the poses are followed as quickly with one arm steering as without it', () => {
    const was = config.pointing.oneArm;
    try {
      for (const r of dumps) {
        config.pointing.oneArm = true;
        const { oneArm: _, ...on } = latency(r);
        config.pointing.oneArm = false;
        const { oneArm: __, ...off } = latency(r);
        // a one-arm pose in the middle of another can split it into two parts too short to count: one change either way
        expect(Math.abs(on.changes - off.changes), r.name).toBeLessThanOrEqual(1);
        expect(on.changes - on.followed, r.name).toBeLessThanOrEqual(off.changes - off.followed);
        expect(on.p50, r.name).toBeLessThanOrEqual(off.p50 + 5);
        expect(on.p90, r.name).toBeLessThanOrEqual(off.p90 + 5);
        expect(on.flicker, r.name).toBeLessThanOrEqual(off.flicker);
      }
    } finally {
      config.pointing.oneArm = was;
    }
  });
});
