import { describe, expect, it } from 'vitest';
import { FrameClock, MAX_CAPTURE_AGE_MS, REANCHOR_BEHIND_MS, type FrameTiming } from '../src/pose/FrameClock';

const PERIOD = 1000 / 30;

/** a deterministic pseudo-random sequence in [0, 1) */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const sd = (xs: number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};

/**
 * A camera at 30 fps whose clock is `skew` ahead of the page's (captureTime = page time - skew), each frame's
 * callback `lag` + up to `jitter` ms after its capture (the page's own jitter: 6-7 ms sigma measured).
 */
function camera({ skew = 0, lag = 30, jitter = 22, seed = 1, rate = 1, n = 300 } = {}) {
  const r = rng(seed);
  const out: Array<{ now: number; capture: number; arrival: number }> = [];
  for (let i = 0; i < n; i++) {
    const arrival = 10_000 + i * PERIOD + lag; // the earliest the frame can reach the page
    out.push({ now: arrival + r() * jitter, capture: (10_000 + i * PERIOD) * rate - skew, arrival });
  }
  return out;
}

describe('FrameClock', () => {
  it("takes the callback's jitter out: the intervals are the camera's, t never after the callback", () => {
    const c = new FrameClock();
    const frames = camera();
    const ts = frames.map((f, i) => c.next(f.now, { captureTime: f.capture, mediaTime: f.capture / 1000, presentedFrames: i + 1 }));
    for (let i = 0; i < ts.length; i++) {
      expect(ts[i].t).toBeLessThanOrEqual(frames[i].now);
      expect(ts[i].source).toBe('capture');
    }
    const callbackIntervals = frames.slice(31).map((f, i) => f.now - frames[i + 30].now);
    const intervals = ts.slice(31).map((x, i) => x.t - ts[i + 30].t);
    expect(sd(callbackIntervals)).toBeGreaterThan(8);
    // after the first second the offset sits on the fastest arrival; what is left is the creep (0.5 ms/s)
    expect(sd(intervals)).toBeLessThan(0.2);
    // the creep shows as the odd step when a quicker frame lowers the offset again: ~1.3 ms at most here
    for (const d of intervals) expect(Math.abs(d - PERIOD)).toBeLessThan(2);
    // ...and t is the frame's earliest arrival, within a couple of ms
    for (let i = 30; i < ts.length; i++) expect(Math.abs(ts[i].t - frames[i].arrival)).toBeLessThan(2);
    // the latency is the callback's, against the capture time
    expect(ts[5].latencyMs).toBeCloseTo(frames[5].now - frames[5].capture, 6);
  });

  it('works on the media time when there is no capture time', () => {
    const c = new FrameClock();
    const frames = camera({ seed: 2 });
    const ts = frames.map((f) => c.next(f.now, { mediaTime: (f.capture - 1000) / 1000 }));
    expect(ts.every((x) => x.source === 'media' && x.latencyMs === null && x.dropped === null)).toBe(true);
    const intervals = ts.slice(31).map((x, i) => x.t - ts[i + 30].t);
    expect(sd(intervals)).toBeLessThan(0.2);
  });

  it('counts the frames the page never saw from presentedFrames', () => {
    const c = new FrameClock();
    const drops = [1, 2, 4, 5, 9, 9, 10].map((pf, i) => c.next(1000 + i * 40, { mediaTime: i * 0.04, presentedFrames: pf }).dropped);
    expect(drops).toEqual([0, 0, 1, 0, 3, 0, 0]);
    // a restarted count is no drop either
    expect(c.next(2000, { mediaTime: 1, presentedFrames: 1 }).dropped).toBe(0);
    expect(c.next(2040, { mediaTime: 1.04, presentedFrames: 3 }).dropped).toBe(1);
    // after a reset (camera stopped) the first frame counts none
    c.reset();
    expect(c.next(9000, { mediaTime: 30, presentedFrames: 900 }).dropped).toBe(0);
  });

  it('without metadata: the callback time, as before, no drops known', () => {
    const c = new FrameClock();
    const a = c.next(500, null);
    expect(a).toEqual<FrameTiming>({ t: 500, dropped: null, source: 'callback', latencyMs: null });
    expect(c.next(533, {}).t).toBe(533);
    // a time that does not move on still gives MediaPipe an increasing one
    expect(c.next(533, null).t).toBe(534);
    expect(c.next(520, null).t).toBe(535);
  });

  it('a capture time in another timebase, or from the future, is not used: the media time is', () => {
    const c = new FrameClock();
    // an epoch-based capture time
    const a = c.next(1000, { captureTime: 1.7e12, mediaTime: 1 });
    expect(a.source).toBe('media');
    expect(a.latencyMs).toBeNull();
    // too old to be this frame's
    expect(c.next(3000, { captureTime: 3000 - MAX_CAPTURE_AGE_MS - 1, mediaTime: 3 }).source).toBe('media');
    // after the callback
    expect(c.next(3040, { captureTime: 3050, mediaTime: 3.04 }).source).toBe('media');
    // a plausible one is preferred, its latency reported
    const b = c.next(3080, { captureTime: 3050, mediaTime: 3.08 });
    expect(b.source).toBe('capture');
    expect(b.latencyMs).toBe(30);
  });

  it('re-anchors when the source goes backwards, jumps behind, changes kind, or on reset', () => {
    const c = new FrameClock();
    for (let i = 0; i < 10; i++) c.next(1000 + i * PERIOD + 20, { mediaTime: 50 + i * PERIOD / 1000 });
    const last = c.next(1000 + 10 * PERIOD + 20, { mediaTime: 50 + 10 * PERIOD / 1000 }).t;
    // a restarted stream: the media time starts again from 0
    const restart = c.next(1500, { mediaTime: 0 });
    expect(restart.t).toBe(1500);
    expect(c.next(1540, { mediaTime: PERIOD / 1000 }).t).toBeCloseTo(1500 + PERIOD, 1);
    expect(restart.t).toBeGreaterThan(last);
    // the source stood still for 2 s while the page went on (a stalled stream): it would map far behind now
    const stalled = c.next(3540, { mediaTime: 2 * PERIOD / 1000 });
    expect(3540 - stalled.t).toBeLessThan(REANCHOR_BEHIND_MS);
    expect(stalled.t).toBe(3540);
    // capture time appears: another clock, anchored afresh
    const cap = c.next(3600, { captureTime: 3550, mediaTime: 3 * PERIOD / 1000 });
    expect(cap.source).toBe('capture');
    expect(cap.t).toBe(3600);
    // a reset: anchored on the next frame
    c.reset();
    expect(c.next(5000, { captureTime: 4000, mediaTime: 99 }).t).toBe(5000);
  });

  it('is strictly increasing, across a reset too', () => {
    const c = new FrameClock();
    const r = rng(7);
    let prev = -Infinity;
    for (let i = 0; i < 500; i++) {
      if (i === 250) c.reset();
      // a source that repeats itself and callbacks that come in bunches
      const now = 1000 + Math.floor(i / 3) * 40 + r() * 3;
      const t = c.next(now, { mediaTime: Math.floor(i / 2) * 0.033 }).t;
      expect(t).toBeGreaterThan(prev);
      prev = t;
    }
  });

  it("follows a camera clock drifting against the page's without stepping", () => {
    // the camera's clock runs slow, then fast, by 0.3 ms per second against the page's
    for (const rate of [1 - 0.0003, 1 + 0.0003]) {
      const c = new FrameClock();
      const frames = camera({ rate, n: 30 * 600, seed: 3, skew: 0 }); // ten minutes
      let worst = 0;
      let worstStep = 0;
      let prev: number | null = null;
      for (let i = 0; i < frames.length; i++) {
        const f = frames[i];
        // the arrival on the page's clock is fixed, the camera's clock drifts; on the media time: a capture time running fast would soon lie after the callback, and not be used
        const t = c.next(f.now, { mediaTime: f.capture / 1000, presentedFrames: i }).t;
        if (i > 30) worst = Math.max(worst, Math.abs(t - f.arrival));
        if (prev !== null && i > 30) worstStep = Math.max(worstStep, Math.abs(t - prev - PERIOD));
        prev = t;
        expect(t).toBeLessThanOrEqual(f.now);
      }
      // over ten minutes (180 ms of drift) the mapped time stays within a few ms of the frame's arrival (300 ppm is
      // more than a camera's crystal drifts; the callback's scatter here, uniform 0-22 ms, is the measured sigma)...
      expect(worst).toBeLessThan(4);
      // ...and moves on by the camera's interval give or take the creep, nothing like the callback's scatter
      expect(worstStep).toBeLessThan(3.5);
    }
  });
});
