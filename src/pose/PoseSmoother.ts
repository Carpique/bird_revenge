import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { config } from '../config';
import { ArmOcclusion } from './ArmOcclusion';
import { armFilterFor, type ArmFilter, type ArmNoise } from './armSmoothing';
import { filtersStale } from './freshness';
import { OneEuroFilter } from './OneEuroFilter';
import { WristGate } from './WristGate';
import type { Landmark } from './types';

const N = 33;
/** the elbows, wrists and hands (MediaPipe's 13..22): they steer the bird, so they get `smoothing.armBeta` */
const FIRST_ARM = 13;
const LAST_ARM = 22;
/**
 * the shoulders (11, 12), the other end of every arm direction: filtered as the body in every variant (unfiltered in
 * `off` they changed little on the recordings: mean delay 130 / 63 / 89 -> 121 / 67 / 90 ms, flicker 6 / 1 / 6 ->
 * 6 / 1 / 5), and in `auto` no less than the arms (a cutoff below `minCutoff` applies to them too: their noise is
 * half the arm angle's variance)
 */
const SHOULDERS = [11, 12];

/**
 * The tracker's landmark pipeline: the arm stand-in (`ArmOcclusion`), the wrist gate (`WristGate`), then one One-Euro filter per coordinate.
 * The arms (13..22) follow `smoothing.arms` (`armFilterFor`): today's, none, or a cutoff from the measured noise.
 * A frame with nobody in it changes nothing: after a short gap the smoothing carries on (the filters take the
 * larger time step into account), and only a gap of `pose.resetFiltersAfterMs` or more starts them afresh.
 */
export class PoseSmoother {
  /** stands in for an arm hidden behind the other; `occlusion.standIn` says how much, for the last frame */
  readonly occlusion = new ArmOcclusion();
  /** a wrist MediaPipe cannot see is moved onto the upper-arm line; `wristGate.gated` says which, for the last frame */
  readonly wristGate = new WristGate();
  /** the arms' noise measured at the last calibration (`ArmNoiseMeter`), for `smoothing.arms` = auto; null: none */
  armNoise: ArmNoise | null = null;
  /** the arms' smoothing in force for the last frame (`smoothing.arms`, the measured noise, the control mode) */
  armFilter: ArmFilter = { kind: 'fixed' };
  private filters = Array.from({ length: N * 2 }, () => new OneEuroFilter());
  /** ms time of the last frame with a person; null: none since the start or the last reset */
  private lastValidT: number | null = null;

  /** Forget the person being followed: the next frame is taken as it is. */
  reset() {
    this.filters.forEach((f) => f.reset());
    this.occlusion.reset();
    this.wristGate.reset();
    this.lastValidT = null;
  }

  /** @param raw MediaPipe's landmarks, null: nobody in view; @param ts ms */
  process(raw: NormalizedLandmark[] | null, aspect: number, ts: number): Landmark[] | null {
    if (!raw || raw.length < N) return null;
    if (this.lastValidT !== null && filtersStale(ts - this.lastValidT)) this.reset();
    this.lastValidT = ts;
    const pts = this.wristGate.apply(this.occlusion.apply(raw, aspect));
    const s = config.smoothing;
    const af = (this.armFilter = armFilterFor(s.arms, this.armNoise));
    const tSec = ts / 1000;
    const lm: Landmark[] = new Array(N);
    for (let i = 0; i < N; i++) {
      const fx = this.filters[i * 2];
      const fy = this.filters[i * 2 + 1];
      const arm = i >= FIRST_ARM && i <= LAST_ARM;
      const lowpass = af.kind === 'lowpass' ? af.cutoff : null;
      fx.minCutoff = fy.minCutoff =
        lowpass === null ? s.minCutoff : arm ? lowpass : i === SHOULDERS[0] || i === SHOULDERS[1] ? Math.min(lowpass, s.minCutoff) : s.minCutoff;
      fx.beta = fy.beta = arm ? s.armBeta : s.beta;
      fx.dCutoff = fy.dCutoff = s.dCutoff;
      // the arms unfiltered (off): the filters still run, so switching back mid-game does not jump
      const x = fx.filter(pts[i].x, tSec), y = fy.filter(pts[i].y, tSec);
      lm[i] = arm && af.kind === 'off' ? { x: pts[i].x, y: pts[i].y, v: pts[i].visibility ?? 0 } : { x, y, v: pts[i].visibility ?? 0 };
    }
    return lm;
  }
}
