import { config } from '../config';
import { bothArms, classifyArms, continuousArms, oneArmWeight, outwardElevation, type PointingIntent, type PointingMode } from '../game/pointing';
import { armFilterFor, type ArmNoise } from '../pose/armSmoothing';
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

/** continuous steering: a flight by both arms is still the one to carry on by one arm this long (ms) after its last frame */
const CARRY_MS = 200;

/**
 * Pointing control: reads both arms' directions every frame (`classifyArms`). A new mode must hold for `enterMs`
 * before the bird follows it (so the arms sweeping through other poses on the way don't count); while flying, the
 * direction follows the arms straight away. Arms matching no pose keep the current mode for `ambiguousMs`, then
 * the bird rests. A drift (tilted T) with the arms lowered descends (`pointing.descend`): the sinking speed follows
 * how low the arms are, with a hysteresis to start and stop it and a smoothed speed. One arm pointing while the other
 * hangs (`pointing.oneArm`) flies slower: it must hold for `oneArmEnterMs` (so arms raised or lowered one after the
 * other don't fly by it; a flight in progress carries on as it was meanwhile), and the speed eases between both
 * arms' and one arm's (`oneArmBlendMs`). With `pointing.continuous` the arms ask for a velocity every frame instead
 * (`continuousArms`), and only the rest and the one-arm flight are debounced.
 */
export class PointingDetector {
  /**
   * the arms' noise measured at the last calibration, as `PoseSmoother.armNoise` (set both together): the EMA of the
   * arm directions runs only where `smoothing.arms` keeps today's chain (`fixed`, or `auto` with nothing measured)
   */
  armNoise: ArmNoise | null = null;
  /**
   * one arm steering for this detector: null as `pointing.oneArm` says; false or true whatever it says (a recorded
   * pose stream is played back as it was recorded: `PoseRecording.oneArm`)
   */
  oneArm: boolean | null = null;
  private left: Vec | null = null;
  private right: Vec | null = null;
  private intent: PointingIntent = { mode: 'rest', dx: 0, dy: 0 };
  /** the pose waiting to be followed: a mode, or flying by one arm (`one`), which waits longer */
  private pending: PointingMode | 'one' | null = null;
  private pendingSince = 0;
  private ambiguousSince: number | null = null;
  /** time of the last frame (ms), for the smoothing's time step */
  private lastT: number | null = null;
  /** a lowered tilted T: descending, since when it is pending, and the smoothed sinking speed (px per step) */
  private descending = false;
  private descendSince: number | null = null;
  private sink = 0;
  /** flying: the smoothed speed as a fraction of `cruiseSpeed` (1: both arms, `oneArmSpeed`: one arm) */
  private speed = 1;
  /**
   * continuous steering: how much of the one-arm flight is let through (0..1, eased), since when the one-arm pose
   * has been waiting for it, the flight by both arms the bird was on just before (null: none; with the time of its
   * last frame), which carries on meanwhile, and since when the bird has been on a flight by both arms
   */
  private oneArmGain = 0;
  private oneArmOpen = false;
  private oneArmSince: number | null = null;
  private carry: { vx: number; vy: number; t: number } | null = null;
  private flightSince: number | null = null;

  /** Back to resting with nothing pending (after a gap in the pose). */
  reset() {
    this.left = this.right = null;
    this.lastT = null;
    this.descending = false;
    this.descendSince = null;
    this.sink = 0;
    this.speed = 1;
    this.oneArmGain = 0;
    this.oneArmOpen = false;
    this.oneArmSince = null;
    this.carry = null;
    this.flightSince = null;
    this.intent = { mode: 'rest', dx: 0, dy: 0 };
    this.pending = null;
    this.pendingSince = 0;
    this.ambiguousSince = null;
  }

