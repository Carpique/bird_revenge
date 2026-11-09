import { FilesetResolver, PoseLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision';
import { config } from '../config';
import { FrameLoop, type LoopEnv } from './FrameLoop';
import { PoseSmoother } from './PoseSmoother';
import { TrackingStats } from './trackingStats';
import type { PoseFrame } from './types';

const MODEL_URL = (variant: string) =>
  `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${variant}/float16/1/pose_landmarker_${variant}.task`;

const N = 33;

/**
 * Runs MediaPipe Pose on every new video frame and emits smoothed landmarks.
 * Emits `null` when no person is detected.
 */
export class PoseTracker {
  onFrame: (frame: PoseFrame | null) => void = () => {};
  /** pose frames processed per second (for the debug panel) */
  fps = 0;
  /** ms spent in the last detect call */
  inferenceMs = 0;
  /** MediaPipe's own landmarks for the frame `onFrame` gets, before smoothing (with z and visibility); null: nobody */
  raw: NormalizedLandmark[] | null = null;
  /** the arm stand-in and the smoothing; `smoother.occlusion.standIn` says how much an arm is stood in for, for the last frame */
  readonly smoother = new PoseSmoother();
  /** local telemetry: null runs, hitches, inference times, delegate in use (debug panel) */
  readonly stats = new TrackingStats();

  private lastTs = 0;
  private readonly loop: FrameLoop;
  /** exceptions logged so far (the first few, then ever fewer: a failure on every frame must not flood the console) */
  private logged = 0;
  private fpsCount = 0;
  private fpsT0 = performance.now();

  private constructor(
    private landmarker: PoseLandmarker,
    private video: HTMLVideoElement,
    fellBack: boolean,
    /** the clock and timers of the frame loop (tests pass fakes) */
    loopEnv?: LoopEnv,
  ) {
    this.loop = new FrameLoop(
      video,
      () => this.process(),
      {
        onError: (e) => this.report('frame', e),
        onWatchdog: (ms) => {
          this.stats.watchdog();
          console.warn(`pose loop: no frame for ${ms.toFixed(0)} ms while the video plays, armed again`);
        },
      },
      loopEnv,
    );
    this.stats.info = { model: config.pose.model, requested: config.pose.delegate, delegate: fellBack ? 'CPU' : config.pose.delegate, fellBack };
  }

  static async create(video: HTMLVideoElement): Promise<PoseTracker> {
    const fileset = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}mediapipe/wasm`);
    const make = (delegate: 'GPU' | 'CPU') =>
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL(config.pose.model), delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
      });
    let landmarker: PoseLandmarker;
    let fellBack = false;
    try {
      landmarker = await make(config.pose.delegate);
    } catch (e) {
      console.warn('GPU delegate failed, falling back to CPU', e);
      landmarker = await make('CPU');
      fellBack = config.pose.delegate !== 'CPU';
    }
    return new PoseTracker(landmarker, video, fellBack);
  }

  start() {
    this.loop.start();
  }

  stop() {
    this.loop.stop();
    this.stats.interrupt(); // the pause is no hitch
  }

  /**
   * Forget the person being tracked and look for one afresh on the next frame (like covering the camera for a
   * moment): MediaPipe otherwise keeps following whoever it found first, even someone else at the edge of the
   * picture. Rebuilding the graph with the options unchanged does that, without loading the model again.
   */
  redetect() {
    this.landmarker.setOptions({}).catch((e) => console.warn('pose tracker reset failed', e));
    this.smoother.reset();
  }

  /** counts an exception and logs it (the first 5, then the 10th, 100th...) */
  private report(kind: 'detect' | 'frame', e: unknown) {
    this.stats.error(kind, e);
    const n = ++this.logged;
    if (n <= 5 || Number.isInteger(Math.log10(n))) console.warn(`pose ${kind} failed (${n} so far)`, e);
  }

  /** One video frame; false: there was none to take. An exception in the model or in `onFrame` is counted, the frame dropped. */
  private process(): boolean {
    const video = this.video;
    if (video.readyState < 2 || video.videoWidth === 0) return false;
    let ts = performance.now();
    if (ts <= this.lastTs) ts = this.lastTs + 1;
    this.lastTs = ts;

    const t0 = performance.now();
    let result: ReturnType<PoseLandmarker['detectForVideo']>;
    try {
      result = this.landmarker.detectForVideo(video, ts);
    } catch (e) {
      this.report('detect', e);
      return true;
    }
    this.inferenceMs = performance.now() - t0;

    this.fpsCount++;
    if (ts - this.fpsT0 >= 1000) {
      this.fps = (this.fpsCount * 1000) / (ts - this.fpsT0);
      this.fpsCount = 0;
      this.fpsT0 = ts;
    }

    try {
      const raw = result.landmarks?.[0];
      this.raw = raw && raw.length >= N ? raw : null;
      this.stats.frame(ts, this.inferenceMs, this.raw !== null);
      // nobody: the smoothing is left as it is, a short gap does not interrupt it (`PoseSmoother`)
      const aspect = video.videoWidth / video.videoHeight;
      const lm = this.smoother.process(this.raw, aspect, ts);
      this.onFrame(lm && { t: ts, lm, aspect });
    } catch (e) {
      this.report('frame', e);
    }
    return true;
  }
}
