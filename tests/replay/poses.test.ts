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
  let playMs = 0, unmatchedMs = 0, vMs = 0, oneArmMs = 0, fallMs = 0, falls = 0, falling = false;
  rec.frames.forEach(({ t, f }, i) => {
    const p = det.update(tracker.process(f), t).pointing;
    if (i + 1 >= rec.frames.length) return;
    if (st[i] !== 'playing' || !p?.intent) {
      falling = false;
      return;
    }
    const dt = Math.min(100, rec.frames[i + 1].t - t);
    playMs += dt;
    // flying with the arms too far apart to point together: a V (or one arm pointing, counted apart)
    if (p.candidate?.oneArm) oneArmMs += dt;
    else if (p.candidate?.mode === 'fly' && p.left !== null && p.right !== null && angle(p.left, p.right) > config.pointing.parallelMax) vMs += dt;
    const fall = !p.candidate && p.intent.mode === 'rest';
    if (!p.candidate) unmatchedMs += dt;
    if (fall) {
      fallMs += dt;
      if (!falling) falls++;
    }
    falling = fall;
  });
  const pct = (ms: number) => Math.round((1000 * ms) / playMs) / 10;
  return { unmatchedPct: pct(unmatchedMs), vPct: pct(vMs), oneArmPct: pct(oneArmMs), falls, fallMs: Math.round(fallMs) };
}

/** the first player's recordings, which the V was tuned on (the limits below are theirs) */
const first = dumps.filter((r) => r.name.startsWith('2026-11-09-'));
/** the second, smaller player's: one arm up and the other down, where the first one raised a V */
const second = dumps.filter((r) => r.name.startsWith('2026-11-10-drugi-gracz-'));

describe('poses on recordings of play', () => {
  const { vUp, oneArm } = config.pointing;
  afterEach(() => {
    config.pointing.vUp = vUp;
    config.pointing.oneArm = oneArm;
  });

  it('there are recordings of play', () => {
    expect(dumps.length).toBeGreaterThan(0);
  });

  // with vUp off (on): unmatched 22.2 / 35.9 / 27.6 % (14.1 / 18.7 / 15.3 %) of play; the bird dropped for want of
  // a pose 12x 7.0 s / 11x 11.7 s / 15x 9.6 s (9x 4.3 s / 8x 5.8 s / 10x 5.3 s) on po-strojeniu / gra / trening;
  // measured without one arm steering (`oneArm` off), which the V was tuned before
  for (const r of first) {
    it(`${r.name}: arms raised in a V fly up: far less time matching no pose, far fewer drops for it`, () => {
      config.pointing.oneArm = false;
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

  // the second player raised a V less (7.4 / 7.4 % of play against 8.7-17.3 %) and matched more without it (unmatched
  // 11.6 / 15.9 % with the V off, 4.4 / 11.9 % with it on): a smaller gain than the first player's, never a loss
  for (const r of second) {
    it(`${r.name}: the V flies up there too, with no more drops`, () => {
      config.pointing.oneArm = false;
      config.pointing.vUp = false;
      const off = poses(r);
      config.pointing.vUp = true;
      const on = poses(r);
      console.log(`poses ${r.name}: vUp off ${JSON.stringify(off)}, on ${JSON.stringify(on)}`);
      expect(off.vPct).toBe(0);
      expect(on.vPct).toBeGreaterThan(3);
      expect(on.unmatchedPct).toBeLessThan(off.unmatchedPct);
      expect(on.fallMs).toBeLessThanOrEqual(off.fallMs);
      expect(on.falls).toBeLessThanOrEqual(off.falls);
    });
  }

  // one arm pointing while the other hangs (`pointing.oneArm`), off -> on: unmatched 14.2 / 18.7 / 15.4 / 4.4 /
  // 11.9 % -> 12.7 / 18.7 / 10.6 / 4.1 / 7.4 % of play (po-strojeniu / gra / trening / drugi-gracz-1 / -2); the drops
  // for want of a pose 9x 4.3 s / 8x 5.8 s / 10x 5.3 s / 3x 1.2 s / 5x 5.3 s -> 9x 4.1 s / 8x 5.8 s / 9x 2.8 s /
  // 3x 1.2 s / 4x 2.7 s
  it('one arm pointing: less time matching no pose and fewer drops for it, most where it was held', () => {
    const rows = dumps.map((r) => {
      config.pointing.oneArm = false;
      const off = poses(r);
      config.pointing.oneArm = true;
      const on = poses(r);
      console.log(`poses ${r.name}: oneArm off ${JSON.stringify(off)}, on ${JSON.stringify(on)}`);
      expect(off.oneArmPct, r.name).toBe(0);
      expect(on.unmatchedPct, r.name).toBeLessThanOrEqual(off.unmatchedPct);
      expect(on.fallMs, r.name).toBeLessThanOrEqual(off.fallMs);
      expect(on.falls, r.name).toBeLessThanOrEqual(off.falls);
      // nothing else reads differently: the V's share is the same
      expect(on.vPct, r.name).toBe(off.vPct);
      return { name: r.name, off, on };
    });
    const of = (name: string) => rows.find((x) => x.name === name);
    // the second player's second recording: one arm straight up, the other down, for seconds, the bird left on the ground
    const g2 = of('2026-11-10-drugi-gracz-2');
    if (g2) {
      expect(g2.on.oneArmPct).toBeGreaterThan(3);
      expect(g2.on.unmatchedPct).toBeLessThan(g2.off.unmatchedPct - 3);
      expect(g2.on.fallMs).toBeLessThan(g2.off.fallMs * 0.6);
    }
    // the first player did it too (practice): about as much
    const tr = of('2026-11-09-trening');
    if (tr) {
      expect(tr.on.oneArmPct).toBeGreaterThan(3);
      expect(tr.on.fallMs).toBeLessThan(tr.off.fallMs * 0.6);
    }
  });

  it('the V changes nothing for the poo: the same shoot triggers', () => {
    for (const r of dumps) {
      config.pointing.vUp = false;
      const off = simulate(r, r.frames, { startState: 'playing' }).triggers;
      config.pointing.vUp = true;
      expect(simulate(r, r.frames, { startState: 'playing' }).triggers, r.name).toEqual(off);
    }
  });

  it('nor does one arm steering', () => {
    for (const r of dumps) {
      config.pointing.oneArm = false;
      const off = simulate(r, r.frames, { startState: 'playing' }).triggers;
      config.pointing.oneArm = true;
      expect(simulate(r, r.frames, { startState: 'playing' }).triggers, r.name).toEqual(off);
    }
  });
});
