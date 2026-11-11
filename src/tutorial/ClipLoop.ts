import { L } from '../pose/landmarks';
import type { PoseFrame } from '../pose/types';
import { toPoseFrame, type PoseRecording } from './recording';

/**
 * A recording's clip as plain moves, round and round, for drawing a figure (no detectors, no game): the pose at any
 * time, and the player's usual height of the hips and length of the torso, to place and size the figure steadily.
 */
export class ClipLoop {
  readonly aspect: number;
  /** the median hip centre's height (0..1 down the image) and torso length (shoulders to hips, in image heights) */
  readonly hipY: number;
  readonly torso: number;
  /** the lowest the ankles get (0..1 down the image; a high percentile, past the odd stray landmark) */
  readonly feetY: number;
  private frames: { t: number; f: PoseFrame }[];
  private start: number;
  private length: number;

  constructor(rec: PoseRecording) {
    this.aspect = rec.aspect;
    this.start = rec.startMs;
    this.length = Math.max(1, rec.endMs - rec.startMs);
    // nobody in view: the last pose stays
    this.frames = rec.frames
      .filter((f) => f.t >= rec.startMs && f.t <= rec.endMs)
      .map((f) => ({ t: f.t, f: toPoseFrame(f, rec.aspect) }))
      .filter((f): f is { t: number; f: PoseFrame } => f.f !== null);
    const hips = this.frames.map(({ f }) => (f.lm[L.leftHip].y + f.lm[L.rightHip].y) / 2);
    const torsos = this.frames.map(({ f }) => torsoLength(f));
    this.hipY = median(hips);
    this.torso = median(torsos);
    const ankles = this.frames.map(({ f }) => Math.max(f.lm[L.leftAnkle].y, f.lm[L.rightAnkle].y));
    this.feetY = quantile(ankles, 0.98);
  }

  /** The pose `ms` into the loop; null if the clip has none. */
  frameAt(ms: number): PoseFrame | null {
    const fs = this.frames;
    if (!fs.length) return null;
    const t = this.start + (((ms % this.length) + this.length) % this.length);
    // the last frame at or before t
    let lo = 0, hi = fs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (fs[mid].t <= t) lo = mid;
      else hi = mid - 1;
    }
    return fs[lo].f;
  }
}

/** shoulder centre to hip centre, in image heights */
export function torsoLength(f: PoseFrame) {
  const p = f.lm;
  const dx = ((p[L.leftShoulder].x + p[L.rightShoulder].x) / 2 - (p[L.leftHip].x + p[L.rightHip].x) / 2) * f.aspect;
  const dy = (p[L.leftShoulder].y + p[L.rightShoulder].y) / 2 - (p[L.leftHip].y + p[L.rightHip].y) / 2;
  return Math.hypot(dx, dy);
}

function median(xs: number[]) {
  return quantile(xs, 0.5);
}

function quantile(xs: number[], q: number) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))];
}
