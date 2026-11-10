import { config } from '../config';
import type { Vec } from '../gestures/geometry';
import type { FlightVelocity } from './flight';

/**
 * What the arms ask of the bird under pointing control (`config.pointing`):
 * - `rest`: arms hanging down: no force, the bird rests or falls freely, its momentum fading
 * - `hover`: a T (arms spread out, roughly level): the bird keeps its place in the air
 * - `drift`: a tilted T: the bird moves slowly sideways towards the lower hand, keeping its altitude
 * - `fly`: both arms pointing the same way, or raised in a V (`vUp`): the bird flies that way at the cruising speed;
 *   one arm pointing while the other hangs (`oneArm`): that way, a little slower
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
  /** `fly`: the speed as a fraction of `cruiseSpeed` (absent: 1); less with one arm pointing (`pointing.oneArm`) */
  speed?: number;
  /** `fly` where one arm points while the other hangs (`pointing.oneArm`); absent: both arms */
  oneArm?: boolean;
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
 * 5. one arm (`oneArm`): one arm hanging (within `restCone` of straight down) and the other pointing, at least
 *    `oneArmMinOut` from straight down → fly where that arm points, at `oneArmSpeed` of the cruising speed. It comes
 *    last, so it only reads what matched nothing before: a hanging arm 25-35° out with the other within the T's
 *    range is still a tilted T (towards the lower hand). `oneArm`: the bird is flying by one arm now; it then keeps
 *    doing so `oneArmHysteresis` beyond both limits, checked before the T. `oneArmOn`: whether the map reads one
 *    arm at all (`pointing.oneArm`, unless the caller knows better: a recording made before it)
 */
export function classifyArms(left: Vec, right: Vec, current: PointingMode | null = null, oneArm = false, oneArmOn = config.pointing.oneArm): PointingIntent | null {
  const cfg = config.pointing;
  if (between(left, DOWN) <= cfg.restCone && between(right, DOWN) <= cfg.restCone) return { mode: 'rest', dx: 0, dy: 0 };

  if (current === 'fly' && oneArm && oneArmOn) {
    const arm = pointingArm(left, right, cfg.oneArmHysteresis);
    if (arm) return byOneArm(arm);
  }
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
  const arm = oneArmOn ? pointingArm(left, right, 0) : null;
  return arm ? byOneArm(arm) : null;
}

/**
 * One arm steering (`pointing.oneArm`): the arm that points while the other hangs, or null. Hanging: within
 * `restCone` of straight down; pointing: at least `oneArmMinOut` from straight down; each `slack` deg more lenient.
 */
function pointingArm(left: Vec, right: Vec, slack: number): Vec | null {
  const cfg = config.pointing;
  const dL = between(left, DOWN), dR = between(right, DOWN);
  const hangs = (d: number) => d <= cfg.restCone + slack;
  const points = (d: number) => d >= cfg.oneArmMinOut - slack;
  if (hangs(dL) && points(dR)) return right;
  if (hangs(dR) && points(dL)) return left;
  return null;
}

/** Flying where the one pointing arm points, at `oneArmSpeed` of the cruising speed. */
function byOneArm(arm: Vec): PointingIntent {
  const n = Math.hypot(arm.x, arm.y) || 1;
  return { mode: 'fly', dx: arm.x / n, dy: arm.y / n, speed: config.pointing.oneArmSpeed, oneArm: true };
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
 * T, whatever its tilt), the velocity is `g` · `cruiseSpeed` along `s`, plus (1 − `g`) times (with the arms spread,
 * `s`'s sideways part always points towards the lower hand, so a lopsided V and a lowered tilted T both go that way;
 * arms pointing together across the body fly where they point):
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
 * One arm (`oneArm`): with `w` = `oneArmWeight` (1: one arm hangs and the other points), the velocity above fades
 * out by 1 − `w` and the one-arm flight comes in: `oneArmSpeed` · `cruiseSpeed` where the pointing arm points. The
 * detector lets it in (`one.gain`, 0..1, eased) only once the pose has lasted, so arms raised or lowered one after
 * the other don't fly by it; what is not let in yet is `one.carry`, the flight the bird was on (none: a hover). It
 * is labelled `fly`, with `oneArm`, once it is most of the command. `one.on`: whether one arm is read at all
 * (`pointing.oneArm`, unless the caller knows better).
 */
