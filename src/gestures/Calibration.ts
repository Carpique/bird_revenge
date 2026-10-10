import { config } from '../config';
import { L } from '../pose/landmarks';
import type { PoseFrame } from '../pose/types';
import { hipCenter, hipHeight, kneeAngle, thighDrop, torsoLength } from './geometry';
import type { SquatBaseline } from './SquatDetector';
import type { VisibilityOutput } from './VisibilityMonitor';

export interface CalibrationStatus {
  /** 0..1 progress of the "hold still" phase */
  progress: number;
  /** what the player should do now */
  message: string;
  done: SquatBaseline | null;
}

/**
 * Calibration: player stands in the outline, fully visible, arms lowered, legs straight,
 * and holds still. We then record standing torso length, hip→knee and hip→ankle height.
 */
export class Calibration {
  private holdStart: number | null = null;
  private samples: { hipY: number; torso: number; thigh: number; legs: number }[] = [];

  reset() {
    this.holdStart = null;
    this.samples = [];
  }

  update(f: PoseFrame | null, vis: VisibilityOutput): CalibrationStatus {
    const cfg = config.calibration;
    const fail = (message: string): CalibrationStatus => {
      this.reset();
      return { progress: 0, message, done: null };
    };
    if (!f || !vis.allVisible) return fail(vis.hint ?? 'Get fully into view');

    const lm = f.lm;
    if (cfg.requireArmsDown) {
      const armsDown = lm[L.leftWrist].y > lm[L.leftShoulder].y && lm[L.rightWrist].y > lm[L.rightShoulder].y;
      if (!armsDown) return fail('Lower your arms like the outline');
    }
    if (kneeAngle(f, 'left') < 160 || kneeAngle(f, 'right') < 160) return fail('Stand up straight');

    const torso = torsoLength(f);
    const sample = { hipY: hipCenter(f).y, torso, thigh: thighDrop(f) / torso, legs: hipHeight(f) / torso };
    if (this.samples.length) {
      const first = this.samples[0];
      if (Math.abs(sample.hipY - first.hipY) / first.torso > cfg.maxMovement) {
        this.reset();
        return { progress: 0, message: 'Hold still…', done: null };
      }
    }
    this.holdStart ??= f.t;
    this.samples.push(sample);
    const progress = Math.min(1, (f.t - this.holdStart) / cfg.holdMs);
    if (progress < 1) return { progress, message: 'Hold still…', done: null };

    const n = this.samples.length;
    const done = {
      torso: this.samples.reduce((s, x) => s + x.torso, 0) / n,
      thigh: this.samples.reduce((s, x) => s + x.thigh, 0) / n,
      legs: this.samples.reduce((s, x) => s + x.legs, 0) / n,
    };
    this.reset();
    return { progress: 1, message: 'Great!', done };
  }
}
