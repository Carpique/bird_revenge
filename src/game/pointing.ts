import { config } from '../config';
import type { Vec } from '../gestures/geometry';
import type { FlightVelocity } from './flight';

/**
 * What the arms ask of the bird under pointing control (`config.pointing`):
 * - `rest`: arms hanging down: no force, the bird rests or falls freely, its momentum fading
 * - `hover`: a T (arms spread out, roughly level): the bird keeps its place in the air
 * - `drift`: a tilted T: the bird moves slowly sideways towards the lower hand, keeping its altitude
 * - `fly`: both arms pointing the same way, or raised in a V (`vUp`): the bird flies that way at the cruising speed
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
  /**
   * continuous steering (`pointing.continuous`): the velocity asked for, px per physics step, y down on screen like
   * the bird's own; the mode is then only a label for it. Absent: the mode's own velocity (the discrete map)
   */
  vx?: number;
  vy?: number;
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
 * 4. a V (`vUp`): both arms raised at least `vMinArm`, on average more than `tMaxRaise` (too high for a T) → fly
 *    where the two arms point together: a symmetric V straight up, a lopsided one up and towards the lower arm.
 *    Once flying, a V a little lower (`vHysteresis`) still flies, and is checked before the T, so arms held at about
 *    `tMaxRaise` don't flip between hover and flying up
 */
export function classifyArms(left: Vec, right: Vec, current: PointingMode | null = null): PointingIntent | null {
  const cfg = config.pointing;
  if (between(left, DOWN) <= cfg.restCone && between(right, DOWN) <= cfg.restCone) return { mode: 'rest', dx: 0, dy: 0 };

  const eL = outwardElevation(left, -1);
  const eR = outwardElevation(right, 1);
  const isV = (slack: number) => cfg.vUp && Math.min(eL, eR) >= cfg.vMinArm - slack && (eL + eR) / 2 > cfg.tMaxRaise - slack;
  if (current === 'fly' && isV(cfg.vHysteresis)) return together(left, right);
  if (Math.abs(eL) <= cfg.tMaxArm && Math.abs(eR) <= cfg.tMaxArm && Math.abs((eL + eR) / 2) <= cfg.tMaxRaise) {
    // + = the right hand higher
    const tilt = (eR - eL) / 2;
    // once drifting, it takes a little less tilt to keep drifting, so it doesn't flicker at the edge
    const deadZone = cfg.tiltDeadZone - (current === 'drift' ? cfg.tiltHysteresis : 0);
    if (Math.abs(tilt) < deadZone) return { mode: 'hover', dx: 0, dy: 0 };
    return { mode: 'drift', dx: tilt > 0 ? -1 : 1, dy: 0 };
  }

  if (between(left, right) <= cfg.parallelMax || isV(0)) return together(left, right);
  return null;
}

/** Flying where the two arms point together: the normalised sum of their directions. */
function together(left: Vec, right: Vec): PointingIntent {
  const sx = left.x / (Math.hypot(left.x, left.y) || 1) + right.x / (Math.hypot(right.x, right.y) || 1);
  const sy = left.y / (Math.hypot(left.x, left.y) || 1) + right.y / (Math.hypot(right.x, right.y) || 1);
  const n = Math.hypot(sx, sy) || 1;
  return { mode: 'fly', dx: sx / n, dy: sy / n };
}

/** 0 below `a`, 1 above `b`, a smooth S between (and a step at `a` when `b` <= `a`). */
const smoothstep = (x: number, a: number, b: number) => {
  if (b <= a) return x < a ? 0 : 1;
  const k = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};
const ramp = (x: number, a: number, b: number) => Math.max(0, Math.min(1, (x - a) / Math.max(1e-6, b - a)));

/** below this speed (px per step) a continuous command is labelled a hover */
const HOVER_SPEED = 0.25;

