import { describe, expect, it, vi } from 'vitest';
import { config } from '../src/config';
import type { FrameMeta } from '../src/pose/FrameClock';
import { FrameLoop, type LoopEnv, type LoopFrame, type LoopVideo } from '../src/pose/FrameLoop';
import { PoseTracker } from '../src/pose/PoseTracker';

/** A clock with timers, and a video whose frame callbacks the test fires itself (or not: the browser dropping them). */
function fakes() {
  let now = 0;
  let nextId = 1;
  const intervals = new Map<number, { cb: () => void; ms: number; next: number }>();
  const env: LoopEnv = {
    now: () => now,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    setInterval: (cb, ms) => {
      intervals.set(nextId, { cb, ms, next: now + ms });
      return nextId++;
    },
    clearInterval: (h) => void intervals.delete(h),
    hidden: () => false,
  };
  const callbacks = new Map<number, (now: number, meta: FrameMeta) => void>();
  const video: LoopVideo & { videoWidth: number; videoHeight: number } = {
    paused: false,
    ended: false,
    readyState: 4,
    videoWidth: 640,
    videoHeight: 480,
    requestVideoFrameCallback: (cb) => {
      callbacks.set(nextId, cb);
      return nextId++;
    },
    cancelVideoFrameCallback: (h) => void callbacks.delete(h),
  };
  return {
    env,
    video,
    callbacks,
    /** a video frame arrives: the pending callbacks fire, with the frame's metadata (none given: empty) */
    frame(meta: FrameMeta = {}, at = now) {
      const pending = [...callbacks.values()];
      callbacks.clear();
      pending.forEach((cb) => cb(at, meta));
    },
    /** the fake clock moves on (no timers fire) */
    set now(t: number) {
      now = t;
    },
    /** time passes, the timers fire */
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = [...intervals.values()].filter((i) => i.next <= end).sort((a, b) => a.next - b.next)[0];
        if (!due) break;
        now = due.next;
        due.next += due.ms;
        due.cb();
      }
      now = end;
    },
  };
}

describe('FrameLoop', () => {
  it('steps on every frame, and again after one that threw', () => {
    const f = fakes();
    let n = 0;
    const errors: unknown[] = [];
    const loop = new FrameLoop(f.video, () => {
      if (++n === 2) throw new Error('boom');
    }, { onError: (e) => errors.push(e), onWatchdog: () => {} }, f.env);
    loop.start();
    expect(n).toBe(1);
    f.frame();
    expect(n).toBe(2);
    expect(errors).toHaveLength(1);
    f.frame();
    f.frame();
    expect(n).toBe(4);
    expect(f.callbacks.size).toBe(1); // exactly one chain
  });

  it('survives a failing error hook', () => {
    const f = fakes();
    let n = 0;
    const loop = new FrameLoop(f.video, () => {
      n++;
      throw new Error('boom');
    }, { onError: () => { throw new Error('hook'); }, onWatchdog: () => {} }, f.env);
    loop.start();
    f.frame();
    expect(n).toBe(2);
  });

  it('arms itself again when the frame callbacks stop coming while the video plays', () => {
    const f = fakes();
    let n = 0;
    const stalls: number[] = [];
    new FrameLoop(f.video, () => void n++, { onError: () => {}, onWatchdog: (ms) => stalls.push(ms) }, f.env).start();
    f.frame();
    expect(n).toBe(2);
    f.callbacks.clear(); // the browser drops the callback
    f.advance(config.pose.watchdogMs - 100);
    expect(stalls).toEqual([]);
    f.advance(600);
    expect(stalls).toHaveLength(1);
    expect(stalls[0]).toBeGreaterThan(config.pose.watchdogMs);
    expect(f.callbacks.size).toBe(1);
    f.frame();
    expect(n).toBe(3); // running again
    f.advance(config.pose.watchdogMs * 3);
    expect(stalls.length).toBeGreaterThanOrEqual(2); // dead again (nothing fires the callbacks any more): armed again, but not more often than every watchdogMs
    expect(stalls.length).toBeLessThanOrEqual(4);
  });

  it('leaves a paused, ended, not ready or hidden video alone, and a frame that was not there is no beat', () => {
    for (const state of ['paused', 'ended', 'notReady', 'hidden'] as const) {
      const f = fakes();
      let stalls = 0;
      new FrameLoop(f.video, () => true, { onError: () => {}, onWatchdog: () => void stalls++ }, f.env).start();
      f.callbacks.clear();
      if (state === 'paused') f.video.paused = true;
      if (state === 'ended') f.video.ended = true;
      if (state === 'notReady') f.video.readyState = 1;
      if (state === 'hidden') f.env.hidden = () => true;
      f.advance(config.pose.watchdogMs * 3);
      expect(stalls, state).toBe(0);
    }
    // playing, callbacks firing, but the step never takes a frame: no beat, so the watchdog re-arms
    const f = fakes();
    let stalls = 0;
    new FrameLoop(f.video, () => false, { onError: () => {}, onWatchdog: () => void stalls++ }, f.env).start();
    for (let i = 0; i < 30; i++) {
      f.advance(100);
      f.frame();
    }
    expect(stalls).toBeGreaterThan(0);
  });

  it('stops for good (no step, no watchdog) and falls back to animation frames without requestVideoFrameCallback', () => {
    const f = fakes();
    let n = 0;
    let stalls = 0;
    const loop = new FrameLoop(f.video, () => void n++, { onError: () => {}, onWatchdog: () => void stalls++ }, f.env);
    loop.start();
    loop.stop();
    f.frame();
    f.advance(5000);
    expect(n).toBe(1);
    expect(stalls).toBe(0);
    expect(f.callbacks.size).toBe(0);

    const raf: Array<() => void> = [];
    const g = fakes();
    g.env.requestAnimationFrame = (cb) => raf.push(cb);
    delete g.video.requestVideoFrameCallback;
    let m = 0;
    new FrameLoop(g.video, () => void m++, { onError: () => {}, onWatchdog: () => {} }, g.env).start();
    raf.shift()!();
    expect(m).toBe(2);
  });

  it("hands step the frame's callback time and metadata (null on the first step and on the animation-frame fallback)", () => {
    const f = fakes();
    const got: LoopFrame[] = [];
    new FrameLoop(f.video, (fr) => void got.push(fr), { onError: () => {}, onWatchdog: () => {} }, f.env).start();
    f.now = 40;
    const meta = { captureTime: 10, mediaTime: 0.5, presentedFrames: 7 };
    f.frame(meta, 33);
    expect(got).toEqual([
      { now: 0, meta: null },
      { now: 33, meta },
    ]);

    const raf: Array<() => void> = [];
    const g = fakes();
    g.env.requestAnimationFrame = (cb) => raf.push(cb);
    delete g.video.requestVideoFrameCallback;
    const fb: LoopFrame[] = [];
    new FrameLoop(g.video, (fr) => void fb.push(fr), { onError: () => {}, onWatchdog: () => {} }, g.env).start();
    g.now = 16;
    raf.shift()!();
    expect(fb).toEqual([
      { now: 0, meta: null },
      { now: 16, meta: null },
    ]);
  });
});

