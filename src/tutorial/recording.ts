import type { ShootBaseline } from '../gestures/ShootDetector';
import type { ArmNoise } from '../pose/armSmoothing';
import type { PoseFrame } from '../pose/types';

/** The level the instructions page plays its demonstration in, and the name of its recording. */
export const TUTORIAL_LEVEL = 'control-tutorial';

/**
 * One recorded pose frame: ms from the recording's first frame; per landmark [x, y, visibility] (image coordinates,
 * not mirrored), plus MediaPipe's depth z in recordings of the raw stream (`BlackBox`; the arm stand-in compares the
 * wrists' depths); null: nobody in view.
 */
export interface RecordedFrame {
  t: number;
  lm: [number, number, number, number?][] | null;
}

/**
 * A recorded pose stream (`src/tutorial/<level>.json`, made with the dev-only recorder, `src/dev/`), played back
 * through the gesture detectors to fly the bird in the instructions' demonstration.
 */
export interface PoseRecording {
  version: 1;
  /** the level it was recorded in */
  level: string;
  /** the camera image's width / height */
  aspect: number;
  /** recorded with flapping control (`config.pointing.flapping`), not pointing */
  flapping: boolean;
  /** the standing hip angles from the calibration, for the shoot detector */
  baseline: ShootBaseline | null;
  /** the arms' noise measured at that calibration (`smoothing.arms` = auto); absent or null: not measured (older dumps) */
  armNoise?: ArmNoise | null;
  /**
   * calibrations during the recording (ms, in the frames' time): the shoot detector takes the new baseline from there
   * on, and the arms' smoothing the noise measured with it (absent: not measured)
   */
  calibrations?: { t: number; baseline: ShootBaseline; armNoise?: ArmNoise | null }[];
  /** the clip played: from here (ms; the frames before it only warm the detectors up)... */
  startMs: number;
  /** ...to here */
  endMs: number;
  frames: RecordedFrame[];
}

/** `f` as the detectors take it. */
export function toPoseFrame(f: RecordedFrame, aspect: number): PoseFrame | null {
  return f.lm && { t: f.t, lm: f.lm.map(([x, y, v, z]) => (z === undefined ? { x, y, v } : { x, y, v, z })), aspect };
}

/** `f` for the recording: coordinates to 4 decimals, visibility to 2, so the file stays small. */
export function toRecordedFrame(f: PoseFrame | null, t: number): RecordedFrame {
  return { t: Math.round(t), lm: f && f.lm.map((p) => [round(p.x, 4), round(p.y, 4), round(p.v, 2)]) };
}

const round = (x: number, digits: number) => Math.round(x * 10 ** digits) / 10 ** digits;
