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

export function kneeCenter(f: PoseFrame): Vec {
  return mid(pt(f, L.leftKnee), pt(f, L.rightKnee));
}

/** Vertical knee-centre minus hip-centre distance: shrinks to ~0 when the hips reach knee level. */
export function thighDrop(f: PoseFrame): number {
  return kneeCenter(f).y - hipCenter(f).y;
}

export function ankleCenter(f: PoseFrame): Vec {
  return mid(pt(f, L.leftAnkle), pt(f, L.rightAnkle));
}

/** Vertical ankle-centre minus hip-centre distance: how high the hips are above the feet. */
export function hipHeight(f: PoseFrame): number {
  return ankleCenter(f).y - hipCenter(f).y;
}

/** Shoulder-centre to hip-centre distance (normalised image height units). */
export function torsoLength(f: PoseFrame): number {
  return len(sub(hipCenter(f), shoulderCenter(f)));
}

export function isVisible(p: Landmark, minVis: number, margin: number): boolean {
  return p.v >= minVis && p.x >= margin && p.x <= 1 - margin && p.y >= margin && p.y <= 1 - margin;
}
