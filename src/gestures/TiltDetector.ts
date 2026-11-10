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
  /** arms spread out (a T, raised up to a V, or lowered evenly) and held still, before debouncing */
  spreadPose: boolean;
  /** debounced spread pose: the bird hovers */
  spread: boolean;
  /**
   * how much of the fall the hover holds back, 0..1: 1 in a T or higher, fading to 0 the lower both arms droop
   * (`hover.holdDroop` → `hover.fallDroop`); 0 while not spread
   */
  hold: number;
}

/** The hover's hold for arms drooping `droop` deg below horizontal on average: 1 down to `holdDroop`, 0 from `fallDroop`. */
export function droopHold(droop: number): number {
  const cfg = config.hover;
  return Math.max(0, Math.min(1, (cfg.fallDroop - droop) / Math.max(1, cfg.fallDroop - cfg.holdDroop)));
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
 *   - at or above horizontal on average, up to `maxRaise` (a T, or raised into a V), each arm straight: full hold
 *   - below it: a roughly straight line through both arms (wrists, elbows, shoulders; a tilted T), or both arms
 *     lowered by about the same angle (within `maxDroopDiff`), each straight. The hold fades with how far they droop
 *     on average (`droopHold`), so lowering the arms gradually lets the bird sink faster, down to a free fall
 *   Level or tilted (up to `maxTilt`). It must hold for `enterMs` to count (so a flap sweeping through doesn't) and
 *   be gone for `exitMs` to stop (so one noisy frame doesn't drop out of it); meanwhile the last hold stays.
 * What these do to the bird is up to the game (`game/flight.ts`).
 */
export class TiltDetector {
  private tilt = 0;
  private spread = false;
  private hold = 0;
  private poseSince: number | null = null;
  private lostSince: number | null = null;

  /** Forget the tilt and hold (after a gap in the pose). */
  reset() {
    this.tilt = 0;
    this.spread = false;
    this.hold = 0;
    this.poseSince = null;
    this.lostSince = null;
  }

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
    let poseHold = 0;
    if (line && still && Math.abs(raw) <= cfg.maxTilt) {
      // the arms' average angle above horizontal (0 = a T, tilted or not)
      const raise = (left! + right!) / 2 - 90;
      const straight = elbowAngle(f, 'left') >= cfg.minElbowAngle && elbowAngle(f, 'right') >= cfg.minElbowAngle;
      if (raise >= 0) poseHold = raise <= cfg.maxRaise && straight ? 1 : 0;
      else {
        const inLine = line.bend <= cfg.maxBend && Math.abs(line.tilt) <= cfg.maxTilt;
        const even = Math.abs(left! - right!) <= cfg.maxDroopDiff && straight;
        poseHold = inLine || even ? droopHold(-raise) : 0;
      }
    }
    const spreadPose = poseHold > 0;
    if (spreadPose) {
      this.poseSince ??= f.t;
      this.lostSince = null;
      if (f.t - this.poseSince >= cfg.enterMs) this.spread = true;
      if (this.spread) this.hold = poseHold;
    } else {
      this.poseSince = null;
      this.lostSince ??= f.t;
      if (f.t - this.lostSince >= cfg.exitMs) this.spread = false;
    }
    if (!this.spread) this.hold = 0;
    return { tilt: this.tilt, left, right, line, spreadPose, spread: this.spread, hold: this.hold };
  }
}
