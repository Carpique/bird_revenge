import { config } from '../config';
import { noControls, type Controls } from './controls';
import { controlsFrom, POSE_STALE_MS, type PoseReading } from './poseControls';

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
 * a frame leads to, which controls it gives the bird, and when they have gone stale. Used by `main.ts`, and driven
 * by the replay tests (`tests/replay/`), so the tests run the very rules the game does.
 *
 * States named here: calibrating, countdown, playing, outOfFrame; any other state is left alone.
 */
export class PoseSession {
  private poseControls: Controls = noControls();
  private lastPoseT = 0;
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
    const s: string = state;
    // nobody in front of the camera any more: the big calibration dialog, as at the start
    if ((s === 'countdown' || s === 'playing' || s === 'outOfFrame') && !vis.playerPresent) {
      step.recalibrate = true;
      step.state = 'calibrating';
      return step;
    }
    switch (s) {
      case 'countdown':
        if (!vis.inFrame) step.state = 'outOfFrame';
        break;
      case 'outOfFrame':
        if (vis.inFrame) step.state = 'playing';
        break;
      case 'playing': {
        if (!vis.inFrame) {
          step.state = 'outOfFrame';
          break;
        }
        const controls = controlsFrom(reading);
        if (!controls) break;
        this.poseControls = controls;
        this.lastPoseT = now;
        step.shoot = !!reading.shoot?.triggered;
        break;
      }
    }
    return step;
  }

  /** The controls the pose gives the bird now: the latest ones while playing and fresh, otherwise none. */
  controls(state: string, now: number): Controls {
    return state === 'playing' && now - this.lastPoseT < POSE_STALE_MS ? this.poseControls : noControls();
  }

  /** Stale pose controls must not apply until a fresh frame arrives (the camera went off). */
  clear() {
    this.lastPoseT = 0;
  }
}
