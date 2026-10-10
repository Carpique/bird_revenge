import { config } from '../config';
import type { PoseFrame } from '../pose/types';
import { hipCenter, kneeAngle, torsoLength } from './geometry';

export interface SquatBaseline {
  /** standing hip-centre y (normalised image units) */
  hipY: number;
  /** standing torso length (normalised image units) */
  torso: number;
}

export interface SquatOutput {
  /** hip drop below standing, in torso lengths (0 standing, ~0.5+ deep squat) */
  depth: number;
  kneeLeft: number;
  kneeRight: number;
  squatting: boolean;
  /** true on the single frame the squat is entered (and cooldown allowed it) → drop a poo */
  triggered: boolean;
}

/**
 * Heuristic squat detector with hysteresis: enter when hips drop AND knees bend,
 * leave when back up. Fires once per squat.
 */
export class SquatDetector {
  baseline: SquatBaseline | null = null;
  private squatting = false;
  private lastTrigger = -Infinity;

  calibrate(b: SquatBaseline) {
    this.baseline = { ...b };
    this.squatting = false;
  }

  update(f: PoseFrame, legsVisible: boolean): SquatOutput {
    const cfg = config.squat;
    const kneeLeft = kneeAngle(f, 'left');
    const kneeRight = kneeAngle(f, 'right');
    const out: SquatOutput = { depth: 0, kneeLeft, kneeRight, squatting: this.squatting, triggered: false };
    const b = this.baseline;
    if (!b || !legsVisible) return out;

    const hipY = hipCenter(f).y;
    const depth = (hipY - b.hipY) / b.torso;
    out.depth = depth;
    const kneesBent = kneeLeft < cfg.kneeAngleEnter && kneeRight < cfg.kneeAngleEnter;
    const kneesStraight = kneeLeft > cfg.kneeAngleExit && kneeRight > cfg.kneeAngleExit;

    if (!this.squatting) {
      if (depth > cfg.hipDropEnter && (!cfg.requireBentKnees || kneesBent)) {
        this.squatting = true;
        if (f.t - this.lastTrigger >= cfg.cooldownMs) {
          out.triggered = true;
          this.lastTrigger = f.t;
        }
      } else if (kneesStraight && Math.abs(depth) < cfg.hipDropExit) {
        // standing straight: slowly re-learn the baseline (player may drift closer/further)
        const k = cfg.baselineAdaptRate;
        b.hipY += k * (hipY - b.hipY);
        b.torso += k * (torsoLength(f) - b.torso);
      }
    } else if (depth < cfg.hipDropExit && (!cfg.requireBentKnees || !kneesBent)) {
      this.squatting = false;
    }
    out.squatting = this.squatting;
    return out;
  }
}
