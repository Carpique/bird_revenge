import { L } from '../pose/landmarks';
import type { Landmark, PoseFrame } from '../pose/types';

export interface Vec {
  x: number;
  y: number;
}

/** Landmark in an undistorted space: x scaled by aspect so angles are true angles. */
export function pt(f: PoseFrame, i: number): Vec {
  const p = f.lm[i];
  return { x: p.x * f.aspect, y: p.y };
}

export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const mid = (a: Vec, b: Vec): Vec => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const len = (a: Vec) => Math.hypot(a.x, a.y);

/** Unsigned angle between two vectors, degrees 0..180. */
export function angleBetween(u: Vec, v: Vec): number {
  const d = (u.x * v.x + u.y * v.y) / (len(u) * len(v) || 1);
  return (Math.acos(Math.max(-1, Math.min(1, d))) * 180) / Math.PI;
}

export type Side = 'left' | 'right';

/**
 * Arm elevation: angle between "down the torso" (shoulder → hip) and the arm (shoulder → wrist).
 * 0° = arm hanging down, 90° = horizontal, 180° = straight up.
 */
export function armElevation(f: PoseFrame, side: Side): number {
  const sh = pt(f, side === 'left' ? L.leftShoulder : L.rightShoulder);
  const hip = pt(f, side === 'left' ? L.leftHip : L.rightHip);
  const wr = pt(f, side === 'left' ? L.leftWrist : L.rightWrist);
  return angleBetween(sub(hip, sh), sub(wr, sh));
}

/**
 * Arm angle in the image: between straight down the image (not the torso) and the arm (shoulder → wrist).
 * 0° = hanging down, 90° = horizontal, 180° = straight up. Leaning the whole body tilts it too.
 */
export function armAngleInImage(f: PoseFrame, side: Side): number {
  const sh = pt(f, side === 'left' ? L.leftShoulder : L.rightShoulder);
  const wr = pt(f, side === 'left' ? L.leftWrist : L.rightWrist);
  return angleBetween({ x: 0, y: 1 }, sub(wr, sh));
}

/** Elbow angle: 180° = straight arm. */
export function elbowAngle(f: PoseFrame, side: Side): number {
  const sh = pt(f, side === 'left' ? L.leftShoulder : L.rightShoulder);
  const el = pt(f, side === 'left' ? L.leftElbow : L.rightElbow);
  const wr = pt(f, side === 'left' ? L.leftWrist : L.rightWrist);
  return angleBetween(sub(sh, el), sub(wr, el));
}

/** Knee angle: 180° = straight leg. */
export function kneeAngle(f: PoseFrame, side: Side): number {
  const hip = pt(f, side === 'left' ? L.leftHip : L.rightHip);
  const knee = pt(f, side === 'left' ? L.leftKnee : L.rightKnee);
  const ank = pt(f, side === 'left' ? L.leftAnkle : L.rightAnkle);
  return angleBetween(sub(hip, knee), sub(ank, knee));
}

export function hipCenter(f: PoseFrame): Vec {
  return mid(pt(f, L.leftHip), pt(f, L.rightHip));
}

export function shoulderCenter(f: PoseFrame): Vec {
  return mid(pt(f, L.leftShoulder), pt(f, L.rightShoulder));
}

/** Shoulder-centre to hip-centre distance (normalised image height units). */
export function torsoLength(f: PoseFrame): number {
  return len(sub(hipCenter(f), shoulderCenter(f)));
}

/**
 * Hip abduction: angle of the thigh (hip → knee) away from "down the torso" (shoulder centre → hip
 * centre), signed so that positive = the leg swings out to its own side, negative = across the body.
 * 0° = leg in line with the torso. Measured against the torso rather than the image vertical, so a
 * tilted camera or the body swaying while flapping doesn't change it.
 */
export function hipAbduction(f: PoseFrame, side: Side): number {
  const hipC = hipCenter(f);
  const down = sub(hipC, shoulderCenter(f));
  const hip = pt(f, side === 'left' ? L.leftHip : L.rightHip);
  const knee = pt(f, side === 'left' ? L.leftKnee : L.rightKnee);
  // unit vector perpendicular to the torso axis, pointing towards this hip
  const d = len(down) || 1;
  let out = { x: -down.y / d, y: down.x / d };
  const toHip = sub(hip, hipC);
  if (out.x * toHip.x + out.y * toHip.y < 0) out = { x: -out.x, y: -out.y };
  const thigh = sub(knee, hip);
  const along = (thigh.x * down.x + thigh.y * down.y) / d;
  const across = thigh.x * out.x + thigh.y * out.y;
  return (Math.atan2(across, along) * 180) / Math.PI;
}

export function isVisible(p: Landmark, minVis: number, margin: number): boolean {
  return p.v >= minVis && p.x >= margin && p.x <= 1 - margin && p.y >= margin && p.y <= 1 - margin;
}
