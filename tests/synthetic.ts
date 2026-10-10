import { L } from '../src/pose/landmarks';
import type { Landmark, PoseFrame } from '../src/pose/types';

export interface SynthPose {
  t: number;
  /** arm elevation, deg (0 down .. 180 up) */
  armLeft?: number;
  armRight?: number;
  /** hip drop in torso lengths */
  hipDrop?: number;
  /** knee angle, deg */
  knee?: number;
  /** override landmarks to be out of frame */
  hideLegs?: boolean;
}

const ASPECT = 16 / 9;

/** Builds a frontal standing person (normalised coords, camera NOT mirrored). */
export function synthPose(p: SynthPose): PoseFrame {
  const lm: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, v: 0.99 }));
  const torso = 0.27;
  const drop = (p.hipDrop ?? 0) * torso;
  const shY = 0.3 + drop;
  const hipY = shY + torso;
  // person's left appears on image right (x larger) for an unmirrored camera
  const set = (i: number, x: number, y: number) => (lm[i] = { x, y, v: 0.99 });
  const X = (dx: number) => 0.5 + dx / ASPECT; // dx in "height units"
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
  // legs: knee bends forward; in a frontal 2D view we model it as knees spreading outward
  const knee = ((p.knee ?? 178) * Math.PI) / 180;
  const half = (Math.PI - knee) / 2; // each segment tilts by half the bend
  const leg = (side: 1 | -1, hipI: number, kneeI: number, ankI: number) => {
    const hx = 0.05 * side;
    const kx = hx + Math.sin(half) * 0.2 * side;
    const ky = hipY + Math.cos(half) * 0.2;
    const ax = kx - Math.sin(half) * 0.2 * side;
    const ay = ky + Math.cos(half) * 0.2;
    set(hipI, X(hx), hipY);
    set(kneeI, X(kx), ky);
    set(ankI, X(ax), ay);
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
