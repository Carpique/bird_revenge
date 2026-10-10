import { config } from '../config';
import type { PoseFrame } from '../pose/types';
import { hipAbduction, type Side } from './geometry';

export interface ShootBaseline {
  /** standing hip abduction per leg, degrees (legs are rarely exactly in line with the torso) */
  left: number;
  right: number;
}

export interface ShootOutput {
  /** hip abduction above the standing baseline, degrees, per leg (the player's own side) */
  left: number;
  right: number;
  /** the larger of the two: what is compared against the thresholds */
  angle: number;
  shooting: boolean;
  /** true on the single frame the shoot is entered (and cooldown allowed it) → drop a poo */
  triggered: boolean;
  /** which leg is raised (the player's own side), or null when both are out about equally */
  raisedLeg: Side | null;
}

/**
 * "Shoot" pose detector with hysteresis: a leg raised sideways. Uses only the hip angles (thigh vs.
 * torso axis), which need just the hips and knees; when the legs are out of frame MediaPipe still
 * places the knees, and a leg swung out shows in the hips. Angles are taken relative to the standing
 * baseline recorded at calibration. Either leg out past `angleEnter` fires; `raisedLeg` tells which
 * one when they differ by more than `legRaiseMin` (two legs out, e.g. a wide squat, gives null).
 * Fires once per shoot.
 */
export class ShootDetector {
  baseline: ShootBaseline | null = null;
  private shooting = false;
  private lastTrigger = -Infinity;

  calibrate(b: ShootBaseline) {
    this.baseline = { ...b };
    this.shooting = false;
  }

  update(f: PoseFrame, hipsVisible: boolean): ShootOutput {
    const cfg = config.shoot;
    const rawLeft = hipAbduction(f, 'left');
    const rawRight = hipAbduction(f, 'right');
    const b = this.baseline ?? { left: 0, right: 0 };
    const left = rawLeft - b.left;
    const right = rawRight - b.right;
    const angle = Math.max(left, right);
    const diff = left - right;
    const raisedLeg = diff > cfg.legRaiseMin ? 'left' : diff < -cfg.legRaiseMin ? 'right' : null;
    const out: ShootOutput = { left, right, angle, shooting: this.shooting, triggered: false, raisedLeg };
    if (!this.baseline || !hipsVisible) return out;

    if (!this.shooting) {
      if (angle > cfg.angleEnter) {
        this.shooting = true;
        if (f.t - this.lastTrigger >= cfg.cooldownMs) {
          out.triggered = true;
          this.lastTrigger = f.t;
        }
      } else if (Math.abs(left) < cfg.angleExit && Math.abs(right) < cfg.angleExit) {
        // standing: slowly re-learn the baseline (stance and camera angle drift a little)
        const k = cfg.baselineAdaptRate;
        b.left += k * (rawLeft - b.left);
        b.right += k * (rawRight - b.right);
      }
    } else if (angle < cfg.angleExit) {
      this.shooting = false;
    }
    out.shooting = this.shooting;
    return out;
  }
}
