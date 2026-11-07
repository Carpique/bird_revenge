import { config } from '../config';

export interface FlightVelocity {
  /** new velocity, px per physics step */
  x: number;
  y: number;
  /** the fraction of gravity that acts this step (0 = cancelled, 1 = a free fall) */
  gravity: number;
}

/**
 * How fast a tilt of the arms (deg, + = the right hand on screen is higher) sends the bird sideways:
 * 0 inside the dead zone, ramping to ±1 at `fullTilt`; the sign is the direction on screen (+ = right),
 * towards the lower hand.
 */
export function sideAmount(tilt: number): number {
  const cfg = config.tilt;
  const a = Math.abs(tilt);
  const k = Math.max(0, Math.min(1, (a - cfg.deadZone) / Math.max(1, cfg.fullTilt - cfg.deadZone)));
  return -Math.sign(tilt) * k;
}

/**
 * How far past the gentle start a tilt held for `heldMs` in the same direction is: 0 = fine control
 * (`fineSpeed`, `fineAccel`), 1 = full (`sideSpeed`, `sideAccel`). A tilt up to `fineTilt` stays fine for its first
 * `fineMs`; a bigger one ramps to full by `boostTilt`.
 */
export function sideBoost(tilt: number, heldMs: number): number {
  const cfg = config.tilt;
  if (heldMs >= cfg.fineMs) return 1;
  return Math.max(0, Math.min(1, (Math.abs(tilt) - cfg.fineTilt) / Math.max(1, cfg.boostTilt - cfg.fineTilt)));
}

/** The share of the wingbeats' lift that goes up for a tilt: all of it level, `sideLift` at full tilt. */
export const liftShare = (tilt: number) => 1 - (1 - config.tilt.sideLift) * Math.abs(sideAmount(tilt));

/**
 * The wingbeats' lift (px/s²) smoothed over `liftSmoothMs`, so a climb doesn't come in steps and a fall after the
 * last flap starts gently: returns the new smoothed lift from the previous one and this step's.
 */
export function smoothLift(prev: number, lift: number, stepMs: number): number {
  return prev + (1 - Math.exp(-stepMs / Math.max(1, config.flap.liftSmoothMs))) * (lift - prev);
}

/** Sideways speed (px per step) after one step at `tilt`, held for `tiltHeldMs`, from `x`. */
function sideways(x: number, tilt: number, stepMs: number, tiltHeldMs: number): number {
  const k = sideAmount(tilt);
  if (k === 0) return x;
  const cfg = config.tilt;
  const perStep = (accel: number) => accel * (stepMs / 1000) ** 2;
  const full = k * cfg.sideSpeed;
  if (x * full < 0) {
    // turning back: stop first, then start over gently
    return x > 0 ? Math.max(0, x - perStep(cfg.sideAccel)) : Math.min(0, x + perStep(cfg.sideAccel));
  }
  if (Math.abs(x) > Math.abs(full)) return x + Math.sign(full - x) * Math.min(perStep(cfg.sideAccel), Math.abs(full - x));
  const b = sideBoost(tilt, tiltHeldMs);
  const cap = cfg.fineSpeed + (cfg.sideSpeed - cfg.fineSpeed) * b;
  const target = Math.sign(k) * Math.min(Math.abs(full), cap);
  const dv = perStep(cfg.fineAccel + (cfg.sideAccel - cfg.fineAccel) * b);
  return Math.abs(x) < Math.abs(target) ? x + Math.sign(target) * Math.min(dv, Math.abs(target - x)) : x;
}

/**
 * One physics step of the arm controls, from the bird's current velocity `v` (px per step, y down). Three
 * independent rules, the same whether the bird flies level, tilted or both:
 * - **tilt → sideways**: the bird eases towards `sideAmount` × `sideSpeed`. Speeding up, it's held back by the
 *   gentle start (`sideBoost`): at most `fineSpeed`, at `fineAccel`, easing in to `sideSpeed`, `sideAccel`; already
 *   faster than that it coasts. Slowing down, or stopping to turn back, takes the full `sideAccel`. Level, the
 *   sideways speed is left to air friction.
 * - **flapping → up**: the caller applies `lift`, the smoothed wingbeats' lift (`smoothLift`, its share going up
 *   set by the tilt: `liftShare`). Flapping also bears the bird's weight: as `lift` grows to gravity, only
 *   `flappingGravity` of gravity is left acting.
 * - **arms' height → gravity**: falling, `hold` (0..1, the arms held out: 1 in a T, tilted or not, less the lower
 *   they droop, 0 hanging down) cancels that fraction of gravity and applies that much of `holdDrag`, so the bird
 *   keeps its altitude in a T and sinks faster the lower the arms. Rising is left to gravity, so a climb levels off.
 */
export function flightStep(v: { x: number; y: number }, tilt: number, hold: number, lift: number, stepMs: number, tiltHeldMs = Infinity): FlightVelocity {
  const x = sideways(v.x, tilt, stepMs, tiltHeldMs);
  const h = v.y > 0 ? Math.max(0, Math.min(1, hold)) : 0;
  const flapping = Math.max(0, Math.min(1, lift / (config.physics.gravity * 1000)));
  const flapGravity = 1 - (1 - config.flap.flappingGravity) * flapping;
  return { x, y: v.y * (1 - config.tilt.holdDrag * h), gravity: (1 - h) * flapGravity };
}

/**
 * How far the bird pitches its beak up (deg, 0..`climbPitchDeg`) climbing at velocity `v` (px per step, y down):
 * along its flight path, scaled by its sideways speed (none when slow, all of it at `sideSpeed`).
 */
export function climbPitch(v: { x: number; y: number }): number {
  if (v.y >= 0) return 0;
  const along = Math.min(config.tilt.climbPitchDeg, (Math.atan2(-v.y, Math.abs(v.x)) * 180) / Math.PI);
  return along * Math.min(1, Math.abs(v.x) / Math.max(0.1, config.tilt.sideSpeed));
}

/** How far the bird leans (deg, clockwise on screen) for a tilt: into the direction it flies. */
export const leanFor = (tilt: number) => sideAmount(tilt) * config.tilt.leanDeg;
