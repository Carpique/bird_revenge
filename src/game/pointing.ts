import { config } from '../config';
import type { Vec } from '../gestures/geometry';
import type { FlightVelocity } from './flight';

/**
 * What the arms ask of the bird under pointing control (`config.pointing`):
 * - `rest`: arms hanging down: no force, the bird rests or falls freely, its momentum fading
 * - `hover`: a T (arms spread out, roughly level): the bird keeps its place in the air
 * - `drift`: a tilted T: the bird moves slowly sideways towards the lower hand, keeping its altitude
 * - `fly`: both arms pointing the same way: the bird flies that way at the cruising speed
 */
export type PointingMode = 'rest' | 'hover' | 'drift' | 'fly';

export interface PointingIntent {
  mode: PointingMode;
  /**
   * direction of travel on screen, unit vector with y up: where the arms point (`fly`), towards the lower hand
   * (`drift`, ±1 sideways), 0 otherwise
   */
  dx: number;
  dy: number;
  /** `drift` with the arms lowered: sinking speed, px per physics step (0 or absent: keeps the altitude) */
  sink?: number;
}

const DEG = 180 / Math.PI;

/**
 * An arm's angle above horizontal, measured out to its own side (deg): 0 = level, 90 = up, -90 = down,
 * beyond ±90 = pointing across the body. `dir` is the arm (shoulder → wrist) on screen, y up; `side` -1 for the
 * arm showing on the screen's left (the player's left, mirrored view), +1 for the right.
 */
export const outwardElevation = (dir: Vec, side: -1 | 1) => Math.atan2(dir.y, side * dir.x) * DEG;

/** Angle between two directions, deg 0..180. */
const between = (a: Vec, b: Vec) => {
  const d = (a.x * b.x + a.y * b.y) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y) || 1);
  return Math.acos(Math.max(-1, Math.min(1, d))) * DEG;
};

const DOWN: Vec = { x: 0, y: -1 };

/**
 * Reads one frame's arms: `left` and `right` are the arms showing on the screen's left and right, as directions
 * (shoulder → wrist) on the mirrored screen with y up. `current` is the mode the bird is in, for the tilt's
 * hysteresis. Returns null when the arms match no pose (on their way from one to another, or sloppy).
 * Checked in order:
 * 1. both arms within `restCone` of straight down → rest
 * 2. a T: each arm out to its own side within `tMaxArm` of level, on average within `tMaxRaise` (so a T raised
 *    into a shallow V or drooping counts too) → hover; tilted past `tiltDeadZone` → drift towards the lower hand
 * 3. the arms parallel within `parallelMax` → fly where they point (on average)
 */
export function classifyArms(left: Vec, right: Vec, current: PointingMode | null = null): PointingIntent | null {
  const cfg = config.pointing;
  if (between(left, DOWN) <= cfg.restCone && between(right, DOWN) <= cfg.restCone) return { mode: 'rest', dx: 0, dy: 0 };

  const eL = outwardElevation(left, -1);
  const eR = outwardElevation(right, 1);
  if (Math.abs(eL) <= cfg.tMaxArm && Math.abs(eR) <= cfg.tMaxArm && Math.abs((eL + eR) / 2) <= cfg.tMaxRaise) {
    // + = the right hand higher
    const tilt = (eR - eL) / 2;
    // once drifting, it takes a little less tilt to keep drifting, so it doesn't flicker at the edge
    const deadZone = cfg.tiltDeadZone - (current === 'drift' ? cfg.tiltHysteresis : 0);
    if (Math.abs(tilt) < deadZone) return { mode: 'hover', dx: 0, dy: 0 };
    return { mode: 'drift', dx: tilt > 0 ? -1 : 1, dy: 0 };
  }

  if (between(left, right) <= cfg.parallelMax) {
    const sx = left.x / (Math.hypot(left.x, left.y) || 1) + right.x / (Math.hypot(right.x, right.y) || 1);
    const sy = left.y / (Math.hypot(left.x, left.y) || 1) + right.y / (Math.hypot(right.x, right.y) || 1);
    const n = Math.hypot(sx, sy) || 1;
    return { mode: 'fly', dx: sx / n, dy: sy / n };
  }
  return null;
}

/** Moves `v` towards `t` by at most `maxDv` (as a vector). */
function approach(v: { x: number; y: number }, t: { x: number; y: number }, maxDv: number) {
  const dx = t.x - v.x, dy = t.y - v.y;
  const d = Math.hypot(dx, dy);
  if (d <= maxDv) return { x: t.x, y: t.y };
  return { x: v.x + (dx / d) * maxDv, y: v.y + (dy / d) * maxDv };
}

/**
 * One physics step under pointing control, from the bird's current velocity `v` (px per step, y down).
 * `gravity` 0 asks the caller to cancel gravity this step (everything but resting holds the bird up).
 */
export function pointingStep(v: { x: number; y: number }, p: PointingIntent, stepMs: number): FlightVelocity {
  const cfg = config.pointing;
  const maxDv = cfg.accel * (stepMs / 1000) ** 2;
  switch (p.mode) {
    case 'rest': {
      // no force: sideways and upward momentum fade, gravity takes over
      const k = 1 - cfg.restDrag;
      return { x: v.x * k, y: v.y < 0 ? v.y * k : v.y, gravity: 1 };
    }
    case 'hover':
      return { ...approach(v, { x: 0, y: 0 }, maxDv), gravity: 0 };
    case 'drift':
      // y down on screen: a positive sink descends
      return { ...approach(v, { x: p.dx * cfg.driftSpeed, y: p.sink ?? 0 }, maxDv), gravity: 0 };
    case 'fly':
      return { ...approach(v, { x: p.dx * cfg.cruiseSpeed, y: -p.dy * cfg.cruiseSpeed }, maxDv), gravity: 0 };
  }
}

/** How far the bird leans (deg, clockwise on screen): into the sideways part of its flight. */
export function pointingLean(p: PointingIntent): number {
  if (p.mode === 'fly') return p.dx * config.pointing.leanDeg;
  if (p.mode === 'drift') return p.dx * config.pointing.leanDeg * 0.4;
  return 0;
}
