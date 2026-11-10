/**
 * The parts of a video frame's metadata (`requestVideoFrameCallback`, lib.dom's `VideoFrameCallbackMetadata`) the
 * frame clock reads. All optional, so a test can build one and a browser that leaves a field out is handled.
 */
export interface FrameMeta {
  /** ms, when the camera captured the frame (local cameras and WebRTC; its timebase is not guaranteed in practice) */
  captureTime?: number;
  /** s, the frame's presentation timestamp in the stream */
  mediaTime?: number;
  /** frames submitted for composition so far; a jump of more than 1 between callbacks: frames the page never saw */
  presentedFrames?: number;
}

/** Where a frame's time came from: the camera's capture time, the stream's media time, or the callback alone. */
export type FrameSource = 'capture' | 'media' | 'callback';

/** One frame's timing, as the frame clock works it out. */
export interface FrameTiming {
  /** ms, `performance.now()` timebase: the frame's time for the whole pose pipeline */
  t: number;
  /** camera frames presented since the previous callback that the game never saw; null without metadata */
  dropped: number | null;
  source: FrameSource;
  /** ms, `now - captureTime` (a lower bound of the camera -> callback latency); null without a plausible capture time */
  latencyMs: number | null;
}

/**
 * A `captureTime` further back than this from the callback is taken to be in another timebase (browsers have
 * shipped it relative to other origins) and is not used.
 */
export const MAX_CAPTURE_AGE_MS = 1000;
/**
 * A mapped time this far behind the callback means the source jumped (a restarted stream, a clock that stepped):
 * the clock re-anchors. A frame's own lag is a few tens of ms; a frame the main thread kept waiting is still the
 * latest one when the callback runs, so its mapped time is not far behind.
 */
export const REANCHOR_BEHIND_MS = 250;
/**
 * How fast the offset may creep upwards, ms per ms (0.5 ms per second): follows a camera clock that runs slow
 * against the page's without stepping; one that runs fast is followed at once by the minimum.
 */
export const OFFSET_CREEP = 0.5 / 1000;

/**
 * Turns `requestVideoFrameCallback`'s `(now, metadata)` into ONE time per frame for the pose pipeline (the model's
 * timestamp, the smoothing, the detectors, the session, the recordings), plus what telemetry needs.
 *
 * `t = src + offset`, `src` the frame's own clock (`captureTime`, else `mediaTime`), `offset` the smallest
 * `now - src` seen so far, allowed to creep upwards slowly (`OFFSET_CREEP`). So `t` is the earliest the frame could
 * have reached the page: the callback's jitter (sigma 6-7 ms measured) is gone, the intervals between frames are the
 * camera's own, and `t` stays in the `performance.now()` timebase (`t <= now`), so freshness checks against the
 * render ticker's clock still hold. Raw `captureTime` is not used as the time: it would shift every freshness
 * threshold by the camera's unknown latency.
 *
 * Without metadata (the `requestAnimationFrame` fallback) `t = now`, as before. The output is strictly increasing
 * across `reset()` too (MediaPipe's `detectForVideo` requires it): a time not past the previous one becomes the
 * previous one + 1 ms.
 *
 * Pure: no DOM access, so it can move into a Worker with the model.
 */
export class FrameClock {
  private offset = NaN;
  private kind: FrameSource | null = null;
  private lastSrc = NaN;
  private lastNow = NaN;
  private lastPresented = -1;
  private lastT = 0;

  /** One frame: `now` is the callback's time (`performance.now()` timebase), `meta` its metadata or null. */
  next(now: number, meta: FrameMeta | null): FrameTiming {
    const cap = meta?.captureTime;
    const capOk = cap !== undefined && Number.isFinite(cap) && now - cap >= 0 && now - cap <= MAX_CAPTURE_AGE_MS;
    const media = meta?.mediaTime;
    let src = NaN;
    let source: FrameSource = 'callback';
    if (capOk) {
      src = cap;
      source = 'capture';
    } else if (media !== undefined && Number.isFinite(media)) {
      src = media * 1000;
      source = 'media';
    }

    let t: number;
    if (source === 'callback') {
      t = now;
      this.offset = NaN;
    } else {
      const anchored =
        source === this.kind && Number.isFinite(this.offset) && src >= this.lastSrc && src + this.offset >= now - REANCHOR_BEHIND_MS;
      if (anchored) {
        const elapsed = now - this.lastNow;
        if (elapsed > 0) this.offset += OFFSET_CREEP * elapsed;
        if (now - src < this.offset) this.offset = now - src;
      } else {
        this.offset = now - src;
      }
      t = src + this.offset;
      this.lastSrc = src;
    }
    this.kind = source;
    this.lastNow = now;

    if (t <= this.lastT) t = this.lastT + 1;
    this.lastT = t;

    const pf = meta?.presentedFrames;
    let dropped: number | null = null;
    if (pf !== undefined && Number.isFinite(pf)) {
      dropped = this.lastPresented >= 0 && pf > this.lastPresented ? pf - this.lastPresented - 1 : 0;
      this.lastPresented = pf;
    } else {
      this.lastPresented = -1;
    }

    return { t, dropped, source, latencyMs: capOk ? now - cap : null };
  }

  /** The camera stopped: the next frame re-anchors and counts no drops (the times stay increasing). */
  reset() {
    this.offset = NaN;
    this.kind = null;
    this.lastSrc = NaN;
    this.lastNow = NaN;
    this.lastPresented = -1;
  }
}
