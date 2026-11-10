import { config } from '../config';
import type { FrameMeta } from './FrameClock';

/** The parts of a video element the loop looks at. */
export interface LoopVideo {
  paused: boolean;
  ended: boolean;
  readyState: number;
  /** the browser calls back with `(now, metadata)` (lib.dom's `VideoFrameRequestCallback`) */
  requestVideoFrameCallback?: (cb: (now: number, meta: FrameMeta) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
}

/** The clock and timers the loop runs on (the browser's by default; a test passes fakes). */
export interface LoopEnv {
  now: () => number;
  requestAnimationFrame: (cb: () => void) => number;
  cancelAnimationFrame: (handle: number) => void;
  setInterval: (cb: () => void, ms: number) => number;
  clearInterval: (handle: number) => void;
  /** the page is in the background (its frame callbacks are throttled or stopped by the browser) */
  hidden: () => boolean;
}

const browserEnv = (): LoopEnv => ({
  now: () => performance.now(),
  requestAnimationFrame: (cb) => requestAnimationFrame(cb),
  cancelAnimationFrame: (h) => cancelAnimationFrame(h),
  setInterval: (cb, ms) => window.setInterval(cb, ms),
  clearInterval: (h) => window.clearInterval(h),
  hidden: () => typeof document !== 'undefined' && document.hidden,
});

/**
 * What the loop knows about the frame it hands `step`: `now`, the callback's time (`performance.now()` timebase; for
 * `requestVideoFrameCallback` the rendering step's time, as `requestAnimationFrame` gets), and the frame's metadata,
 * null on the `requestAnimationFrame` fallback and on the first step at `start()` (then `now` is the loop's clock).
 */
export interface LoopFrame {
  now: number;
  meta: FrameMeta | null;
}

export interface LoopHooks {
  /** `step` threw (the loop carries on) */
  onError: (e: unknown) => void;
  /** the loop was found dead while the video played, and has been armed again; `stalledMs`: since when */
  onWatchdog: (stalledMs: number) => void;
}

/**
 * Calls `step` for every new video frame (`requestVideoFrameCallback`, else every animation frame), and keeps
 * doing so:
 *  - an exception in `step` is reported (`onError`) and the next frame is armed all the same;
 *  - a watchdog (`pose.watchdogMs`): when the video is playing and no frame was handled for that long, the
 *    callback chain is taken to be dead (the browser dropped it) and is armed afresh (`onWatchdog`).
 *
 * `step` returns false when it had no frame to take (the video not ready yet): that is no beat, the watchdog
 * does not count it as one.
 */
export class FrameLoop {
  private running = false;
  /** bumped on every start and re-arm, so a callback left over from before ends its chain */
  private generation = 0;
  private lastBeat = 0;
  private handle: number | null = null;
  private timer: number | null = null;

  constructor(
    private readonly video: LoopVideo,
    private readonly step: (frame: LoopFrame) => boolean | void,
    private readonly hooks: LoopHooks,
    private readonly env: LoopEnv = browserEnv(),
  ) {}

  start() {
    if (this.running) return;
    this.running = true;
    this.lastBeat = this.env.now();
    const gen = ++this.generation;
    this.timer = this.env.setInterval(() => this.check(), Math.max(100, config.pose.watchdogMs / 4));
    this.tick(gen, this.env.now(), null);
  }

  stop() {
    this.running = false;
    this.generation++;
    this.cancel();
    if (this.timer !== null) this.env.clearInterval(this.timer);
    this.timer = null;
  }

  private tick(gen: number, now: number, meta: FrameMeta | null) {
    if (!this.running || gen !== this.generation) return;
    this.handle = null;
    try {
      if (this.step({ now, meta }) !== false) this.lastBeat = this.env.now();
    } catch (e) {
      this.lastBeat = this.env.now(); // frames do come, the step is what fails
      try {
        this.hooks.onError(e);
      } catch {
        // reporting must not end the loop either
      }
    } finally {
      if (this.running && gen === this.generation) this.arm(gen);
    }
  }

  private arm(gen: number) {
    if (this.video.requestVideoFrameCallback) {
      this.handle = this.video.requestVideoFrameCallback((now, meta) =>
        this.tick(gen, Number.isFinite(now) ? now : this.env.now(), meta ?? null),
      );
    } else {
      this.handle = this.env.requestAnimationFrame(() => this.tick(gen, this.env.now(), null));
    }
  }

  private cancel() {
    if (this.handle === null) return;
    if (this.video.requestVideoFrameCallback) this.video.cancelVideoFrameCallback?.(this.handle);
    else this.env.cancelAnimationFrame(this.handle);
    this.handle = null;
  }

  private check() {
    if (!this.running) return;
    const v = this.video;
    const playing = !v.paused && !v.ended && v.readyState >= 2 && !this.env.hidden();
    const now = this.env.now();
    const stalled = now - this.lastBeat;
    if (!playing || stalled <= config.pose.watchdogMs) return;
    this.cancel();
    this.lastBeat = now;
    this.arm(++this.generation);
    try {
      this.hooks.onWatchdog(stalled);
    } catch {
      // as above
    }
  }
}
