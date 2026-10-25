import { config } from '../config';
import { L } from '../pose/landmarks';
import type { PoseFrame } from '../pose/types';
import { hipAbduction, hipCenter, kneeAngle, torsoLength } from './geometry';
import type { ShootBaseline } from './ShootDetector';
import type { VisibilityOutput } from './VisibilityMonitor';
import { t } from '../ui/i18n';

export interface CalibrationStatus {
  /** 0..1 progress of the "hold still" phase */
  progress: number;
  /** what the player should do now */
  message: string;
  done: ShootBaseline | null;
}

/**
 * Calibration: player stands in the outline (at least torso and arms in view), arms lowered, legs
 * straight, and holds still. We then record the standing hip angles.
 */
export class Calibration {
  private holdStart: number | null = null;
  private samples: { hipY: number; torso: number; left: number; right: number }[] = [];

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
    if (!f || !vis.inFrame) return fail(vis.hint ?? t('Get into view'));

    const lm = f.lm;
    if (cfg.requireArmsDown) {
      const armsDown = lm[L.leftWrist].y > lm[L.leftShoulder].y && lm[L.rightWrist].y > lm[L.rightShoulder].y;
      if (!armsDown) return fail(t('Lower your arms like the outline'));
    }
    // off-frame legs are estimated straight, so this only bites when the knees are in view
    if (kneeAngle(f, 'left') < 160 || kneeAngle(f, 'right') < 160) return fail(t('Stand up straight'));

    const sample = { hipY: hipCenter(f).y, torso: torsoLength(f), left: hipAbduction(f, 'left'), right: hipAbduction(f, 'right') };
    if (Math.max(sample.left, sample.right) > config.shoot.angleEnter) return fail(t('Put your legs down'));
    if (this.samples.length) {
      const first = this.samples[0];
      if (Math.abs(sample.hipY - first.hipY) / first.torso > cfg.maxMovement) {
        this.reset();
        return { progress: 0, message: t('Hold still…'), done: null };
      }
    }
    this.holdStart ??= f.t;
    this.samples.push(sample);
    const progress = Math.min(1, (f.t - this.holdStart) / cfg.holdMs);
    if (progress < 1) return { progress, message: t('Hold still…'), done: null };

    const n = this.samples.length;
    const done = {
      left: this.samples.reduce((s, x) => s + x.left, 0) / n,
      right: this.samples.reduce((s, x) => s + x.right, 0) / n,
    };
    this.reset();
    return { progress: 1, message: t('Great!'), done };
  }
}
