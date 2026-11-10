import { config } from '../config';
import { noControls, type Controls } from './controls';
import { poseGap } from '../pose/freshness';
import { controlsFrom, type PoseReading } from './poseControls';

/** What one pose frame makes the game do, decided by `PoseSession.update`. */
export interface PoseStep<S extends string> {
  /** the app state after the frame (`calibrating` when `recalibrate` is set) */
  state: S | 'calibrating' | 'playing' | 'outOfFrame';
  /** someone off to the side: the tracker should look again for whoever is in front of the camera */
  redetect: boolean;
  /** nobody in front of the camera any more: back to the big calibration dialog (reset it, then run it on this frame) */
  recalibrate: boolean;
  /** the poo button is pressed by the pose (the shoot gesture) */
  shoot: boolean;
}

/**
 * The game-side decisions on the pose stream, apart from the camera, the detectors and the screen: which state
 * a frame leads to, which controls it gives the bird, and what a gap in the pose does. Used by `main.ts`, and driven
 * by the replay tests (`tests/replay/`), so the tests run the very rules the game does.
 *
 * Pose freshness is one thing here: the age of the latest good pose (a frame with the player in it, `lastGoodT`),
 * read through `poseGap`. Fresh (a short gap): the last controls keep applying. Lost: the game pauses softly
 * (outOfFrame, no penalty, calibration kept) and resumes once the player is back. Gone (nobody in view at all, not
 * just the player off centre): the calibration dialog.
 * The gap counts frames that came without the player and frames that did not come at all, so `tick` (between
 * frames, on the render ticker) is as much part of it as `update`.
 *
 * States named here: calibrating, countdown, playing, outOfFrame; any other state is left alone.
 */
export class PoseSession {
  private poseControls: Controls = noControls();
  /** ms time of the latest good pose; null: the camera has just (re)started, nothing counted yet */
  private lastGoodT: number | null = null;
  /** ms time of the latest frame with anybody in it (the player or not) */
  private lastFrameT: number | null = null;
  private lastRedetectT = -Infinity;

  /** `now`: ms, in the frames' time. Call on every pose frame (also an empty one), with the detectors' reading. */
  update<S extends string>(state: S, reading: PoseReading, now: number): PoseStep<S> {
    const { vis } = reading;
    const step: PoseStep<S> = { state, redetect: false, recalibrate: false, shoot: false };
    // someone off to the side may be another person the tracker latched onto: make it look again for whoever
    // is in front of the camera
    if (vis.personDetected && !vis.centred && now - this.lastRedetectT >= config.visibility.redetectEveryMs) {
      this.lastRedetectT = now;
      step.redetect = true;
    }
    const frame = !!reading.flap;
    const good = frame && vis.playerPresent;
    // the gap that this frame ends is judged first: a frame arriving before the ticker after a long stall must
    // not hide it (the outcome would depend on which callback the browser runs first)
    const wasGone = this.lastGoodT !== null && this.isGone(now);
    if (frame) this.lastFrameT = now;
    // the first frame after a restart starts the count, a good one renews it
    if (good || this.lastGoodT === null) this.lastGoodT = now;
    if (wasGone && this.active(state)) {
      step.recalibrate = true;
      step.state = 'calibrating';
      return this.dropControls(step);
    }
    if (this.byGap(step, now)) return this.dropControls(step);
    const s: string = state;
    switch (s) {
      case 'countdown':
        if (!vis.inFrame) step.state = 'outOfFrame';
        break;
      case 'outOfFrame':
        // a frame without the player doesn't bring the game back, even when the parts still count as visible
        if (good && vis.inFrame) {
          step.state = 'playing';
          this.take(reading, step); // the bird flies on this very frame
        }
        break;
      case 'playing': {
        if (!vis.inFrame) {
          step.state = 'outOfFrame';
          break;
        }
        // a frame without the player: the last controls go on (until the gap is no more fresh)
        if (good) this.take(reading, step);
        break;
      }
    }
    return step.state === 'playing' ? step : this.dropControls(step);
  }

  /**
   * Between frames, on every render tick: a gap in the pose goes on even when no frame comes (the camera or the
   * page stalled). Returns the state (and `recalibrate`) it leads to; nothing else is decided here.
   */
  tick<S extends string>(state: S, now: number): PoseStep<S> {
    const step: PoseStep<S> = { state, redetect: false, recalibrate: false, shoot: false };
    if (this.lastGoodT !== null) this.byGap(step, now);
    return step;
  }

  /** No frames with anybody in them for longer than a short gap: the tracking is lost (not only the player's place). */
  framesLost(now: number): boolean {
    return this.lastFrameT !== null && poseGap(now - this.lastFrameT) !== 'fresh';
  }

  /** The controls the pose gives the bird now: the latest ones while playing and fresh, otherwise none. */
  controls(state: string, now: number): Controls {
    return state === 'playing' && this.lastGoodT !== null && poseGap(now - this.lastGoodT) === 'fresh' ? this.poseControls : noControls();
  }

  /** The camera went off: no gap is counted, and stale pose controls must not apply until a fresh frame arrives. */
  clear() {
    this.lastGoodT = null;
    this.lastFrameT = null;
    this.poseControls = noControls();
  }

  /**
   * What the gap does to the game: soft pause, or the calibration dialog. True when it decided (`step.state` set).
   * The player not in the good place (off centre) but a person still in view only soft-pauses, however long; the
   * calibration dialog needs nobody in view for `visibility.personGoneAfterMs`.
   */
  private byGap<S extends string>(step: PoseStep<S>, now: number): boolean {
    const s: string = step.state;
    if (!this.active(s)) return false;
    if (this.isGone(now)) {
      step.recalibrate = true;
      step.state = 'calibrating';
      return true;
    }
    if (poseGap(now - this.lastGoodT!) === 'fresh') return false;
    if (s !== 'outOfFrame') step.state = 'outOfFrame';
    return true;
  }

  /** Nobody in view (no frame with a person, the player or not) for `visibility.personGoneAfterMs`. */
  private isGone(now: number): boolean {
    const personT = Math.max(this.lastGoodT!, this.lastFrameT ?? -Infinity);
    return poseGap(now - personT) === 'gone';
  }

  private active(s: string) {
    return s === 'countdown' || s === 'playing' || s === 'outOfFrame';
  }

  private take<S extends string>(reading: PoseReading, step: PoseStep<S>) {
    const controls = controlsFrom(reading);
    if (!controls) return;
    this.poseControls = controls;
    step.shoot = !!reading.shoot?.triggered;
  }

  private dropControls<S extends string>(step: PoseStep<S>): PoseStep<S> {
    this.poseControls = noControls();
    return step;
  }
}
