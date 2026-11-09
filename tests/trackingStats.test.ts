import { describe, expect, it } from 'vitest';
import { NULL_RUN_BUCKETS_MS, outOfFrameCause, recalCause, TrackingStats } from '../src/pose/trackingStats';

/** frames every `dt` ms from `t0`, with a person (true) or not */
function feed(s: TrackingStats, t0: number, n: number, hadPose: boolean, dt = 33, ms = 10) {
  for (let i = 0; i < n; i++) s.frame(t0 + i * dt, ms, hadPose);
  return t0 + n * dt;
}

describe('TrackingStats', () => {
  it('counts a null run in its bucket, from the last frame with a person to the next one', () => {
    const s = new TrackingStats();
    let t = feed(s, 0, 10, true);
    t = feed(s, t, 5, false); // frames at 330..462, back at 495: 495 - 297 = 198 ms
    feed(s, t, 3, true);
    expect([...s.nullRuns]).toEqual([0, 1, 0, 0, 0, 0]);
    expect(s.nullFrames).toBe(5);
    expect(s.longestNullMs).toBe(198);
    expect(s.hitches).toBe(0);
  });

  it('puts runs into every bucket and tells the run in progress', () => {
    const s = new TrackingStats();
    let t = 0;
    for (const ms of [50, 150, 400, 800, 2000, 5000]) {
      t = feed(s, t, 1, true);
      s.frame(t + ms - 1, 10, false); // a single null frame: the run is from the frame before it
      expect(s.currentNullMs(t + ms)).toBeGreaterThan(0);
      t += ms;
      s.frame(t, 10, true);
    }
    expect(NULL_RUN_BUCKETS_MS.length + 1).toBe(s.nullRuns.length);
    expect([...s.nullRuns]).toEqual([1, 1, 1, 1, 1, 1]);
    expect(s.currentNullMs(t)).toBe(0);
  });

  it('counts a hitch only between two frames with a person, not around null frames', () => {
    const s = new TrackingStats();
    let t = feed(s, 0, 5, true);
    t = feed(s, t + 300, 5, true); // a 333 ms gap: a hitch
    t = feed(s, t, 2, false, 33);
    feed(s, t + 400, 2, false); // a gap between nulls: not one
    expect(s.hitches).toBe(1);
    expect(s.longestHitchMs).toBe(333);
  });

  it('does not count the pause after interrupt() (camera off)', () => {
    const s = new TrackingStats();
    feed(s, 0, 5, true);
    s.frame(165, 10, false);
    s.interrupt();
    feed(s, 60000, 5, true);
    expect(s.hitches).toBe(0);
    expect([...s.nullRuns].reduce((a, b) => a + b)).toBe(0);
    expect(s.currentNullMs(60200)).toBe(0);
  });

  it('measures the processed frame rate', () => {
    const s = new TrackingStats();
    feed(s, 0, 100, true, 1000 / 30);
    expect(s.fps).toBeCloseTo(30, 0);
  });

  it('gives median and 95th percentile of the inference time over a window', () => {
    const s = new TrackingStats();
    expect(s.inferenceMs()).toEqual({ p50: 0, p95: 0 });
    for (let i = 1; i <= 100; i++) s.frame(i * 33, i, true);
    const { p50, p95 } = s.inferenceMs();
    expect(p50).toBe(50);
    expect(p95).toBe(95);
    // only the last 256 count: slow old frames fall out
    for (let i = 0; i < 300; i++) s.frame(10000 + i * 33, 5, true);
    expect(s.inferenceMs()).toEqual({ p50: 5, p95: 5 });
  });

  it('counts recalibrations and out-of-frame episodes by cause', () => {
    const s = new TrackingStats();
    s.recalibration('noPerson');
    s.recalibration('manual');
    s.recalibration('manual');
    s.outOfFrameEpisode('leftArm');
    s.outOfFrameEpisode('leftArm');
    s.outOfFrameEpisode('torso');
    expect(s.recalibrations).toEqual({ noPerson: 1, offCentre: 0, manual: 2 });
    expect(s.outOfFrame).toEqual({ leftArm: 2, torso: 1 });
    s.reset();
    expect(s.recalibrations).toEqual({ noPerson: 0, offCentre: 0, manual: 0 });
    expect(s.outOfFrame).toEqual({});
  });

  it('names the causes from the visibility reading', () => {
    expect(recalCause({ personDetected: true })).toBe('offCentre');
    expect(recalCause({ personDetected: false })).toBe('noPerson');
    const parts = { torso: { visible: true }, leftArm: { visible: false }, rightArm: { visible: false } };
    expect(outOfFrameCause({ parts }, ['torso', 'leftArm', 'rightArm'])).toBe('leftArm');
    expect(outOfFrameCause({ parts: { torso: { visible: true } } }, ['torso'])).toBe('other');
  });
});
