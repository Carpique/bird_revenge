import { L } from '../src/pose/landmarks';
import type { Landmark, PoseFrame } from '../src/pose/types';

export interface SynthPose {
  t: number;
  /** arm elevation, deg (0 down .. 180 up) */
  armLeft?: number;
  armRight?: number;
  /** squat depth: 0 standing, 1 hips level with knees (feet stay put) */
  squat?: number;
  /** lift this leg's foot (the person's own side) by `raiseBy` image heights */
  raiseLeg?: 'left' | 'right';
  raiseBy?: number;
  /** body size relative to the default, scaled about the feet (< 1 = stepped back) */
  scale?: number;
  /** override landmarks to be out of frame */
  hideLegs?: boolean;
}

const ASPECT = 16 / 9;

/** Builds a frontal standing person (normalised coords, camera NOT mirrored). */
export function synthPose(p: SynthPose): PoseFrame {
  const lm: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, v: 0.99 }));
  const torso = 0.27;
  const thigh = 0.2;
  const sq = p.squat ?? 0;
  const drop = sq * thigh;
  const shY = 0.3 + drop;
  const hipY = shY + torso;
  // person's left appears on image right (x larger) for an unmirrored camera
  const S = p.scale ?? 1;
  const FEET_Y = 0.97;
  const set = (i: number, x: number, y: number) => (lm[i] = { x, y: FEET_Y + (y - FEET_Y) * S, v: 0.99 });
  const X = (dx: number) => 0.5 + (dx * S) / ASPECT; // dx in "height units"
  set(L.nose, X(0), shY - 0.12);
  set(L.leftEye, X(0.02), shY - 0.14);
  set(L.rightEye, X(-0.02), shY - 0.14);
  set(L.leftShoulder, X(0.07), shY);
  set(L.rightShoulder, X(-0.07), shY);
  set(L.leftHip, X(0.05), hipY);
  set(L.rightHip, X(-0.05), hipY);
  const arm = (side: 1 | -1, deg: number, elbow: number, wrist: number) => {
    const a = (deg * Math.PI) / 180;
    const sx = 0.07 * side;
    // rotate the "down" direction outward by `deg`
    const dx = Math.sin(a) * side;
    const dy = Math.cos(a);
    set(elbow, X(sx + dx * 0.13), shY + dy * 0.13);
    set(wrist, X(sx + dx * 0.26), shY + dy * 0.26);
  };
  arm(1, p.armLeft ?? 10, L.leftElbow, L.leftWrist);
  arm(-1, p.armRight ?? 10, L.rightElbow, L.rightWrist);
  // legs: feet fixed on the floor, knees stay at the same height (they move towards the camera)
  // and spread out a little, hips come down towards knee level
  const leg = (side: 1 | -1, hipI: number, kneeI: number, ankI: number) => {
    const hx = 0.05 * side;
    const lift = p.raiseLeg === (side === 1 ? 'left' : 'right') ? (p.raiseBy ?? 0.12) : 0;
    set(hipI, X(hx), hipY);
    set(kneeI, X(hx + 0.05 * sq * side), 0.57 + thigh - lift / 2);
    set(ankI, X(hx), FEET_Y - lift);
  };
  leg(1, L.leftHip, L.leftKnee, L.leftAnkle);
  leg(-1, L.rightHip, L.rightKnee, L.rightAnkle);
  if (p.hideLegs) {
    for (const i of [L.leftKnee, L.leftAnkle, L.rightKnee, L.rightAnkle]) lm[i] = { ...lm[i], y: 1.05, v: 0.3 };
  }
  return { t: p.t, lm, aspect: ASPECT };
}

/** 30 fps timeline helper */
export function frames(durationMs: number, fn: (t: number) => Omit<SynthPose, 't'>, startT = 0): PoseFrame[] {
  const out: PoseFrame[] = [];
  for (let t = startT; t < startT + durationMs; t += 1000 / 30) out.push(synthPose({ t, ...fn(t) }));
  return out;
}
