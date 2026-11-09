import { config } from '../config';

/** Upper bounds (ms, exclusive) of the null-run histogram buckets; the last bucket is open-ended. */
export const NULL_RUN_BUCKETS_MS = [100, 250, 500, 1000, 3000] as const;
/** Labels of the buckets, for the debug panel. */
export const NULL_RUN_LABELS = ['<100', '100-250', '250-500', '0.5-1s', '1-3s', '>3s'] as const;

/** Why the game went back to the big calibration dialog. */
export type RecalCause = 'noPerson' | 'offCentre' | 'manual';
export const RECAL_CAUSES: RecalCause[] = ['noPerson', 'offCentre', 'manual'];

/** How many inference times are kept for the percentiles (the last ~8 s at 30 fps). */
const INFERENCE_WINDOW = 256;

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
 * frame rate and the time per inference (median and 95th percentile).
 *
 * Fed by `PoseTracker` (`frame`) and `main.ts` (the episodes); no allocation per frame.
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
  /** processed frames per second, over the last second or so */
  fps = 0;
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
  private scratch = new Float32Array(INFERENCE_WINDOW);

  /** `t`: ms, the frame's time; `inferenceMs`: time spent in the detect call; `hadPose`: a person was found. */
  frame(t: number, inferenceMs: number, hadPose: boolean) {
    this.frames++;
    this.inference[this.inferenceN++ % INFERENCE_WINDOW] = inferenceMs;

    if (this.fpsT0 < 0) this.fpsT0 = t;
    this.fpsCount++;
    if (t - this.fpsT0 >= 1000) {
      this.fps = (this.fpsCount * 1000) / (t - this.fpsT0);
      this.fpsCount = 0;
      this.fpsT0 = t;
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

  /** Frames stop coming on purpose (the camera is switched off): the gap after it is neither a hitch nor a null run. */
  interrupt() {
    this.lastT = -1;
    this.lastHadPose = true;
    this.nullSince = -1;
    this.fpsT0 = -1;
    this.fpsCount = 0;
  }

  /** How long the null run in progress has lasted, ms (0 when there is none). */
  currentNullMs(now: number): number {
    return this.nullSince >= 0 ? now - this.nullSince : 0;
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
    for (const k of RECAL_CAUSES) this.recalibrations[k] = 0;
    for (const k of Object.keys(this.outOfFrame)) delete this.outOfFrame[k];
    this.inferenceN = 0;
    this.interrupt();
    this.fps = 0;
  }

  private endNullRun(ms: number) {
    let b = 0;
    while (b < NULL_RUN_BUCKETS_MS.length && ms >= NULL_RUN_BUCKETS_MS[b]) b++;
    this.nullRuns[b]++;
    if (ms > this.longestNullMs) this.longestNullMs = ms;
    this.nullSince = -1;
  }
}
