import { config } from '../config';
import { L } from '../pose/landmarks';
import type { PoseFrame } from '../pose/types';
import type { FlapOutput } from './FlapDetector';
import { armAngleInImage, elbowAngle, pt } from './geometry';

export interface ArmLine {
  /** tilt of the line through both arms, deg, as seen on the mirrored screen with y up: + = rises to the right */
  tilt: number;
  /** how far the points stray from that line: perpendicular RMS / along-line RMS (0 = perfectly straight) */
  bend: number;
}

export interface TiltOutput {
  /**
   * smoothed tilt of the arms, deg, as seen on the mirrored screen with y up: + = the right hand (on screen) is
   * higher. Half the difference of the two arms' angles in the image; 0 while an arm isn't visible
   */
  tilt: number;
  /** each arm's angle in the image, deg (0 down, 90 level, 180 up), or null when not visible */
  left: number | null;
  right: number | null;
  /** the fitted arm line, or null when an arm isn't visible */
  line: ArmLine | null;
  /** arms spread out (a T, or raised up to a V) and held still, before debouncing */
  spreadPose: boolean;
  /** debounced spread pose: the bird hovers */
  spread: boolean;
}

const ARM_POINTS = [L.leftWrist, L.leftElbow, L.leftShoulder, L.rightShoulder, L.rightElbow, L.rightWrist];

/**
 * Total least squares line through both arms' wrist, elbow and shoulder (principal axis of the
 * points, so it works for steep tilts too, unlike a y-on-x regression).
 */
export function fitArmLine(f: PoseFrame): ArmLine {
  // mirrored screen coordinates with y up, so the tilt reads the way the player sees it
  const ps = ARM_POINTS.map((i) => {
    const p = pt(f, i);
    return { x: -p.x, y: -p.y };
  });
  const n = ps.length;
  const mx = ps.reduce((s, p) => s + p.x, 0) / n;
  const my = ps.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of ps) {
    sxx += (p.x - mx) ** 2;
    syy += (p.y - my) ** 2;
    sxy += (p.x - mx) * (p.y - my);
  }
  let tilt = (0.5 * Math.atan2(2 * sxy, sxx - syy) * 180) / Math.PI;
  // the axis is a line, not a direction: keep it within ±90°
  if (tilt > 90) tilt -= 180;
  if (tilt <= -90) tilt += 180;
  const mean = (sxx + syy) / 2;
  const r = Math.hypot((sxx - syy) / 2, sxy);
  const along = mean + r;
  const across = Math.max(0, mean - r);
  return { tilt, bend: Math.sqrt(across / (along || 1)) };
}

/**
 * Reads two things from the arms:
 * - **tilt**: half the difference between the arms' angles in the image (so a tilted T, a leaning body and
 *   flapping tilted all count). Flapping moves both arms by about the same angle, so the difference, and with
 *   it the tilt, holds steady through the strokes; the smoothing irons out arms flapping slightly out of step.
 * - **spread**: both arms out and held still, either way:
 *   - at or above horizontal on average, up to `maxRaise` (a T, or raised into a V), each arm straight
 *   - below it: only a roughly straight line through both arms (wrists, elbows, shoulders), so arms drooping
 *     into a downward V don't count: lowering the arms lets the bird fall
 *   Level or tilted (up to `maxTilt`). It must hold for `enterMs` to count (so a flap sweeping through doesn't) and
 *   be gone for `exitMs` to stop (so one noisy frame doesn't drop out of it).
 * What these do to the bird is up to the game (`game/flight.ts`).
 */
export class TiltDetector {
  private tilt = 0;
  private spread = false;
  private poseSince: number | null = null;
  private lostSince: number | null = null;

  update(f: PoseFrame, leftVisible: boolean, rightVisible: boolean, flap: FlapOutput): TiltOutput {
    const both = leftVisible && rightVisible;
    const left = leftVisible ? armAngleInImage(f, 'left') : null;
    const right = rightVisible ? armAngleInImage(f, 'right') : null;
    // the player's right arm shows on the screen's right (mirrored view)
    const raw = both ? (right! - left!) / 2 : 0;
    this.tilt += config.tilt.smoothing * (raw - this.tilt);

    const cfg = config.hover;
    const line = both ? fitArmLine(f) : null;
    const still = Math.abs(flap.left.velocity) <= cfg.maxArmSpeed && Math.abs(flap.right.velocity) <= cfg.maxArmSpeed;
    let spreadPose = false;
    if (line && still && Math.abs(raw) <= cfg.maxTilt) {
      // the arms' average angle above horizontal (0 = a T, tilted or not)
      const raise = (left! + right!) / 2 - 90;
      const straight = elbowAngle(f, 'left') >= cfg.minElbowAngle && elbowAngle(f, 'right') >= cfg.minElbowAngle;
      spreadPose =
        raise >= 0 ? raise <= cfg.maxRaise && straight
        : line.bend <= cfg.maxBend && Math.abs(line.tilt) <= cfg.maxTilt;
    }
    if (spreadPose) {
      this.poseSince ??= f.t;
      this.lostSince = null;
      if (f.t - this.poseSince >= cfg.enterMs) this.spread = true;
    } else {
      this.poseSince = null;
      this.lostSince ??= f.t;
      if (f.t - this.lostSince >= cfg.exitMs) this.spread = false;
    }
    return { tilt: this.tilt, left, right, line, spreadPose, spread: this.spread };
  }
}
