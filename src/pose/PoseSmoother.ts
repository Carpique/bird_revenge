import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { config } from '../config';
import { ArmOcclusion } from './ArmOcclusion';
import { filtersStale } from './freshness';
import { OneEuroFilter } from './OneEuroFilter';
import { WristGate } from './WristGate';
import type { Landmark } from './types';

const N = 33;

/**
 * The tracker's landmark pipeline: the arm stand-in (`ArmOcclusion`), the wrist gate (`WristGate`), then one One-Euro filter per coordinate.
 * A frame with nobody in it changes nothing: after a short gap the smoothing carries on (the filters take the
 * larger time step into account), and only a gap of `pose.resetFiltersAfterMs` or more starts them afresh.
 */
export class PoseSmoother {
  /** stands in for an arm hidden behind the other; `occlusion.standIn` says how much, for the last frame */
  readonly occlusion = new ArmOcclusion();
  /** a wrist MediaPipe cannot see is moved onto the upper-arm line; `wristGate.gated` says which, for the last frame */
  readonly wristGate = new WristGate();
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
    const tSec = ts / 1000;
    const lm: Landmark[] = new Array(N);
    for (let i = 0; i < N; i++) {
      const fx = this.filters[i * 2];
      const fy = this.filters[i * 2 + 1];
      fx.minCutoff = fy.minCutoff = s.minCutoff;
      fx.beta = fy.beta = s.beta;
      fx.dCutoff = fy.dCutoff = s.dCutoff;
      lm[i] = { x: fx.filter(pts[i].x, tSec), y: fy.filter(pts[i].y, tSec), v: pts[i].visibility ?? 0 };
    }
    return lm;
  }
}
