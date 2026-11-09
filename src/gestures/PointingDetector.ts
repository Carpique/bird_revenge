import { config } from '../config';
import { classifyArms, type PointingIntent, type PointingMode } from '../game/pointing';
import { L } from '../pose/landmarks';
import type { PoseFrame } from '../pose/types';
import { pt, type Side, type Vec } from './geometry';

export interface PointingOutput {
  /** the arm on the screen's left (the player's left), smoothed direction angle on screen, deg (0 = right, 90 = up); null when not visible */
  left: number | null;
  right: number | null;
  /** this frame's reading before debouncing, null when the arms match no pose */
  candidate: PointingIntent | null;
  /** what the arms ask of the bird, or null when an arm isn't visible */
  intent: PointingIntent | null;
}

/** An arm's direction (shoulder → wrist) as a unit vector on the mirrored screen, y up. */
function armDir(f: PoseFrame, side: Side): Vec {
  const sh = pt(f, side === 'left' ? L.leftShoulder : L.rightShoulder);
  const wr = pt(f, side === 'left' ? L.leftWrist : L.rightWrist);
  const x = -(wr.x - sh.x), y = -(wr.y - sh.y);
  const n = Math.hypot(x, y) || 1;
  return { x: x / n, y: y / n };
}

const angleOf = (v: Vec) => (Math.atan2(v.y, v.x) * 180) / Math.PI;

/**
 * Pointing control: reads both arms' directions every frame (`classifyArms`). A new mode must hold for `enterMs`
 * before the bird follows it (so the arms sweeping through other poses on the way don't count); while flying, the
 * direction follows the arms straight away. Arms matching no pose keep the current mode for `ambiguousMs`, then
 * the bird rests.
 */
export class PointingDetector {
  private left: Vec | null = null;
  private right: Vec | null = null;
  private intent: PointingIntent = { mode: 'rest', dx: 0, dy: 0 };
  private pending: PointingMode | null = null;
  private pendingSince = 0;
  private ambiguousSince: number | null = null;

  /** Back to resting with nothing pending (after a gap in the pose). */
  reset() {
    this.left = this.right = null;
    this.intent = { mode: 'rest', dx: 0, dy: 0 };
    this.pending = null;
    this.pendingSince = 0;
    this.ambiguousSince = null;
  }

  update(f: PoseFrame, leftVisible: boolean, rightVisible: boolean): PointingOutput {
    const a = config.pointing.smoothing;
    const ema = (prev: Vec | null, v: Vec): Vec => {
      if (!prev) return v;
      const x = prev.x + a * (v.x - prev.x), y = prev.y + a * (v.y - prev.y);
      const n = Math.hypot(x, y) || 1;
      return { x: x / n, y: y / n };
    };
    this.left = leftVisible ? ema(this.left, armDir(f, 'left')) : null;
    this.right = rightVisible ? ema(this.right, armDir(f, 'right')) : null;
    const angles = { left: this.left && angleOf(this.left), right: this.right && angleOf(this.right) };
    if (!this.left || !this.right) {
      this.pending = null;
      this.ambiguousSince = null;
      return { ...angles, candidate: null, intent: null };
    }

    const cfg = config.pointing;
    const candidate = classifyArms(this.left, this.right, this.intent.mode);
    if (!candidate) {
      this.pending = null;
      this.ambiguousSince ??= f.t;
      if (f.t - this.ambiguousSince >= cfg.ambiguousMs) this.intent = { mode: 'rest', dx: 0, dy: 0 };
    } else {
      this.ambiguousSince = null;
      if (candidate.mode === this.intent.mode) {
        this.pending = null;
        this.intent = candidate;
      } else {
        if (this.pending !== candidate.mode) {
          this.pending = candidate.mode;
          this.pendingSince = f.t;
        }
        if (f.t - this.pendingSince >= cfg.enterMs) {
          this.pending = null;
          this.intent = candidate;
        }
      }
    }
    return { ...angles, candidate, intent: this.intent };
  }
}
