import { L } from '../src/pose/landmarks';
import type { Landmark, PoseFrame } from '../src/pose/types';

export interface SynthPose {
  t: number;
  /** arm elevation, deg (0 down .. 180 up) */
  armLeft?: number;
  armRight?: number;
  /** leg swung out sideways, deg from straight down (the person's own side) */
  legLeft?: number;
  legRight?: number;
  /** upper body (head, shoulders, arms) leaning sideways from the hips, deg (+ = towards the person's left); the legs stay put */
  lean?: number;
  /** body size relative to the default, scaled about the feet (< 1 = stepped back) */
  scale?: number;
  /** legs out of frame (low visibility, positions still estimated) */
  hideLegs?: boolean;
  /** hips (and legs) below the frame */
  hideHips?: boolean;
}

const ASPECT = 16 / 9;

/** Builds a frontal standing person (normalised coords, camera NOT mirrored). */
export function synthPose(p: SynthPose): PoseFrame {
  const lm: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, v: 0.99 }));
  const torso = 0.27;
  const thigh = 0.2;
  const shY = 0.3;
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
  // legs: straight, rotated outward about the hip by `legLeft` / `legRight`
  const leg = (side: 1 | -1, deg: number, hipI: number, kneeI: number, ankI: number) => {
    const hx = 0.05 * side;
    const a = (deg * Math.PI) / 180;
    const dx = Math.sin(a) * side;
    const dy = Math.cos(a);
    const shin = FEET_Y - hipY - thigh;
    set(hipI, X(hx), hipY);
    set(kneeI, X(hx + dx * thigh), hipY + dy * thigh);
    set(ankI, X(hx + dx * (thigh + shin)), hipY + dy * (thigh + shin));
  };
  leg(1, p.legLeft ?? 0, L.leftHip, L.leftKnee, L.leftAnkle);
  leg(-1, p.legRight ?? 0, L.rightHip, L.rightKnee, L.rightAnkle);
  // lean: rotate the upper body about the hip centre, in undistorted space
  if (p.lean) {
    const a = (p.lean * Math.PI) / 180;
    const cx = 0.5 * ASPECT;
    const cy = lm[L.leftHip].y;
    for (const i of [L.nose, L.leftEye, L.rightEye, L.leftShoulder, L.rightShoulder, L.leftElbow, L.rightElbow, L.leftWrist, L.rightWrist]) {
      const dx = lm[i].x * ASPECT - cx;
      const dy = lm[i].y - cy;
      lm[i] = { ...lm[i], x: (cx + dx * Math.cos(a) - dy * Math.sin(a)) / ASPECT, y: cy + dx * Math.sin(a) + dy * Math.cos(a) };
    }
  }
  // legs out of frame: MediaPipe still estimates them, just with low visibility
  if (p.hideLegs) for (const i of [L.leftKnee, L.leftAnkle, L.rightKnee, L.rightAnkle]) lm[i] = { ...lm[i], v: 0.3 };
  if (p.hideHips) for (const i of [L.leftHip, L.rightHip, L.leftKnee, L.leftAnkle, L.rightKnee, L.rightAnkle]) lm[i] = { ...lm[i], y: 1.05, v: 0.3 };
  return { t: p.t, lm, aspect: ASPECT };
}

/** 30 fps timeline helper */
export function frames(durationMs: number, fn: (t: number) => Omit<SynthPose, 't'>, startT = 0): PoseFrame[] {
  const out: PoseFrame[] = [];
  for (let t = startT; t < startT + durationMs; t += 1000 / 30) out.push(synthPose({ t, ...fn(t) }));
  return out;
}
