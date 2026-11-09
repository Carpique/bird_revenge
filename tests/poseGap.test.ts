import { describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { PoseDetectors } from '../src/input/poseControls';
import { filtersStale, poseGap } from '../src/pose/freshness';
import { PoseSmoother } from '../src/pose/PoseSmoother';
import { synthPose } from './synthetic';

/** a frame as MediaPipe's raw landmarks, the person at `dx` from where synthPose puts it */
const raw = (t: number, dx = 0) =>
  synthPose({ t, armLeft: 90, armRight: 90 }).lm.map((p) => ({ x: p.x + dx, y: p.y, z: 0, visibility: p.v }));

describe('poseGap', () => {
  it('is fresh up to pose.holdLastMs, lost up to visibility.personGoneAfterMs, then gone', () => {
    expect(poseGap(0)).toBe('fresh');
    expect(poseGap(config.pose.holdLastMs - 1)).toBe('fresh');
    expect(poseGap(config.pose.holdLastMs)).toBe('lost');
    expect(poseGap(config.visibility.personGoneAfterMs - 1)).toBe('lost');
    expect(poseGap(config.visibility.personGoneAfterMs)).toBe('gone');
  });

  it('the thresholds are in order: hold, then filter reset, then gone', () => {
    expect(config.pose.holdLastMs).toBeLessThan(config.pose.resetFiltersAfterMs);
    expect(config.pose.resetFiltersAfterMs).toBeLessThan(config.visibility.personGoneAfterMs);
    expect(filtersStale(config.pose.resetFiltersAfterMs - 1)).toBe(false);
    expect(filtersStale(config.pose.resetFiltersAfterMs)).toBe(true);
  });
});

describe('PoseSmoother', () => {
  it('has no landmarks for a frame with nobody, and carries on smoothly after a short gap', () => {
    const s = new PoseSmoother();
    for (let t = 0; t < 1000; t += 33) s.process(raw(t), 16 / 9, t);
    const before = s.process(raw(1000), 16 / 9, 1000)!;
    // nobody for 330 ms (nulls), then the person is 0.05 to the side
    for (let t = 1033; t < 1330; t += 33) expect(s.process(null, 16 / 9, t)).toBeNull();
    const after = s.process(raw(1360, 0.05), 16 / 9, 1360)!;
    // filtered, not taken as it is: it has not jumped the whole 0.05 yet, but moved towards it
    const moved = after[0].x - before[0].x;
    expect(moved).toBeGreaterThan(0.005);
    expect(moved).toBeLessThan(0.05);
  });

  it('starts afresh after a gap of pose.resetFiltersAfterMs: the first frame back is taken as it is', () => {
    const s = new PoseSmoother();
    for (let t = 0; t < 1000; t += 33) s.process(raw(t), 16 / 9, t);
    const t = 1000 + config.pose.resetFiltersAfterMs;
    const after = s.process(raw(t, 0.05), 16 / 9, t)!;
    expect(after[0].x).toBeCloseTo(raw(t, 0.05)[0].x, 9);
  });

  it('reset forgets the person at once (redetect)', () => {
    const s = new PoseSmoother();
    for (let t = 0; t < 500; t += 33) s.process(raw(t), 16 / 9, t);
    s.reset();
    const after = s.process(raw(530, 0.05), 16 / 9, 530)!;
    expect(after[0].x).toBeCloseTo(raw(530, 0.05)[0].x, 9);
  });
});

describe('PoseDetectors after a gap', () => {
  const warm = () => {
    const d = new PoseDetectors();
    d.shoot.calibrate({ left: 0.1, right: 0.2 });
    for (let t = 0; t < 2000; t += 33) d.update(synthPose({ t, armLeft: 90, armRight: 90 }), t);
    return d;
  };

  it('a short gap leaves the detectors as they were', () => {
    const d = warm();
    const before = d.update(synthPose({ t: 2000, armLeft: 90, armRight: 90 }), 2000);
    expect(before.pointing?.intent?.mode).not.toBe('rest');
    // nulls for 200 ms
    for (let t = 2033; t < 2200; t += 33) d.update(null, t);
    const r = d.update(synthPose({ t: 2233, armLeft: 90, armRight: 90 }), 2233);
    expect(r.pointing?.intent?.mode).toBe(before.pointing?.intent?.mode);
  });

  it('a gap longer than pose.holdLastMs drops the transient state, and keeps the shoot baseline', () => {
    const d = warm();
    const t0 = 2000 + config.pose.holdLastMs + 100;
    d.update(null, 2033);
    const r = d.update(synthPose({ t: t0, armLeft: 90, armRight: 90 }), t0);
    // the pointing starts over: resting, nothing pending
    expect(r.pointing?.intent?.mode ?? 'rest').toBe('rest');
    expect(d.shoot.baseline).not.toBeNull();
  });

  it('frames that did not come at all count as a gap too', () => {
    const d = warm();
    const t0 = 2000 + config.pose.holdLastMs + 100;
    const r = d.update(synthPose({ t: t0, armLeft: 90, armRight: 90 }), t0);
    expect(r.pointing?.intent?.mode ?? 'rest').toBe('rest');
  });
});
