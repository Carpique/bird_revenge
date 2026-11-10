import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { config } from '../config';
import { L } from './landmarks';

type Side = 'left' | 'right';
const SIDES: Side[] = ['left', 'right'];
const ARMS = {
  left: { sh: L.leftShoulder, el: L.leftElbow, wr: L.leftWrist },
  right: { sh: L.rightShoulder, el: L.rightElbow, wr: L.rightWrist },
};

/** the forearm taken as this fraction of the upper arm, in the stand-in for a wrist not seen */
const FOREARM_RATIO = 0.9;

/**
 * An arm's direction is shoulder → wrist (pointing, tilt, flap), but MediaPipe often guesses a wrist it cannot see
 * (a hand at the edge of the picture, behind the body, blurred) hanging down from the shoulder, with a low
 * visibility. While the wrist is below `pose.minWristVisibility` and the elbow is confident, the wrist is moved onto
 * the line shoulder → elbow, so the arm points the way its upper arm does (the forearm assumed straight). With the
 * elbow not confident either, nothing is changed: the arm is out of view (`VisibilityMonitor`). The wrist is
 * taken as seen again at `pose.minWristVisibility` plus `pose.wristVisibilityMargin`, so a wrist hovering around the
 * threshold does not flip the arm back and forth.
 */
export class WristGate {
  /** the person's own left / right wrist is a stand-in at the moment (for the last frame) */
  gated: Record<Side, boolean> = { left: false, right: false };

  reset() {
    this.gated.left = this.gated.right = false;
  }

  /** `pts` with a wrist not to be trusted moved onto its arm's upper-arm line (a new array; `pts` is left as it is). */
  apply(pts: NormalizedLandmark[]): NormalizedLandmark[] {
    const { minWristVisibility: min, wristVisibilityMargin: margin } = config.pose;
    const elbowOk = config.visibility.minLandmarkVisibility;
    let out = pts;
    for (const s of SIDES) {
      const a = ARMS[s];
      const sh = pts[a.sh], el = pts[a.el], wr = pts[a.wr];
      const wv = wr.visibility ?? 0;
      this.gated[s] = this.gated[s] ? wv < min + margin : wv < min;
      // the elbow gone too: the arm counts as out of view, the wrist is left as it is
      if (this.gated[s] && (el.visibility ?? 0) < elbowOk) this.gated[s] = false;
      if (!this.gated[s]) continue;
      if (out === pts) out = pts.slice();
      out[a.wr] = {
        x: el.x + (el.x - sh.x) * FOREARM_RATIO,
        y: el.y + (el.y - sh.y) * FOREARM_RATIO,
        z: el.z + (el.z - sh.z) * FOREARM_RATIO,
        visibility: wv,
      };
    }
    return out;
  }
}