  update(f: PoseFrame, leftVisible: boolean, rightVisible: boolean): PointingOutput {
    // an EMA over time, not frames: the factor for this frame's time step (a slower camera: bigger steps)
    const dt = this.lastT === null ? Infinity : Math.max(0, f.t - this.lastT);
    this.lastT = f.t;
    // the EMA is part of the fixed chain only (`smoothing.arms`): off has no filter, auto its one stage in `PoseSmoother`
    const tau = armFilterFor(config.smoothing.arms, this.armNoise).kind === 'fixed' ? config.pointing.smoothingMs : 0;
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
    if (cfg.continuous) return { ...angles, ...this.continuous(f.t, dt) };
    const flying = this.intent.mode === 'fly';
    const candidate = classifyArms(this.left, this.right, this.intent.mode, !!this.intent.oneArm, this.oneArm ?? cfg.oneArm);
    if (!candidate) {
      this.pending = null;
      this.ambiguousSince ??= f.t;
      if (f.t - this.ambiguousSince >= cfg.ambiguousMs) this.intent = { mode: 'rest', dx: 0, dy: 0 };
    } else {
      this.ambiguousSince = null;
      // flying by one arm is a pose of its own: both arms' flight doesn't slip into it
      const key = candidate.oneArm ? 'one' : candidate.mode;
      if (key === (this.intent.oneArm ? 'one' : this.intent.mode)) {
        this.pending = null;
        this.intent = candidate;
      } else {
        // one arm waits longer than a pose of both: arms raised or lowered one after the other pass through it
        if (this.pending !== key) {
          this.pending = key;
          this.pendingSince = f.t;
        }
        if (f.t - this.pendingSince >= (candidate.oneArm ? cfg.oneArmEnterMs : cfg.enterMs)) {
          this.pending = null;
          this.intent = candidate;
        }
      }
    }
    return { ...angles, candidate, intent: this.withSpeed(this.withSink(f.t, dt), flying, dt) };
  }

  /**
   * The intent, a flight at its speed (`PointingIntent.speed`): one arm's `oneArmSpeed`, both arms' 1 (left out),
   * eased from the one to the other over `oneArmBlendMs` while the bird keeps flying; a flight just begun starts at
   * its own.
   */
  private withSpeed(intent: PointingIntent, wasFlying: boolean, dt: number): PointingIntent {
    if (intent.mode !== 'fly') return intent;
    const cfg = config.pointing;
    const target = intent.speed ?? 1;
    const k = !wasFlying || cfg.oneArmBlendMs <= 0 ? 1 : 1 - Math.exp(-dt / cfg.oneArmBlendMs);
    this.speed += k * (target - this.speed);
    if (Math.abs(target - this.speed) < 0.005) this.speed = target;
    // both arms at the full speed: the intent as it is, with no speed
    return this.speed === 1 && intent.speed === undefined ? intent : { ...intent, speed: this.speed };
  }

  /**
   * Continuous steering (`pointing.continuous`): the command follows the arms every frame (`continuousArms`); only
   * going to rest and leaving it must hold for `enterMs` (meanwhile the bird keeps what it had), so arms swinging
   * through the rest cone on their way don't drop it. The one-arm flight (`pointing.oneArm`) is let through
   * (`oneArmGain`) once the pose has held for `oneArmEnterMs`; until then the bird hovers, or carries on with the
   * flight by both arms it was on (`carry`). The gain eases over `oneArmBlendMs`, so the one turns into the other
   * without a step.
   */
  private continuous(t: number, dt: number): Pick<PointingOutput, 'candidate' | 'intent'> {
    const cfg = config.pointing;
    const on = this.oneArm ?? cfg.oneArm;
    if (oneArmWeight(this.left!, this.right!, on).w < 0.5) {
      // not the pose: it has to wait again. A flight by both arms is what would carry on meanwhile, once it has
      // lasted as long as a pose must (an arm on its way up from the rest points down beside the other for a moment);
      // it is remembered for `CARRY_MS`, the arm coming down passing through a frame or two of neither
      this.oneArmSince = null;
      this.oneArmOpen = false;
      const two = bothArms(this.left!, this.right!);
      this.flightSince = two.g >= 0.5 && this.intent.mode !== 'rest' ? (this.flightSince ?? t) : null;
      if (this.flightSince !== null && t - this.flightSince >= cfg.oneArmEnterMs) this.carry = { vx: two.vx, vy: two.vy, t };
      else if (this.carry && t - this.carry.t > CARRY_MS) this.carry = null;
    } else if (!this.oneArmOpen) {
      this.oneArmSince ??= t;
      if (t - this.oneArmSince >= cfg.oneArmEnterMs) this.oneArmOpen = true;
    }
    const k = cfg.oneArmBlendMs <= 0 || dt === Infinity ? 1 : 1 - Math.exp(-dt / cfg.oneArmBlendMs);
    this.oneArmGain += k * ((this.oneArmOpen ? 1 : 0) - this.oneArmGain);
    const candidate = continuousArms(this.left!, this.right!, { gain: this.oneArmGain, carry: this.carry, on });
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
