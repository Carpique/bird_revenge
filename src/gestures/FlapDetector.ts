import { config } from '../config';
import type { PoseFrame } from '../pose/types';
import { armElevation, type Side } from './geometry';

export interface ArmState {
  /** elevation, deg (0 = down, 180 = up) */
  angle: number;
  /** smoothed angular velocity, deg/s (negative = moving down) */
  velocity: number;
  /** downstroke "power": downward speed above the dead zone, deg/s (0 when not moving down) */
  power: number;
  visible: boolean;
  /** completed strokes since start */
  strokes: number;
  /** last stroke's peak-to-trough amplitude, deg */
  lastAmplitude: number;
  /** strokes per second (decays to 0 when you stop) */
  frequency: number;
}

export interface FlapOutput {
  left: ArmState;
  right: ArmState;
  /** upward acceleration, px/s² */
  lift: number;
  /** 0 = arms down … 1 = arms up, for picking the bird's wing frame */
  wingPhase: number;
}

class ArmTracker {
  state: ArmState = { angle: 0, velocity: 0, power: 0, visible: false, strokes: 0, lastAmplitude: 0, frequency: 0 };
  private prevAngle: number | null = null;
  private prevT = 0;
  private dir: 1 | -1 | 0 = 0;
  private lastPeak: number | null = null;
  private lastStrokeT = 0;

  constructor(private side: Side) {}

  update(f: PoseFrame, visible: boolean) {
    const s = this.state;
    const cfg = config.flap;
    s.visible = visible;
    if (!visible) {
      this.prevAngle = null;
      s.velocity = 0;
      s.power = 0;
      this.decayFrequency(f.t);
      return;
    }
    const angle = armElevation(f, this.side);
    s.angle = angle;
    if (this.prevAngle === null || f.t - this.prevT > 250) {
      // first frame or tracking gap: no velocity yet
      this.prevAngle = angle;
      this.prevT = f.t;
      s.velocity = 0;
      s.power = 0;
      return;
    }
    const dt = Math.max(1, f.t - this.prevT) / 1000;
    const rawVel = (angle - this.prevAngle) / dt;
    const a = cfg.velocitySmoothing;
    s.velocity = a * rawVel + (1 - a) * s.velocity;
    s.power = Math.max(0, -s.velocity - cfg.velocityDeadzone);

    // stroke bookkeeping: a stroke = a peak followed by a trough at least strokeMinAmplitude lower
    const newDir: 1 | -1 | 0 = s.velocity > 20 ? 1 : s.velocity < -20 ? -1 : this.dir;
    if (this.dir === 1 && newDir === -1) this.lastPeak = this.prevAngle;
    if (this.dir === -1 && newDir === 1 && this.lastPeak !== null) {
      const amp = this.lastPeak - this.prevAngle;
      if (amp >= cfg.strokeMinAmplitude) {
        s.strokes++;
        s.lastAmplitude = amp;
        const interval = (f.t - this.lastStrokeT) / 1000;
        if (this.lastStrokeT > 0 && interval > 0 && interval < 3) {
          s.frequency = 0.5 * s.frequency + 0.5 * (1 / interval);
        }
        this.lastStrokeT = f.t;
      }
      this.lastPeak = null;
    }
    this.dir = newDir;
    this.prevAngle = angle;
    this.prevT = f.t;
    this.decayFrequency(f.t);
  }

  private decayFrequency(t: number) {
    if (t - this.lastStrokeT > 1500) this.state.frequency = 0;
  }
}

/**
 * Heuristic flap detector: lift comes from the *speed of downstrokes*, so it reacts mid-stroke
 * (no waiting for a full gesture). Faster / bigger flaps → more lift. Both arms must be on a downstroke
 * together: flapping one arm alone does nothing (no lift, no steering).
 */
export class FlapDetector {
  private left = new ArmTracker('left');
  private right = new ArmTracker('right');

  update(f: PoseFrame, leftVisible: boolean, rightVisible: boolean): FlapOutput {
    this.left.update(f, leftVisible);
    this.right.update(f, rightVisible);
    const l = this.left.state;
    const r = this.right.state;
    const cfg = config.flap;
    const bothDown = l.power > 0 && r.power > 0;
    const lift = bothDown ? Math.min(cfg.maxLiftAccel, (cfg.liftGain * (l.power + r.power)) / 2) : 0;
    const visAngles = [l, r].filter((a) => a.visible).map((a) => a.angle);
    const avg = visAngles.length ? visAngles.reduce((x, y) => x + y, 0) / visAngles.length : 60;
    const wingPhase = Math.max(0, Math.min(1, (avg - 20) / 140));
    return { left: { ...l }, right: { ...r }, lift, wingPhase };
  }
}
