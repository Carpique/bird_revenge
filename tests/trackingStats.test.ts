import { describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { NULL_RUN_BUCKETS_MS, outOfFrameCause, RECENT_S, recalCause, TrackingStats } from '../src/pose/trackingStats';

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

  /** a 30 fps camera for `seconds` from `t0`, of whose frames the game sees all but every `every`-th (0: all) */
  function camera(s: TrackingStats, t0: number, seconds: number, every: number, latencyMs: number | null = 40) {
    const P = 1000 / 30;
    let missed = 0;
    let t = t0;
    for (let i = 0; i < seconds * 30; i++) {
      t = t0 + i * P;
      if (every && i % every === every - 1) {
        missed++;
        continue;
      }
      s.frame(t, 20, true, { dropped: i === 0 ? 0 : missed, source: 'capture', latencyMs });
      missed = 0;
    }
    return t + P;
  }

  it('counts camera frames the game never saw, over the session and the last seconds, and the camera rate', () => {
    const s = new TrackingStats();
    let t = camera(s, 0, 20, 0); // 20 s without a drop
    t = camera(s, t, 5, 4); // 5 s losing every 4th frame: 25 %
    expect(s.droppedFrames).toBe(37);
    expect(s.metaFrames).toBe(600 + 113);
    expect(s.dropShare().total).toBeCloseTo(37 / 750, 3);
    // the last 10 s: half of it with drops
    expect(s.dropShare().recent).toBeGreaterThan(0.1);
    expect(s.dropShare().recent).toBeLessThan(0.15);
    // the processed rate is 22.5, the camera's still 30
    expect(Math.abs(s.fps - 22.5)).toBeLessThan(1);
    expect(s.cameraFps).toBeCloseTo(30, 0);
    expect(s.hasMeta).toBe(true);
    expect(s.source).toBe('capture');
    expect(s.latencyMs()).toBe(40);
    // ten seconds on without drops, the recent rate is back to none, the session's stays
    camera(s, t, RECENT_S + 1, 0);
    expect(s.dropShare().recent).toBe(0);
    expect(s.dropShare().total).toBeGreaterThan(0.01);
  });

  it('without frame metadata: no drops counted, and it says so', () => {
    const s = new TrackingStats();
    feed(s, 0, 100, true, 1000 / 30);
    expect(s.hasMeta).toBe(false);
    expect(s.metaFrames).toBe(0);
    expect(s.cameraFps).toBe(0);
    expect(s.dropShare()).toEqual({ total: 0, recent: 0 });
    expect(s.latencyMs()).toBeNull();
    s.frame(5000, 20, true, { dropped: null, source: 'callback', latencyMs: null });
    expect(s.source).toBe('callback');
    expect(s.hasMeta).toBe(false);
  });

  it('counts long render frames, not the time the render loop was paused', () => {
    const s = new TrackingStats();
    const long = config.telemetry.longRenderMs;
    let t = 1000;
    for (let i = 0; i < 60; i++) s.renderTick((t += 1000 / 60));
    s.renderTick((t += long + 20)); // one long frame
    s.renderTick((t += 1000 / 60));
    s.renderPaused(); // suspended for a minute
    t += 60000;
    s.renderTick(t);
    s.renderTick((t += 1000 / 60));
    expect(s.longRenderFrames).toBe(1);
    expect(s.longestRenderMs).toBeCloseTo(long + 20, 6);
    expect(s.renderFrames).toBe(62);
    // the long frame was a minute ago: none in the last seconds
    expect(s.recentLongRender().count).toBe(0);
    s.renderTick((t += 40));
    expect(s.recentLongRender()).toEqual({ count: 1, share: 0.5 });
  });

  it('a camera stop is no drop and no gap in the camera rate; reset forgets drops and render frames', () => {
    const s = new TrackingStats();
    let t = camera(s, 0, 3, 0);
    s.interrupt();
    // the frame clock's reset makes the first frame after the stop count no drops
    t = camera(s, t + 60000, 3, 0);
    expect(s.droppedFrames).toBe(0);
    expect(s.cameraFps).toBeCloseTo(30, 0);
    camera(s, t, 3, 3);
    s.renderTick(0);
    s.renderTick(100);
    expect(s.droppedFrames).toBeGreaterThan(0);
    s.reset();
    expect([s.droppedFrames, s.metaFrames, s.renderFrames, s.longRenderFrames, s.longestRenderMs, s.cameraFps]).toEqual([0, 0, 0, 0, 0, 0]);
    expect(s.dropShare()).toEqual({ total: 0, recent: 0 });
    expect(s.recentLongRender()).toEqual({ count: 0, share: 0 });
    expect(s.latencyMs()).toBeNull();
    expect(s.source).toBeNull();
    // the render timing starts afresh too: the first tick after a reset is no frame
    s.renderTick(5000);
    expect(s.renderFrames).toBe(0);
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

  it('counts loop errors and watchdog re-arms, and forgets them on reset', () => {
    const s = new TrackingStats();
    s.error('detect', new Error('gpu lost'));
    s.error('frame', 'plain string');
    s.watchdog();
    expect(s.errors).toEqual({ detect: 1, frame: 1 });
    expect(s.lastError).toBe('frame: plain string');
    expect(s.watchdogRearms).toBe(1);
    s.reset();
    expect(s.errors).toEqual({ detect: 0, frame: 0 });
    expect(s.lastError).toBe('');
    expect(s.watchdogRearms).toBe(0);
  });

  it('names the causes from the visibility reading', () => {
    expect(recalCause({ personDetected: true })).toBe('offCentre');
    expect(recalCause({ personDetected: false })).toBe('noPerson');
    const parts = { torso: { visible: true }, leftArm: { visible: false }, rightArm: { visible: false } };
    expect(outOfFrameCause({ parts }, ['torso', 'leftArm', 'rightArm'])).toBe('leftArm');
    expect(outOfFrameCause({ parts: { torso: { visible: true } } }, ['torso'])).toBe('other');
  });
});
