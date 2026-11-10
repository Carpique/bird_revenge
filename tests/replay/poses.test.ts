import { afterEach, describe, expect, it } from 'vitest';
import { config } from '../../src/config';
import { PoseDetectors } from '../../src/input/poseControls';
import { allRecordings, SimTracker, simulate, type Recording } from './harness';

/**
 * Which poses the arms match on recordings of real play (black-box dumps), frame by frame through the real pipeline
 * (`SimTracker`, `PoseDetectors`), over the frames recorded in play: how much of the time they match none, and how
 * often the bird drops to rest only for that (`ambiguousMs` passed with no pose matched).
 */

const dumps = allRecordings().filter((r) => r.rec.level === 'black-box');

const angle = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

function poses(rec: Recording) {
  const tracker = new SimTracker();
  const det = new PoseDetectors();
  if (rec.rec.baseline) det.shoot.calibrate({ ...rec.rec.baseline });
  const st = (rec.rec.frames as { st?: string }[]).map((f) => f.st ?? 'playing');
  let playMs = 0, unmatchedMs = 0, vMs = 0, fallMs = 0, falls = 0, falling = false;
  rec.frames.forEach(({ t, f }, i) => {
    const p = det.update(tracker.process(f), t).pointing;
    if (i + 1 >= rec.frames.length) return;
    if (st[i] !== 'playing' || !p?.intent) {
      falling = false;
      return;
    }
    const dt = Math.min(100, rec.frames[i + 1].t - t);
    playMs += dt;
    // flying with the arms too far apart to point together: a V
    if (p.candidate?.mode === 'fly' && p.left !== null && p.right !== null && angle(p.left, p.right) > config.pointing.parallelMax) vMs += dt;
    const fall = !p.candidate && p.intent.mode === 'rest';
    if (!p.candidate) unmatchedMs += dt;
    if (fall) {
      fallMs += dt;
      if (!falling) falls++;
    }
    falling = fall;
  });
  const pct = (ms: number) => Math.round((1000 * ms) / playMs) / 10;
  return { unmatchedPct: pct(unmatchedMs), vPct: pct(vMs), falls, fallMs: Math.round(fallMs) };
}

describe('poses on recordings of play', () => {
  const vUp = config.pointing.vUp;
  afterEach(() => {
    config.pointing.vUp = vUp;
  });

  it('there are recordings of play', () => {
    expect(dumps.length).toBeGreaterThan(0);
  });

  // with vUp off (on): unmatched 22.2 / 35.9 / 27.6 % (14.1 / 18.7 / 15.3 %) of play; the bird dropped for want of
  // a pose 12x 7.0 s / 11x 11.7 s / 15x 9.6 s (9x 4.3 s / 8x 5.8 s / 10x 5.3 s) on po-strojeniu / gra / trening
  for (const r of dumps) {
    it(`${r.name}: arms raised in a V fly up: far less time matching no pose, far fewer drops for it`, () => {
      config.pointing.vUp = false;
      const off = poses(r);
      config.pointing.vUp = true;
      const on = poses(r);
      console.log(`poses ${r.name}: vUp off ${JSON.stringify(off)}, on ${JSON.stringify(on)}`);
      expect(off.vPct).toBe(0);
      expect(on.vPct).toBeGreaterThan(5);
      expect(on.unmatchedPct).toBeLessThan(20);
      expect(on.unmatchedPct).toBeLessThan(off.unmatchedPct * 0.7);
      expect(on.fallMs).toBeLessThan(6500);
      expect(on.fallMs).toBeLessThan(off.fallMs * 0.65);
      expect(on.falls).toBeLessThan(off.falls);
    });
  }

  it('the V changes nothing for the poo: the same shoot triggers', () => {
    for (const r of dumps) {
      config.pointing.vUp = false;
      const off = simulate(r, r.frames, { startState: 'playing' }).triggers;
      config.pointing.vUp = true;
      expect(simulate(r, r.frames, { startState: 'playing' }).triggers, r.name).toEqual(off);
    }
  });
});
