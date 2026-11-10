import { config } from '../config';
import type { FrameSource, FrameTiming } from './FrameClock';

/** Upper bounds (ms, exclusive) of the null-run histogram buckets; the last bucket is open-ended. */
export const NULL_RUN_BUCKETS_MS = [100, 250, 500, 1000, 3000] as const;
/** Labels of the buckets, for the debug panel. */
export const NULL_RUN_LABELS = ['<100', '100-250', '250-500', '0.5-1s', '1-3s', '>3s'] as const;

/** Why the game went back to the big calibration dialog. */
export type RecalCause = 'noPerson' | 'offCentre' | 'manual';
export const RECAL_CAUSES: RecalCause[] = ['noPerson', 'offCentre', 'manual'];

/** How many inference times are kept for the percentiles (the last ~8 s at 30 fps). */
const INFERENCE_WINDOW = 256;
/** The recent window of the drop and long-render rates: the last this many whole seconds (and the one under way). */
export const RECENT_S = 10;

/** Two counts per second over the last `RECENT_S` seconds, in fixed buckets (no allocation). */
class RecentCounts {
  private readonly sec = new Float64Array(RECENT_S).fill(-Infinity);
  private readonly a = new Uint32Array(RECENT_S);
  private readonly b = new Uint32Array(RECENT_S);
  private latest = -Infinity;

  add(t: number, a: number, b: number) {
    const s = Math.floor(t / 1000);
    const k = ((s % RECENT_S) + RECENT_S) % RECENT_S;
    if (this.sec[k] !== s) {
      this.sec[k] = s;
      this.a[k] = this.b[k] = 0;
    }
    this.a[k] += a;
    this.b[k] += b;
    if (s > this.latest) this.latest = s;
  }

  /** `b / (a + b)` over the window (`share`), or `b / a` (`ratio`); 0 when empty */
  rate(kind: 'share' | 'ratio'): number {
    let a = 0;
    let b = 0;
    for (let k = 0; k < RECENT_S; k++) {
      if (this.sec[k] > this.latest - RECENT_S) {
        a += this.a[k];
        b += this.b[k];
      }
    }
    const d = kind === 'share' ? a + b : a;
    return d > 0 ? b / d : 0;
  }

  /** the second count over the window */
  count(): number {
    let b = 0;
    for (let k = 0; k < RECENT_S; k++) if (this.sec[k] > this.latest - RECENT_S) b += this.b[k];
    return b;
  }

  clear() {
    this.sec.fill(-Infinity);
    this.a.fill(0);
    this.b.fill(0);
    this.latest = -Infinity;
  }
}

/** What the tracker was built with. */
export interface TrackerInfo {
  model: string;
  /** the delegate asked for... */
  requested: string;
  /** ...and the one in use (CPU after the GPU one failed to start) */
  delegate: string;
  fellBack: boolean;
}

/** Why the player is off the frame: the first required body part that is not visible, else 'other'. */
export function outOfFrameCause(vis: { parts: Record<string, { visible: boolean }> }, required: readonly string[]): string {
  for (const p of required) if (!vis.parts[p]?.visible) return p;
  return 'other';
}

/** Why a recalibration after the player is gone: somebody detected but away from the middle, or nobody. */
export const recalCause = (vis: { personDetected: boolean }): RecalCause => (vis.personDetected ? 'offCentre' : 'noPerson');

/**
 * Local tracking telemetry, for the debug panel (and nothing else: it never leaves the device). Counts what the
 * audit found hard to see: runs of frames without a person (how long), hitches (the camera / model not delivering
 * for a while, with no empty frame to show for it), recalibrations and out-of-frame episodes by cause, the processed
 * frame rate and the time per inference (median and 95th percentile); camera frames the game never saw (from the
 * frame metadata's `presentedFrames`: the camera delivers 30 fps, the game processed 23-25 while inference kept the
 * main thread busy), the camera's own frame rate, the frame-time source and capture latency; render frames longer
 * than `config.telemetry.longRenderMs`.
 *
 * Fed by `PoseTracker` (`frame`) and `main.ts` (the episodes, `renderTick`); no allocation per frame.
 */
