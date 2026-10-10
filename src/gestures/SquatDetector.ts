import { config } from '../config';
import type { PoseFrame } from '../pose/types';
import { L } from '../pose/landmarks';
import { hipHeight, kneeAngle, thighDrop, torsoLength } from './geometry';

export interface SquatBaseline {
  /** standing torso length (normalised image units) */
  torso: number;
  /** standing vertical hip→knee distance divided by torso length */
  thigh: number;
  /** standing vertical hip→ankle distance divided by torso length */
  legs: number;
}

export interface SquatOutput {
  /** how far the hips have come down towards knee level: 0 standing, 1 hips level with knees */
  depth: number;
  kneeLeft: number;
  kneeRight: number;
  squatting: boolean;
  /** true on the single frame the squat is entered (and cooldown allowed it) → drop a poo */
  triggered: boolean;
  /** which leg is raised (the player's own side), or null for a two-footed squat */
  raisedLeg: 'left' | 'right' | null;
}

/**
 * Heuristic squat detector with hysteresis. Depth = how far the hips have dropped towards the feet
 * (which stay put), in units of the standing hip→knee height, so hips level with the knees reads ~1.
 * Measured against the ankles rather than the knees: the knees move towards the camera in a squat,
 * which (camera above knee height) makes them look lower and hides part of the hip drop.
 * Everything is relative to torso length, so stepping closer to / further from the camera doesn't
 * change it. Knee angles are only reported: in a frontal view the 2D angle barely changes.
 * Raising one leg also lifts the ankle centre and counts as a squat; `raisedLeg` tells which.
 * Fires once per squat.
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
    // ankle height difference in torso lengths: > 0 when the left ankle is higher (image y grows downwards)
    const ankleDiff = (f.lm[L.rightAnkle].y - f.lm[L.leftAnkle].y) / torsoLength(f);
    const raisedLeg = ankleDiff > cfg.legRaiseMin ? 'left' : ankleDiff < -cfg.legRaiseMin ? 'right' : null;
    const out: SquatOutput = { depth: 0, kneeLeft, kneeRight, squatting: this.squatting, triggered: false, raisedLeg };
    const b = this.baseline;
    if (!b || !legsVisible) return out;

    const torso = torsoLength(f);
    const legs = hipHeight(f) / torso;
    const depth = (b.legs - legs) / b.thigh;
    out.depth = depth;

    if (!this.squatting) {
      if (depth > cfg.depthEnter) {
        this.squatting = true;
        if (f.t - this.lastTrigger >= cfg.cooldownMs) {
          out.triggered = true;
          this.lastTrigger = f.t;
        }
      } else if (Math.abs(depth) < cfg.depthExit) {
        // standing: slowly re-learn the baseline (posture and camera angle drift a little)
        const k = cfg.baselineAdaptRate;
        b.legs += k * (legs - b.legs);
        b.thigh += k * (thighDrop(f) / torso - b.thigh);
        b.torso += k * (torso - b.torso);
      }
    } else if (depth < cfg.depthExit) {
      this.squatting = false;
    }
    out.squatting = this.squatting;
    return out;
  }
}
