import { config } from '../config';
import { L } from '../pose/landmarks';
import type { PoseFrame } from '../pose/types';
import type { FlapOutput } from './FlapDetector';
import { pt } from './geometry';

export interface ArmLine {
  /** tilt of the line through both arms, deg, as seen on the mirrored screen with y up: + = rises to the right */
  tilt: number;
  /** how far the points stray from that line: perpendicular RMS / along-line RMS (0 = perfectly straight) */
  bend: number;
}

export interface GlideOutput {
  /** arms spread out in a roughly straight line and held still, before debouncing */
  pose: boolean;
  /** debounced on/off decision used by the game */
  gliding: boolean;
  /** the fitted arm line, or null when an arm isn't visible */
  line: ArmLine | null;
  /** smoothed tilt, deg (0 when not gliding) */
  tilt: number;
  /**
   * sideways speed to slide at (px per physics step, + = right), or null to keep the current
   * momentum (arms about horizontal, inside the dead zone)
   */
  slide: number | null;
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
 * Glide detector: both arms spread out in a roughly straight line (wrists, elbows, shoulders) and held
 * still. Tilting that line slides the bird sideways; about horizontal (within `deadZone`) it keeps its
 * momentum. Binary on/off: the pose must hold for `enterMs` to start gliding (so a flap sweeping through
 * horizontal doesn't count), and be gone for `exitMs` to stop (so one noisy frame doesn't drop out of it).
 * The tilt is smoothed and the dead zone has hysteresis, so the bird doesn't flicker left and right.
 */
export class GlideDetector {
  private gliding = false;
  private poseSince: number | null = null;
  private lostSince: number | null = null;
  private tilt = 0;
  private steering = false;

  update(f: PoseFrame, leftVisible: boolean, rightVisible: boolean, flap: FlapOutput): GlideOutput {
    const cfg = config.glide;
    const line = leftVisible && rightVisible ? fitArmLine(f) : null;
    const still = Math.abs(flap.left.velocity) <= cfg.maxArmSpeed && Math.abs(flap.right.velocity) <= cfg.maxArmSpeed;
    const pose = !!line && still && line.bend <= cfg.maxBend && Math.abs(line.tilt) <= cfg.maxTilt;

    if (pose) {
      this.poseSince ??= f.t;
      this.lostSince = null;
      if (!this.gliding && f.t - this.poseSince >= cfg.enterMs) {
        this.gliding = true;
        this.tilt = line.tilt;
        this.steering = false;
      }
    } else {
      this.poseSince = null;
      this.lostSince ??= f.t;
      if (this.gliding && f.t - this.lostSince >= cfg.exitMs) this.gliding = false;
    }
    if (!this.gliding) return { pose, gliding: false, line, tilt: 0, slide: null };

    // keep the last good tilt through the brief exit delay
    if (pose) this.tilt += cfg.tiltSmoothing * (line.tilt - this.tilt);
    const a = Math.abs(this.tilt);
    if (a > cfg.deadZone) this.steering = true;
    else if (a < cfg.deadZone - cfg.deadZoneHysteresis) this.steering = false;
    let slide: number | null = null;
    if (this.steering) {
      // ramps up from 0 at the edge of the dead zone, so crossing it never jumps
      const k = Math.max(0, Math.min(1, (a - cfg.deadZone) / Math.max(1, cfg.fullTilt - cfg.deadZone)));
      slide = cfg.tiltSign * Math.sign(this.tilt) * k * cfg.slideSpeed;
    }
    return { pose, gliding: true, line, tilt: this.tilt, slide };
  }
}
