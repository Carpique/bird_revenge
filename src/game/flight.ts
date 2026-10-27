import { config } from '../config';

export interface FlightVelocity {
  /** new velocity, px per physics step */
  x: number;
  y: number;
  /** cancel gravity this step (hovering, holding the fall at its sink speed) */
  holdUp: boolean;
  /** otherwise, the fraction of gravity that acts this step (default 1) */
  gravity?: number;
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
 * One physics step of the arm controls (flapping lift is a force, applied by the caller), from the bird's
 * current velocity `v` (px per step, y down) and the ms since the last flap:
 * - sideways: tilted, the bird eases (at most `sideAccel`) towards `sideAmount` × `sideSpeed`; level, the
 *   sideways speed is left to air friction.
 * - tilted or `hovering` (arms spread in a T, in the air), it keeps its altitude: a fall is braked (`holdDrag`,
 *   gravity cancelled). Rising is left to gravity, so a flap climbs as usual and then levels off.
 * - otherwise falling: right after a flap only `afterFlapGravity` of gravity acts, easing back to full gravity
 *   over `afterFlapMs`.
 */
export function flightStep(v: { x: number; y: number }, tilt: number, hovering: boolean, sinceFlapMs: number, stepMs: number): FlightVelocity {
  let { x, y } = v;
  const k = sideAmount(tilt);
  if (k !== 0) {
    const maxDv = config.tilt.sideAccel * (stepMs / 1000) ** 2;
    x += Math.max(-maxDv, Math.min(maxDv, k * config.tilt.sideSpeed - x));
  }
  if (y <= 0) return { x, y, holdUp: false };
  if (k !== 0 || hovering) return { x, y: y * (1 - config.tilt.holdDrag), holdUp: true };
  return { x, y, holdUp: false, gravity: afterFlapGravity(sinceFlapMs) };
}

/** Fraction of gravity acting on a fall `sinceFlapMs` after the last flap: `afterFlapGravity` easing in to 1. */
export function afterFlapGravity(sinceFlapMs: number): number {
  const cfg = config.flap;
  const p = Math.max(0, Math.min(1, sinceFlapMs / Math.max(1, cfg.afterFlapMs)));
  return cfg.afterFlapGravity + (1 - cfg.afterFlapGravity) * p * p;
}

/** How far the bird leans (deg, clockwise on screen) for a tilt: into the direction it flies. */
export const leanFor = (tilt: number) => sideAmount(tilt) * config.tilt.leanDeg;
