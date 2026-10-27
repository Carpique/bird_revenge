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
 * How far past the gentle start a tilt held for `heldMs` in the same direction is: 0 = fine control
 * (`fineSpeed`, `fineAccel`), 1 = full (`sideSpeed`, `sideAccel`). A tilt up to `fineTilt` stays fine for its first
 * `fineMs`; a bigger one ramps to full by `boostTilt`.
 */
export function sideBoost(tilt: number, heldMs: number): number {
  const cfg = config.tilt;
  if (heldMs >= cfg.fineMs) return 1;
  return Math.max(0, Math.min(1, (Math.abs(tilt) - cfg.fineTilt) / Math.max(1, cfg.boostTilt - cfg.fineTilt)));
}

/**
 * One physics step of the arm controls (flapping lift is a force, applied by the caller), from the bird's
 * current velocity `v` (px per step, y down), the ms since the last flap and the ms the tilt has been held:
 * - sideways: tilted, the bird eases towards `sideAmount` × `sideSpeed`. Speeding up, it's held back by the
 *   gentle start (`sideBoost`): at most `fineSpeed`, at `fineAccel`, easing in to `sideSpeed`, `sideAccel`; already
 *   faster than that it coasts. Slowing down, or stopping to turn back, takes the full `sideAccel`. Level, the
 *   sideways speed is left to air friction.
 * - tilted or hovering with a full `hold` (arms spread in a T, in the air), it keeps its altitude: a fall is braked
 *   (`holdDrag`, gravity cancelled). Rising is left to gravity, so a flap climbs as usual and then levels off.
 * - hovering with a partial `hold` (arms lowered evenly), that fraction of gravity is cancelled (and of `holdDrag`
 *   applied), so the fall settles at a sink speed that grows the lower the arms are.
 * - falling: right after a flap only `afterFlapGravity` of gravity acts, easing back to full gravity over
 *   `afterFlapMs` (with a partial hold, whichever lets less of it act).
 */
export function flightStep(v: { x: number; y: number }, tilt: number, hold: number, sinceFlapMs: number, stepMs: number, tiltHeldMs = Infinity): FlightVelocity {
  let { x, y } = v;
  const k = sideAmount(tilt);
  if (k !== 0) {
    const cfg = config.tilt;
    const perStep = (accel: number) => accel * (stepMs / 1000) ** 2;
    const full = k * cfg.sideSpeed;
    if (x * full < 0) {
      // turning back: stop first, then start over gently
      x = x > 0 ? Math.max(0, x - perStep(cfg.sideAccel)) : Math.min(0, x + perStep(cfg.sideAccel));
    } else if (Math.abs(x) > Math.abs(full)) {
      x += Math.sign(full - x) * Math.min(perStep(cfg.sideAccel), Math.abs(full - x));
    } else {
      const b = sideBoost(tilt, tiltHeldMs);
      const cap = cfg.fineSpeed + (cfg.sideSpeed - cfg.fineSpeed) * b;
      const target = Math.sign(k) * Math.min(Math.abs(full), cap);
      const dv = perStep(cfg.fineAccel + (cfg.sideAccel - cfg.fineAccel) * b);
      if (Math.abs(x) < Math.abs(target)) x += Math.sign(target) * Math.min(dv, Math.abs(target - x));
    }
  }
  if (y <= 0) return { x, y, holdUp: false };
  if (k !== 0 || hold >= 1) return { x, y: y * (1 - config.tilt.holdDrag), holdUp: true };
  const h = Math.max(0, hold);
  return { x, y: y * (1 - config.tilt.holdDrag * h), holdUp: false, gravity: Math.min(afterFlapGravity(sinceFlapMs), 1 - h) };
}

/** Fraction of gravity acting on a fall `sinceFlapMs` after the last flap: `afterFlapGravity` easing in to 1. */
export function afterFlapGravity(sinceFlapMs: number): number {
  const cfg = config.flap;
  const p = Math.max(0, Math.min(1, sinceFlapMs / Math.max(1, cfg.afterFlapMs)));
  return cfg.afterFlapGravity + (1 - cfg.afterFlapGravity) * p * p;
}

/** How far the bird leans (deg, clockwise on screen) for a tilt: into the direction it flies. */
export const leanFor = (tilt: number) => sideAmount(tilt) * config.tilt.leanDeg;