export class TrackingStats {
  /** frames processed since the start */
  frames = 0;
  /** frames with no person */
  nullFrames = 0;
  /** finished runs of null frames per bucket (`NULL_RUN_BUCKETS_MS`), and the longest run, ms */
  readonly nullRuns = new Uint32Array(NULL_RUN_BUCKETS_MS.length + 1);
  longestNullMs = 0;
  /** gaps between two processed frames with a person in both, longer than `config.telemetry.hitchMs` */
  hitches = 0;
  longestHitchMs = 0;
  readonly recalibrations: Record<RecalCause, number> = { noPerson: 0, offCentre: 0, manual: 0 };
  /** episodes of the player being out of frame, by the body part that was missing */
  readonly outOfFrame: Record<string, number> = {};
  /** exceptions caught in the frame loop: in the model's detect call, and after it (smoothing, `onFrame`); the loop carries on */
  readonly errors = { detect: 0, frame: 0 };
  /** the message of the latest one ('' for none) */
  lastError = '';
  /** times the watchdog found the frame loop dead while the video played, and armed it again */
  watchdogRearms = 0;
  /** processed frames per second, over the last second or so */
  fps = 0;
  /** camera frames per second (processed + dropped), over the same second; 0 while it is unknown (no metadata) */
  cameraFps = 0;
  /** camera frames presented that the game never saw, since the start (frames with metadata only) */
  droppedFrames = 0;
  /** processed frames whose drop count is known (they came with metadata) */
  metaFrames = 0;
  /** where the last frame's time came from (`FrameClock`); null before the first frame */
  source: FrameSource | null = null;
  /** the last frame came with metadata (false: the `requestAnimationFrame` fallback, drops cannot be seen) */
  hasMeta = false;
  /** render frames timed, and those longer than `config.telemetry.longRenderMs`; the longest, ms */
  renderFrames = 0;
  longRenderFrames = 0;
  longestRenderMs = 0;
  /** what the tracker runs on; null until it exists */
  info: TrackerInfo | null = null;

  private lastT = -1;
  private lastHadPose = true;
  /** start of the null run in progress, or -1 */
  private nullSince = -1;
  private fpsCount = 0;
  private fpsT0 = -1;
  private readonly inference = new Float32Array(INFERENCE_WINDOW);
  private inferenceN = 0;
  private readonly latency = new Float32Array(INFERENCE_WINDOW);
  private latencyN = 0;
  private scratch = new Float32Array(INFERENCE_WINDOW);
  private camCount = 0;
  private camKnown = true;
  private readonly recentDrops = new RecentCounts();
  private readonly recentRender = new RecentCounts();
  /** the previous render tick, or -1 (none yet, or the render loop was paused since) */
  private lastRenderT = -1;

  /**
   * `t`: ms, the frame's time; `inferenceMs`: time spent in the detect call; `hadPose`: a person was found; `timing`:
   * the frame clock's view of it (drops, source, capture latency), absent: unknown.
   */
  frame(t: number, inferenceMs: number, hadPose: boolean, timing?: Pick<FrameTiming, 'dropped' | 'source' | 'latencyMs'>) {
    this.frames++;
    this.inference[this.inferenceN++ % INFERENCE_WINDOW] = inferenceMs;
    const dropped = timing?.dropped ?? null;
    this.source = timing?.source ?? null;
    this.hasMeta = dropped !== null;
    if (dropped !== null) {
      this.metaFrames++;
      this.droppedFrames += dropped;
      this.recentDrops.add(t, 1, dropped);
    }
    if (timing?.latencyMs != null) this.latency[this.latencyN++ % INFERENCE_WINDOW] = timing.latencyMs;

    if (this.fpsT0 < 0) {
      this.fpsT0 = t;
      this.camCount = 0;
      this.camKnown = true;
    }
    this.fpsCount++;
    // the camera's frames, as the processed ones are counted: this one and those it missed since the previous one
    this.camCount += 1 + (dropped ?? 0);
    if (dropped === null) this.camKnown = false;
    if (t - this.fpsT0 >= 1000) {
      this.fps = (this.fpsCount * 1000) / (t - this.fpsT0);
      this.cameraFps = this.camKnown ? (this.camCount * 1000) / (t - this.fpsT0) : 0;
      this.fpsCount = 0;
      this.fpsT0 = t;
      this.camCount = 0;
      this.camKnown = true;
    }

    if (this.lastT >= 0 && hadPose && this.lastHadPose) {
      const gap = t - this.lastT;
      if (gap > config.telemetry.hitchMs) {
        this.hitches++;
        if (gap > this.longestHitchMs) this.longestHitchMs = gap;
      }
    }
    if (!hadPose) {
      this.nullFrames++;
      if (this.nullSince < 0) this.nullSince = this.lastHadPose && this.lastT >= 0 ? this.lastT : t;
    } else if (this.nullSince >= 0) {
      this.endNullRun(t - this.nullSince);
    }
    this.lastT = t;
    this.lastHadPose = hadPose;
  }