describe('PoseTracker frame loop', () => {
  /** a tracker over a fake landmarker, with the loop's callbacks fired by hand */
  function tracker(detect: (video: unknown, ts: number) => unknown) {
    const f = fakes();
    // the tracker's constructor is private (the model loads in `create`); a test builds one over fakes
    const T = PoseTracker as unknown as new (l: unknown, v: unknown, fellBack: boolean, env: LoopEnv) => PoseTracker;
    const t = new T({ detectForVideo: detect, setOptions: () => Promise.resolve() }, f.video, false, f.env);
    return { f, t };
  }
  const person = () => ({ landmarks: [Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }))] });

  it('counts detect and onFrame exceptions in the telemetry and keeps going', () => {
    let calls = 0;
    const { f, t } = tracker(() => {
      if (++calls === 2) throw new Error('detect failed');
      return person();
    });
    let frames = 0;
    t.onFrame = () => {
      if (++frames === 2) throw new Error('onFrame failed');
    };
    const warn = console.warn;
    console.warn = () => {};
    try {
      t.start();
      for (let i = 0; i < 4; i++) f.frame();
    } finally {
      console.warn = warn;
    }
    expect(calls).toBe(5); // never stopped
    expect(t.stats.errors).toEqual({ detect: 1, frame: 1 });
    expect(t.stats.lastError).toMatch(/^frame: onFrame failed/);
    expect(frames).toBe(4); // the failed detect gave none
    t.stop();
  });

  it("gives one frame's time to the model, the smoothing, the telemetry and onFrame alike", () => {
    const detectTs: number[] = [];
    const { f, t } = tracker((_v: unknown, ts: number) => (detectTs.push(ts), person()));
    const smoothTs: number[] = [];
    const process = t.smoother.process.bind(t.smoother);
    vi.spyOn(t.smoother, 'process').mockImplementation((raw, aspect, ts) => (smoothTs.push(ts), process(raw, aspect, ts)));
    const statsTs: number[] = [];
    const frame = t.stats.frame.bind(t.stats);
    vi.spyOn(t.stats, 'frame').mockImplementation((ts, ...rest) => (statsTs.push(ts), frame(ts, ...rest)));
    const got: Array<{ frameT: number | undefined; timingT: number; dropped: number | null }> = [];
    t.onFrame = (fr, timing) => void got.push({ frameT: fr?.t, timingT: timing.t, dropped: timing.dropped });
    f.now = 1000;
    t.start(); // the first step has no metadata: the callback's time
    // the camera's clock 700 ms behind the page's; the callbacks come late by a varying amount, one frame missed
    f.frame({ captureTime: 300, mediaTime: 0.3, presentedFrames: 1 }, 1010);
    f.frame({ captureTime: 333, mediaTime: 0.333, presentedFrames: 2 }, 1050);
    f.frame({ captureTime: 400, mediaTime: 0.4, presentedFrames: 4 }, 1105);
    expect(detectTs).toEqual(smoothTs);
    expect(detectTs).toEqual(statsTs);
    expect(got.map((g) => g.frameT)).toEqual(detectTs);
    expect(got.map((g) => g.timingT)).toEqual(detectTs);
    // 1010: anchored on the first frame (offset 710); 1043: the source's 33 ms on (plus 0.02 ms of creep), not the
    // late callback's 40; 1105: an earlier arrival than any so far lowers the offset to 705
    expect(detectTs.map((x) => Math.round(x * 100) / 100)).toEqual([1000, 1010, 1043.02, 1105]);
    expect(got.map((g) => g.dropped)).toEqual([null, 0, 0, 1]);
    t.stop();
  });

  it('counts a watchdog re-arm in the telemetry', () => {
    const { f, t } = tracker(person);
    const warn = console.warn;
    console.warn = () => {};
    try {
      t.start();
      f.callbacks.clear();
      f.advance(config.pose.watchdogMs + 500);
    } finally {
      console.warn = warn;
    }
    expect(t.stats.watchdogRearms).toBe(1);
    f.frame();
    expect(t.stats.frames).toBe(2);
    t.stop();
  });
});