/**
 * Continuous steering (`pointing.continuous`): one frame's arms (as for `classifyArms`) straight to a velocity, with
 * no poses to match. Both arms within `restCone` of straight down → rest; otherwise, with `s` the mean of the two
 * arms' unit directions and `g` = smoothstep(|s|; `togetherZero`, `togetherFull`) (1: the arms point together, 0: a
 * T, whatever its tilt), the velocity is `g` · `cruiseSpeed` along `s`, plus (1 − `g`) times:
 * - a drift sideways towards the lower hand, `driftSpeed` times the tilt's ramp (smoothstep of half the arms'
 *   angle difference from `tiltDeadZone` to `tiltFull`), only while the arms are spread (each out to its own side;
 *   faded out from 75° to 90° above or below level, so an arm turning across the body doesn't jump)
 * - a descent (`pointing.descend`): `descendSpeed` times the arms' average below level (`descendZero` ..
 *   `descendFull`, as the discrete descent), times the same tilt ramp: a lowered T that isn't tilted still hovers.
 * So parallel arms fly where they point, a level T hovers, a tilted T drifts, a lowered tilted T descends
 * diagonally, a V climbs (faster the higher the arms), arms low and apart (an A) descend; only the rest cone falls.
 * The mode is a label for the animation, the debug panel and the black box: `fly` when `g` ≥ 0.5, else `hover`
 * below a crawl and `drift` otherwise (with `sink`, the downward speed, when it descends). `dx`/`dy`: the velocity's
 * direction (y up).
 */
export function continuousArms(left: Vec, right: Vec): PointingIntent {
  const cfg = config.pointing;
  if (between(left, DOWN) <= cfg.restCone && between(right, DOWN) <= cfg.restCone) return { mode: 'rest', dx: 0, dy: 0 };
  const nl = Math.hypot(left.x, left.y) || 1, nr = Math.hypot(right.x, right.y) || 1;
  const sx = (left.x / nl + right.x / nr) / 2, sy = (left.y / nl + right.y / nr) / 2;
  const m = Math.hypot(sx, sy);
  const g = smoothstep(m, cfg.togetherZero, cfg.togetherFull);
  const eL = outwardElevation(left, -1), eR = outwardElevation(right, 1);
  // each arm out to its own side: an arm past straight up or down points across the body
  const spread = (1 - smoothstep(Math.abs(eL), 75, 90)) * (1 - smoothstep(Math.abs(eR), 75, 90));
  // + = the right hand higher
  const tilt = (eR - eL) / 2;
  const tiltK = spread * smoothstep(Math.abs(tilt), cfg.tiltDeadZone, cfg.tiltFull);
  const drift = -Math.sign(tilt) * tiltK * cfg.driftSpeed;
  const sink = cfg.descend ? tiltK * cfg.descendSpeed * ramp(-(eL + eR) / 2, cfg.descendZero, cfg.descendFull) : 0;
  // y down on screen, like the bird's velocity
  const vx = (g * cfg.cruiseSpeed * sx) / (m || 1) + (1 - g) * drift;
  const vy = (-g * cfg.cruiseSpeed * sy) / (m || 1) + (1 - g) * sink;
  const speed = Math.hypot(vx, vy);
  const mode: PointingMode = g >= 0.5 ? 'fly' : speed < HOVER_SPEED ? 'hover' : 'drift';
  const out: PointingIntent = { mode, dx: speed > 0 ? vx / speed : 0, dy: speed > 0 ? -vy / speed : 0, vx, vy };
  if (mode === 'drift' && vy > 0) out.sink = vy;
  return out;
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
  // continuous steering: the velocity asked for, whatever the label (the rest is still the rest)
  if (p.mode !== 'rest' && p.vx !== undefined) return { ...approach(v, { x: p.vx, y: p.vy ?? 0 }, maxDv), gravity: 0 };
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
  const cfg = config.pointing;
  // continuous steering: with the sideways speed asked for, so it doesn't jump with the label
  if (p.mode !== 'rest' && p.vx !== undefined) return Math.max(-1, Math.min(1, p.vx / Math.max(1e-6, cfg.cruiseSpeed))) * cfg.leanDeg;
  if (p.mode === 'fly') return p.dx * config.pointing.leanDeg;
  if (p.mode === 'drift') return p.dx * config.pointing.leanDeg * 0.4;
  return 0;
}

/**
 * Wingbeat rate under pointing control, as a multiple of the flap animation's fps; null at rest. Flying,
 * `flapRate`; hovering or drifting, the fast beat of the flapping mode's hover (`tilt.holdFlapRate`). Continuous
 * steering blends the two with the speed asked for (none: the hover's, `cruiseSpeed`: the flight's), so the wings
 * don't jump with the label.
 */
export function pointingFlapRate(p: PointingIntent): number | null {
  if (p.mode === 'rest') return null;
  const fly = config.pointing.flapRate, hold = config.tilt.holdFlapRate;
  if (p.vx !== undefined) return hold + (fly - hold) * Math.min(1, Math.hypot(p.vx, p.vy ?? 0) / Math.max(1e-6, config.pointing.cruiseSpeed));
  return p.mode === 'fly' ? fly : hold;
}