export function continuousArms(left: Vec, right: Vec, one: { gain: number; carry?: { vx: number; vy: number } | null; on?: boolean } = { gain: 1 }): PointingIntent {
  const cfg = config.pointing;
  if (between(left, DOWN) <= cfg.restCone && between(right, DOWN) <= cfg.restCone) return { mode: 'rest', dx: 0, dy: 0 };
  const two = bothArms(left, right);
  const arm = oneArmWeight(left, right, one.on);
  const k = arm.w * one.gain * cfg.oneArmSpeed * cfg.cruiseSpeed, held = arm.w * (1 - one.gain);
  // y down on screen, like the bird's velocity
  const vx = (1 - arm.w) * two.vx + k * arm.x + held * (one.carry?.vx ?? 0);
  const vy = (1 - arm.w) * two.vy - k * arm.y + held * (one.carry?.vy ?? 0);
  const speed = Math.hypot(vx, vy);
  const byOne = arm.w * one.gain >= 0.5;
  const flying = (1 - arm.w) * two.g + arm.w * one.gain + (one.carry ? held : 0) >= 0.5;
  const mode: PointingMode = flying ? 'fly' : speed < HOVER_SPEED ? 'hover' : 'drift';
  const out: PointingIntent = { mode, dx: speed > 0 ? vx / speed : 0, dy: speed > 0 ? -vy / speed : 0, vx, vy };
  if (mode === 'drift' && vy > 0) out.sink = vy;
  if (byOne) out.oneArm = true;
  return out;
}

/**
 * Continuous steering by both arms (all of it without `oneArm`): the velocity asked for (px per step, y down) and
 * `g`, how much of it is the flight where the arms point together (0: a T's hover, drift or descent).
 */
export function bothArms(left: Vec, right: Vec): { vx: number; vy: number; g: number } {
  const cfg = config.pointing;
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
  // spread arms fly sideways towards the lower hand, as the tilted T drifts. The mean's own sideways part points to
  // the arm nearer level: the lower hand above level (a lopsided V), but the higher one below it, so two lowered,
  // tilted arms used to descend towards the higher hand (38 of 164 descending frames on a recording). Only its sign
  // is replaced, by the spread weight: the identity for every V, and arms pointing together across the body still
  // fly where they point
  const fx = spread * -Math.sign(tilt) * Math.abs(sx) + (1 - spread) * sx;
  // y down on screen, like the bird's velocity
  return { vx: (g * cfg.cruiseSpeed * fx) / (m || 1) + (1 - g) * drift, vy: (-g * cfg.cruiseSpeed * sy) / (m || 1) + (1 - g) * sink, g };
}

/**
 * Continuous steering by one arm (`pointing.oneArm`): how much the arms are one hanging and one pointing, 0..1, and
 * the pointing arm's direction (unit, y up). As the discrete map reads it, with every limit a smooth fade, so the
 * command never jumps:
 * - the other arm points fully from `oneArmMinOut` from straight down, not at all at `restCone`
 * - an arm hangs fully within `restCone` − 20 of straight down and not at all from `restCone` − 5, so that beside
 *   an arm held level the bird turns from the pointing arm to the lower hand with the hanging arm 25° out, where
 *   the discrete map's T begins (the default `tMaxArm`): a tilted T whose lower arm is further out still goes
 *   towards the lower hand (seconds of it on a recording of play), and an arm hanging as arms do (8-24° out at rest
 *   on the recordings) mostly counts; with the pointing arm raised steeply, though (65° to 80° above level and
 *   beyond, past any T), the whole `restCone` hangs (fading out over 15° about its edge)
 * - arms pointing together (within `parallelMax` of each other, fading out over 15° more) are both arms' flight
 * Only one arm can be the pointing one (it is outside the cone the other is in).
 */
export function oneArmWeight(left: Vec, right: Vec, on = config.pointing.oneArm): { w: number; x: number; y: number } {
  const cfg = config.pointing;
  if (!on) return { w: 0, x: 0, y: 0 };
  const points = (arm: Vec) => smoothstep(between(arm, DOWN), cfg.restCone, cfg.oneArmMinOut);
  const hangs = (arm: Vec, other: Vec, otherSide: -1 | 1) => {
    const d = between(arm, DOWN);
    const narrow = 1 - smoothstep(d, cfg.restCone - 20, cfg.restCone - 5);
    const wide = 1 - smoothstep(d, cfg.restCone - 7.5, cfg.restCone + 7.5);
    return narrow + (wide - narrow) * smoothstep(Math.abs(outwardElevation(other, otherSide)), 65, 80);
  };
  const apart = smoothstep(between(left, right), cfg.parallelMax, cfg.parallelMax + 15);
  // the right arm points while the left hangs, or the other way round
  const wR = hangs(left, right, 1) * points(right), wL = hangs(right, left, -1) * points(left);
  const arm = wR >= wL ? right : left;
  const n = Math.hypot(arm.x, arm.y) || 1;
  return { w: apart * Math.max(wR, wL), x: arm.x / n, y: arm.y / n };
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
    case 'fly': {
      const speed = cfg.cruiseSpeed * (p.speed ?? 1);
      return { ...approach(v, { x: p.dx * speed, y: -p.dy * speed }, maxDv), gravity: 0 };
    }
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
