import { config } from '../config';
import { classifyArms, continuousArms, outwardElevation, type PointingIntent, type PointingMode } from '../game/pointing';
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
 * the bird rests. A drift (tilted T) with the arms lowered descends (`pointing.descend`): the sinking speed follows
 * how low the arms are, with a hysteresis to start and stop it and a smoothed speed. With `pointing.continuous` the
 * arms ask for a velocity every frame instead (`continuousArms`), and only the rest is debounced.
 */
export class PointingDetector {
  private left: Vec | null = null;
  private right: Vec | null = null;
  private intent: PointingIntent = { mode: 'rest', dx: 0, dy: 0 };
  private pending: PointingMode | null = null;
  private pendingSince = 0;
  private ambiguousSince: number | null = null;
  /** time of the last frame (ms), for the smoothing's time step */
  private lastT: number | null = null;
  /** a lowered tilted T: descending, since when it is pending, and the smoothed sinking speed (px per step) */
  private descending = false;
  private descendSince: number | null = null;
  private sink = 0;

  /** Back to resting with nothing pending (after a gap in the pose). */
  reset() {
    this.left = this.right = null;
    this.lastT = null;
    this.descending = false;
    this.descendSince = null;
    this.sink = 0;
    this.intent = { mode: 'rest', dx: 0, dy: 0 };
    this.pending = null;
    this.pendingSince = 0;
    this.ambiguousSince = null;
  }

  update(f: PoseFrame, leftVisible: boolean, rightVisible: boolean): PointingOutput {
    // an EMA over time, not frames: the factor for this frame's time step (a slower camera: bigger steps)
    const dt = this.lastT === null ? Infinity : Math.max(0, f.t - this.lastT);
    this.lastT = f.t;
    const tau = config.pointing.smoothingMs;
    const a = tau <= 0 ? 1 : 1 - Math.exp(-dt / tau);
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
    if (cfg.continuous) return { ...angles, ...this.continuous(f.t) };
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
    return { ...angles, candidate, intent: this.withSink(f.t, dt) };
  }

  /**
   * Continuous steering (`pointing.continuous`): the command follows the arms every frame (`continuousArms`); only
   * going to rest and leaving it must hold for `enterMs` (meanwhile the bird keeps what it had), so arms swinging
   * through the rest cone on their way don't drop it.
   */
  private continuous(t: number): Pick<PointingOutput, 'candidate' | 'intent'> {
    const candidate = continuousArms(this.left!, this.right!);
    this.ambiguousSince = null;
    this.descending = false;
    this.descendSince = null;
    this.sink = 0;
    const resting = this.intent.mode === 'rest';
    if ((candidate.mode === 'rest') === resting) {
      this.pending = null;
      this.intent = candidate;
    } else {
      // going to rest or leaving it is the only change that waits: pending since the first frame of it, whatever
      // label the command has meanwhile
      if (this.pending === null) {
        this.pending = candidate.mode;
        this.pendingSince = t;
      }
      if (t - this.pendingSince >= config.pointing.enterMs) {
        this.pending = null;
        this.intent = candidate;
      }
    }
    return { candidate, intent: this.intent };
  }

  /** The intent, a drift with the arms lowered descending (`pointing.descend*`). */
  private withSink(t: number, dt: number): PointingIntent {
    const cfg = config.pointing;
    const intent = this.intent;
    if (!cfg.descend || intent.mode !== 'drift' || !this.left || !this.right) {
      this.descending = false;
      this.descendSince = null;
      this.sink = 0;
      return intent;
    }
    // how far below level the arms are, on average (deg; negative: raised)
    const lowered = -(outwardElevation(this.left, -1) + outwardElevation(this.right, 1)) / 2;
    if (!this.descending) {
      if (lowered >= cfg.descendEnter) {
        this.descendSince ??= t;
        if (t - this.descendSince >= cfg.enterMs) this.descending = true;
      } else this.descendSince = null;
    } else if (lowered < cfg.descendExit) {
      this.descending = false;
      this.descendSince = null;
    }
    const span = Math.max(1e-6, cfg.descendFull - cfg.descendZero);
    const target = this.descending ? cfg.descendSpeed * Math.min(1, Math.max(0, (lowered - cfg.descendZero) / span)) : 0;
    const k = cfg.descendSmoothMs <= 0 ? 1 : 1 - Math.exp(-dt / cfg.descendSmoothMs);
    this.sink += k * (target - this.sink);
    if (target === 0 && this.sink < 0.02) this.sink = 0;
    return this.sink > 0 ? { ...intent, sink: this.sink } : intent;
  }
}
