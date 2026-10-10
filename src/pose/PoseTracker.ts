import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { config } from '../config';
import { OneEuroFilter } from './OneEuroFilter';
import type { Landmark, PoseFrame } from './types';

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

  private filters: OneEuroFilter[] = [];
  private lastTs = 0;
  private running = false;
  private fpsCount = 0;
  private fpsT0 = performance.now();

  private constructor(
    private landmarker: PoseLandmarker,
    private video: HTMLVideoElement,
  ) {
    for (let i = 0; i < N * 2; i++) this.filters.push(new OneEuroFilter());
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
    try {
      landmarker = await make(config.pose.delegate);
    } catch (e) {
      console.warn('GPU delegate failed, falling back to CPU', e);
      landmarker = await make('CPU');
    }
    return new PoseTracker(landmarker, video);
  }

  start() {
    if (this.running) return;
    this.running = true;
    const v = this.video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
    };
    const loop = () => {
      if (!this.running) return;
      this.process();
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(loop);
      else requestAnimationFrame(loop);
    };
    loop();
  }

  stop() {
    this.running = false;
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
    if (!raw || raw.length < N) {
      this.filters.forEach((f) => f.reset());
      this.onFrame(null);
      return;
    }
    const s = config.smoothing;
    const tSec = ts / 1000;
    const lm: Landmark[] = new Array(N);
    for (let i = 0; i < N; i++) {
      const fx = this.filters[i * 2];
      const fy = this.filters[i * 2 + 1];
      fx.minCutoff = fy.minCutoff = s.minCutoff;
      fx.beta = fy.beta = s.beta;
      fx.dCutoff = fy.dCutoff = s.dCutoff;
      lm[i] = {
        x: fx.filter(raw[i].x, tSec),
        y: fy.filter(raw[i].y, tSec),
        v: raw[i].visibility ?? 0,
      };
    }
    this.onFrame({ t: ts, lm, aspect: video.videoWidth / video.videoHeight });
  }
}