  /**
   * One render frame (the Pixi ticker, `performance.now()`): the interval since the previous one, when longer than
   * `config.telemetry.longRenderMs`, is a long render frame (the main thread busy, e.g. with inference).
   */
  renderTick(now: number) {
    const last = this.lastRenderT;
    this.lastRenderT = now;
    if (last < 0 || now <= last) return;
    const ms = now - last;
    const long = ms > config.telemetry.longRenderMs;
    this.renderFrames++;
    if (long) {
      this.longRenderFrames++;
      if (ms > this.longestRenderMs) this.longestRenderMs = ms;
    }
    this.recentRender.add(now, 1, long ? 1 : 0);
  }

  /** The render loop stops on purpose (paused, suspended, hidden): the gap until the next tick is no long frame. */
  renderPaused() {
    this.lastRenderT = -1;
  }

  /** Share of the camera's frames the game never saw, over the session and over the last ~`RECENT_S` seconds. */
  dropShare(): { total: number; recent: number } {
    const all = this.metaFrames + this.droppedFrames;
    return { total: all > 0 ? this.droppedFrames / all : 0, recent: this.recentDrops.rate('share') };
  }

  /** Long render frames over the last ~`RECENT_S` seconds: how many, and their share of the render frames. */
  recentLongRender(): { count: number; share: number } {
    return { count: this.recentRender.count(), share: this.recentRender.rate('ratio') };
  }

  /** Median capture latency (callback time - `captureTime`, a lower bound) of the last frames, ms; null: never given. */
  latencyMs(): number | null {
    const n = Math.min(this.latencyN, INFERENCE_WINDOW);
    if (n === 0) return null;
    const s = this.scratch.subarray(0, n);
    s.set(this.latency.subarray(0, n));
    s.sort();
    return s[Math.floor((n - 1) * 0.5)];
  }

  /** Frames stop coming on purpose (the camera is switched off): the gap after it is neither a hitch nor a null run. */
  interrupt() {
    this.lastT = -1;
    this.lastHadPose = true;
    this.nullSince = -1;
    this.fpsT0 = -1;
    this.fpsCount = 0;
    this.camCount = 0;
    this.camKnown = true;
  }

  /** How long the null run in progress has lasted, ms (0 when there is none). */
  currentNullMs(now: number): number {
    return this.nullSince >= 0 ? now - this.nullSince : 0;
  }

  /** An exception in the frame loop (`kind`: where it came from). */
  error(kind: 'detect' | 'frame', e: unknown) {
    this.errors[kind]++;
    this.lastError = `${kind}: ${e instanceof Error ? e.message : String(e)}`;
  }

  /** The watchdog armed the frame loop again. */
  watchdog() {
    this.watchdogRearms++;
  }

  recalibration(cause: RecalCause) {
    this.recalibrations[cause]++;
  }

  outOfFrameEpisode(cause: string) {
    this.outOfFrame[cause] = (this.outOfFrame[cause] ?? 0) + 1;
  }

  /** Median and 95th percentile of the last inference times, ms (0, 0 before the first frame). */
  inferenceMs(): { p50: number; p95: number } {
    const n = Math.min(this.inferenceN, INFERENCE_WINDOW);
    if (n === 0) return { p50: 0, p95: 0 };
    const s = this.scratch.subarray(0, n);
    s.set(this.inference.subarray(0, n));
    s.sort();
    return { p50: s[Math.floor((n - 1) * 0.5)], p95: s[Math.floor((n - 1) * 0.95)] };
  }

  /** Every count and the percentiles back to zero (`info` stays). */
  reset() {
    this.frames = this.nullFrames = this.hitches = 0;
    this.longestNullMs = this.longestHitchMs = 0;
    this.nullRuns.fill(0);
    this.errors.detect = this.errors.frame = this.watchdogRearms = 0;
    this.lastError = '';
    for (const k of RECAL_CAUSES) this.recalibrations[k] = 0;
    for (const k of Object.keys(this.outOfFrame)) delete this.outOfFrame[k];
    this.inferenceN = this.latencyN = 0;
    this.droppedFrames = this.metaFrames = 0;
    this.source = null;
    this.hasMeta = false;
    this.recentDrops.clear();
    this.renderFrames = this.longRenderFrames = this.longestRenderMs = 0;
    this.recentRender.clear();
    this.lastRenderT = -1;
    this.interrupt();
    this.fps = this.cameraFps = 0;
  }

  private endNullRun(ms: number) {
    let b = 0;
    while (b < NULL_RUN_BUCKETS_MS.length && ms >= NULL_RUN_BUCKETS_MS[b]) b++;
    this.nullRuns[b]++;
    if (ms > this.longestNullMs) this.longestNullMs = ms;
    this.nullSince = -1;
  }
}
