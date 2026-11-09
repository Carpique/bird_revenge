import { FilesetResolver, PoseLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision';
import { config } from '../config';
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
  private running = false;
  /** bumped on every start, so a frame callback left over from before a stop/start ends its loop */
  private generation = 0;
  private fpsCount = 0;
  private fpsT0 = performance.now();

  private constructor(
    private landmarker: PoseLandmarker,
    private video: HTMLVideoElement,
    fellBack: boolean,
  ) {
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
    if (this.running) return;
    this.running = true;
    const gen = ++this.generation;
    const v = this.video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
    };
    const loop = () => {
      if (!this.running || gen !== this.generation) return;
      this.process();
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(loop);
      else requestAnimationFrame(loop);
    };
    loop();
  }

  stop() {
    this.running = false;
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

  private process() {
    const video = this.video;
    if (video.readyState < 2 || video.videoWidth === 0) return;
    let ts = performance.now();
    if (ts <= this.lastTs) ts = this.lastTs + 1;
    this.lastTs = ts;

    const t0 = performance.now();
    const result = this.landmarker.detectForVideo(video, ts);
    this.inferenceMs = performance.now() - t0;

    this.fpsCount++;
    if (ts - this.fpsT0 >= 1000) {
      this.fps = (this.fpsCount * 1000) / (ts - this.fpsT0);
      this.fpsCount = 0;
      this.fpsT0 = ts;
    }

    const raw = result.landmarks?.[0];
    this.raw = raw && raw.length >= N ? raw : null;
    this.stats.frame(ts, this.inferenceMs, this.raw !== null);
    // nobody: the smoothing is left as it is, a short gap does not interrupt it (`PoseSmoother`)
    const aspect = video.videoWidth / video.videoHeight;
    const lm = this.smoother.process(this.raw, aspect, ts);
    this.onFrame(lm && { t: ts, lm, aspect });
  }
}
