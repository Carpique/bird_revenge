import { config } from '../config';
import { glideStep, type GlideVelocity } from './glide';

/**
 * What the arm posture asks of the bird (posture control, `config.posture`):
 * - `fall`: no arm above horizontal and at least one clearly below: free fall, momentum fades
 * - `parachute`: both arms about horizontal (a T): slow sink, like the glide
 * - `fly`: the higher arm above horizontal sets the speed, the other arm (also not below horizontal) the direction
 * - `dive`: the higher arm above horizontal sets the speed, the other arm below horizontal the dive angle; no lift
 */
export type PostureMode = 'fall' | 'parachute' | 'fly' | 'dive';

export interface PostureIntent {
  mode: PostureMode;
  /** 0..1, from how far the higher arm is raised above horizontal */
  speed: number;
  /** sideways direction on screen, towards the lower arm: -1 left, +1 right, 0 straight up/none */
  dir: -1 | 0 | 1;
  /** direction of travel, deg above horizontal: 90 = straight up, 0 = sideways, -90 = straight down */
  angle: number;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/**
 * Maps the two arms' angles to a flight intent. `left` and `right` are the player's arms (which appear on the
 * screen's left and right, mirrored view), in deg above horizontal: 90 = straight up, 0 = T, -90 = hanging down.
 */
export function postureIntent(left: number, right: number): PostureIntent {
  const cfg = config.posture;
  const dz = cfg.deadZone;
  const hi = Math.max(left, right);
  const lo = Math.min(left, right);
  // towards the lower arm
  const dir: -1 | 0 | 1 = left === right ? 0 : left > right ? 1 : -1;
  const speed = clamp01((hi - dz) / Math.max(1, cfg.fullRaise - dz));

  if (speed === 0) {
    const mode = lo >= -dz ? 'parachute' : 'fall';
    return { mode, speed: 0, dir: 0, angle: mode === 'parachute' ? 0 : -90 };
  }
  if (lo >= -dz) {
    // other arm level → sideways; as high as the speed arm (within the dead zone) → straight up
    const angle = 90 * clamp01(Math.max(0, lo) / Math.max(1, hi - dz));
    return { mode: 'fly', speed, dir: angle >= 90 ? 0 : dir, angle };
  }
  // other arm below horizontal: dive, the lower it is the steeper
  const depth = clamp01((-lo - dz) / Math.max(1, cfg.fullRaise - dz));
  return { mode: 'dive', speed, dir, angle: -90 * depth };
}

/** Moves `v` towards `t` by at most `maxDv` (as a vector). */
function approach(v: { x: number; y: number }, t: { x: number; y: number }, maxDv: number) {
  const dx = t.x - v.x, dy = t.y - v.y;
  const d = Math.hypot(dx, dy);
  if (d <= maxDv) return { x: t.x, y: t.y };
  return { x: v.x + (dx / d) * maxDv, y: v.y + (dy / d) * maxDv };
}

/**
 * One physics step under posture control, from the bird's current velocity `v` (px per step, y down).
 * `holdUp` asks the caller to cancel gravity this step (flying holds the bird up; diving and falling don't).
 */
export function postureStep(v: { x: number; y: number }, p: PostureIntent, stepMs: number): GlideVelocity {
  const cfg = config.posture;
  const maxDv = cfg.accel * (stepMs / 1000) ** 2;
  const a = (p.angle * Math.PI) / 180;
  switch (p.mode) {
    case 'parachute':
      return glideStep(v, 0, stepMs);
    case 'fall': {
      // lift gone: sideways and upward momentum fade, gravity takes over
      const k = 1 - cfg.fallDrag;
      return { x: v.x * k, y: v.y < 0 ? v.y * k : v.y, holdUp: false };
    }
    case 'fly': {
      const s = p.speed * cfg.flySpeed;
      // a slow fly still sinks a bit, blending into the parachute as the speed arm comes down to level
      const t = { x: p.dir * s * Math.cos(a), y: -s * Math.sin(a) + (1 - p.speed) * config.glide.sinkSpeed };
      return { ...approach(v, t, maxDv), holdUp: true };
    }
    case 'dive': {
      const s = p.speed * cfg.diveSpeed;
      const tx = p.dir * s * Math.cos(a);
      const ty = -s * Math.sin(a); // a < 0: down
      const x = v.x + Math.max(-maxDv, Math.min(maxDv, tx - v.x));
      // gravity always pulls; push down too while slower than the dive
      const y = v.y < ty ? v.y + Math.min(maxDv, ty - v.y) : v.y;
      return { x, y, holdUp: false };
    }
  }
}

/** How far the bird leans (deg, clockwise on screen) for an intent: into the direction of travel, more in a dive. */
export function postureLean(p: PostureIntent): number {
  if (p.mode === 'fall' || p.mode === 'parachute' || p.dir === 0) return 0;
  const k = p.mode === 'dive' ? Math.max(p.speed, 0.5) : p.speed;
  return p.dir * config.posture.leanDeg * ((90 - p.angle) / 90) * k;
}
