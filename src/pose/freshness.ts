import { config } from '../config';

/**
 * How old the latest good pose is, as the game sees it. The one place the gap thresholds are read, so the tracker's
 * filters, the detectors, the controls and the pause logic all agree on what a gap is:
 *  - `fresh`: shorter than `pose.holdLastMs`; the last controls keep applying, nothing is reset
 *  - `lost`: shorter than `visibility.personGoneAfterMs`; the game is soft-paused, the calibration is kept
 *  - `gone`: nobody for good; back to the calibration dialog
 */
export type PoseGap = 'fresh' | 'lost' | 'gone';

/** @param ageMs time since the latest good pose (a frame with the player in it) */
export function poseGap(ageMs: number): PoseGap {
  if (ageMs < config.pose.holdLastMs) return 'fresh';
  return ageMs < config.visibility.personGoneAfterMs ? 'lost' : 'gone';
}

/** After a gap this long the person may have moved a lot: the tracker's smoothing starts afresh. */
export function filtersStale(ageMs: number): boolean {
  return ageMs >= config.pose.resetFiltersAfterMs;
}
