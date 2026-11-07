import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { config } from '../config';
import { L } from './landmarks';

type Side = 'left' | 'right';
const SIDES: Side[] = ['left', 'right'];
const OTHER: Record<Side, Side> = { left: 'right', right: 'left' };
const ARMS = {
  left: { sh: L.leftShoulder, el: L.leftElbow, wr: L.leftWrist },
  right: { sh: L.rightShoulder, el: L.rightElbow, wr: L.rightWrist },
};

/** An arm's confidence: its less visible joint. */
const confidence = (lm: NormalizedLandmark[], s: Side) =>
  Math.min(lm[ARMS[s].el].visibility ?? 0, lm[ARMS[s].wr].visibility ?? 0);

/** Angle between the two arms (shoulder → wrist) in the undistorted image, deg 0..180. */
function armsAngle(lm: NormalizedLandmark[], aspect: number): number {
  const d = (s: Side) => {
    const sh = lm[ARMS[s].sh], wr = lm[ARMS[s].wr];
    return { x: (wr.x - sh.x) * aspect, y: wr.y - sh.y };
  };
  const a = d('left'), b = d('right');
  const c = (a.x * b.x + a.y * b.y) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y) || 1);
  return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
}

/**
 * Works around MediaPipe losing one of two arms held straight and close together. Pointing both arms to one
 * side turns the body sideways, and the far arm disappears behind the near one: MediaPipe's confidence in it
 * sinks and its estimate drifts towards a hanging arm, while the near arm stays sharp. When an arm's confidence
 * drops while the other arm is confident, the two were parallel when last both seen, and the fading arm is the
 * far one (larger z), the fading arm becomes a stand-in: the near arm's elbow and wrist moved onto its own
 * shoulder, blended in as its confidence falls from `confident` to `hidden`, with the near arm's visibility.
 * It lasts until the arm is confidently seen again, or the near arm fades too (then the player really is out of view).
 */
export class ArmOcclusion {
  /** how much of each arm (the person's own left / right) is the other arm's stand-in in the last frame, 0..1 */
  standIn: Record<Side, number> = { left: 0, right: 0 };
  private hidden: Record<Side, boolean> = { left: false, right: false };
  /** the arms were parallel when this arm was last confidently seen together with the other */
  private parallel: Record<Side, boolean> = { left: false, right: false };

  reset() {
    for (const s of SIDES) {
      this.standIn[s] = 0;
      this.hidden[s] = false;
      this.parallel[s] = false;
    }
  }

  /** `raw` with a hidden arm replaced by its stand-in (a new array; `raw` is left as it is). */
  apply(raw: NormalizedLandmark[], aspect: number): NormalizedLandmark[] {
    const cfg = config.armOcclusion;
    const out = raw.slice();
    const c = { left: confidence(raw, 'left'), right: confidence(raw, 'right') };
    const parallel = armsAngle(raw, aspect) <= cfg.parallelMax;
    for (const s of SIDES) {
      const o = OTHER[s];
      if (this.hidden[s]) {
        if (c[s] >= cfg.confident || c[o] < cfg.otherMin) this.hidden[s] = false;
      } else if (c[s] >= cfg.confident) {
        if (c[o] >= cfg.confident) this.parallel[s] = parallel;
      } else if (this.parallel[s] && c[o] >= cfg.otherMin && raw[ARMS[s].wr].z > raw[ARMS[o].wr].z) {
        this.hidden[s] = true;
      }
      const w = this.hidden[s] ? Math.max(0, Math.min(1, (cfg.confident - c[s]) / (cfg.confident - cfg.hidden))) : 0;
      this.standIn[s] = w;
      if (w === 0) continue;
      const sh = raw[ARMS[s].sh], osh = raw[ARMS[o].sh];
      for (const j of ['el', 'wr'] as const) {
        const p = raw[ARMS[s][j]], q = raw[ARMS[o][j]];
        const mix = (a: number, b: number) => a + w * (b - a);
        out[ARMS[s][j]] = {
          x: mix(p.x, sh.x + q.x - osh.x),
          y: mix(p.y, sh.y + q.y - osh.y),
          z: mix(p.z, sh.z + q.z - osh.z),
          visibility: mix(p.visibility ?? 0, q.visibility ?? 0),
        };
      }
    }
    return out;
  }
}
