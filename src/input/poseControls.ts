import { config } from '../config';
import { FlapDetector, type FlapOutput } from '../gestures/FlapDetector';
import { PointingDetector, type PointingOutput } from '../gestures/PointingDetector';
import { ShootDetector, type ShootOutput } from '../gestures/ShootDetector';
import { TiltDetector, type TiltOutput } from '../gestures/TiltDetector';
import { VisibilityMonitor, type VisibilityOutput } from '../gestures/VisibilityMonitor';
import type { PoseFrame } from '../pose/types';
import type { Controls } from './controls';

/** Pose controls older than this (ms) no longer apply: the bird gets no controls until a fresh frame arrives. */
export const POSE_STALE_MS = 300;

/** What the gesture detectors made of one pose frame; the detectors' outputs are null without a person in view. */
export interface PoseReading {
  vis: VisibilityOutput;
  flap: FlapOutput | null;
  shoot: ShootOutput | null;
  tilt: TiltOutput | null;
  pointing: PointingOutput | null;
}

/**
 * The visibility monitor and all gesture detectors, fed pose frames one by one: the same pipeline for the live
 * game and for a recorded pose stream played back (the instructions page). Calibrate `shoot` before use.
 */
export class PoseDetectors {
  readonly visibility = new VisibilityMonitor();
  readonly flap = new FlapDetector();
  readonly shoot = new ShootDetector();
  readonly tilt = new TiltDetector();
  readonly pointing = new PointingDetector();

  /** `now`: ms, in the frames' time. Run on every frame, so the detectors' state stays continuous. */
  update(f: PoseFrame | null, now: number): PoseReading {
    const vis = this.visibility.update(f, now);
    if (!f) return { vis, flap: null, shoot: null, tilt: null, pointing: null };
    const left = vis.parts.leftArm.visible, right = vis.parts.rightArm.visible;
    const flap = this.flap.update(f, left, right);
    const shoot = this.shoot.update(f, vis.parts.torso.visible);
    const tilt = this.tilt.update(f, left, right, flap);
    const pointing = this.pointing.update(f, left, right);
    return { vis, flap, shoot, tilt, pointing };
  }
}

/**
 * The controls a reading asks for (null: no person in view). `byPointing`: pointing control, which replaces
 * flapping, tilt and hover; the wings still follow the arms.
 */
export function controlsFrom(r: PoseReading, byPointing = !config.pointing.flapping): Controls | null {
  const { flap, tilt, pointing } = r;
  if (!flap || !tilt || !pointing) return null;
  return {
    lift: byPointing ? 0 : flap.lift,
    tilt: byPointing ? 0 : tilt.tilt,
    hover: byPointing ? 0 : tilt.hold,
    wingPhase: flap.wingPhase,
    flapping: false,
    pointing: byPointing ? pointing.intent : null,
  };
}
