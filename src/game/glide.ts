import { config } from '../config';

export interface GlideVelocity {
  /** new velocity, px per physics step */
  x: number;
  y: number;
  /** cancel gravity this step (the parachute is holding the fall at its target speed) */
  holdUp: boolean;
}

/**
 * How strongly a glide with the arm line at `tilt` (deg, mirrored screen, y up: + = rises to the right) dives:
 * 0 inside the dead zone, ramping to ±1 at `fullTilt`; the sign is the dive direction (+ = right on screen),
 * towards the lower hand.
 */
export function diveAmount(tilt: number): number {
  const cfg = config.glide;
  const a = Math.abs(tilt);
  const k = Math.max(0, Math.min(1, (a - cfg.deadZone) / Math.max(1, cfg.fullTilt - cfg.deadZone)));
  return -Math.sign(tilt) * k;
}

/**
 * One physics step of an airborne glide, from the bird's current velocity `v` (px per step).
 * The bird eases towards a target velocity along the arm line, down towards the lower hand:
 * speed = dive amount × `diveSpeed`, plus the parachute's `sinkSpeed` straight down. Arms level →
 * the target is just a slow sink: the fall is braked (`parachuteDrag`) and the sideways speed decays
 * (`horizontalDrag`). Tilted → the bird speeds up along the line (`diveAccel`), faster the more tilt.
 * Rising (coasting up after a flap) is left to gravity; the glide never lifts.
 */
export function glideStep(v: { x: number; y: number }, tilt: number, stepMs: number): GlideVelocity {
  const cfg = config.glide;
  const dive = diveAmount(tilt);
  const k = Math.abs(dive);
  const steep = (Math.min(90, Math.abs(tilt)) * Math.PI) / 180;
  const speed = k * cfg.diveSpeed;
  const tx = Math.sign(dive) * speed * Math.cos(steep);
  const ty = cfg.sinkSpeed + speed * Math.sin(steep);
  const maxDv = cfg.diveAccel * (stepMs / 1000) ** 2;

  let { x, y } = v;
  // sideways: speed up towards a dive; otherwise (level arms, or already faster than the dive) decay slowly
  if (k > 0 && Math.sign(dive) * (tx - x) > 0) x += Math.max(-maxDv, Math.min(maxDv, tx - x));
  else x += (tx - x) * cfg.horizontalDrag;

  // down: brake a fall faster than the target (gravity cancelled), or speed up into the dive (gravity helps)
  let holdUp = false;
  if (y > ty) {
    y += (ty - y) * cfg.parachuteDrag;
    holdUp = true;
  } else if (k > 0) {
    y += Math.min(maxDv * Math.sin(steep), ty - y);
  }
  return { x, y, holdUp };
}
