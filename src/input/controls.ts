import type { PostureIntent } from '../game/posture';

/** What the bird is told to do this frame, from pose and/or keyboard. */
export interface Controls {
  /** upward acceleration, px/s² */
  lift: number;
  /** sideways acceleration, px/s² (+ = right) */
  steer: number;
  /** wing frame from the player's arm height (pose mode), or null to animate on its own */
  wingPhase: number | null;
  /** keyboard flap held (bird plays the flap loop) */
  flapping: boolean;
  /**
   * arms spread out (or Shift held): the arm line's tilt, deg, as seen on screen with y up (+ = rises to the
   * right); level = parachute, tilted = dive towards the lower hand. null when not gliding
   */
  glideTilt: number | null;
  /** posture control (`config.posture.enabled`): what the arm angles ask for; null when off or no arms in view */
  posture: PostureIntent | null;
}

export const noControls = (): Controls => ({ lift: 0, steer: 0, wingPhase: null, flapping: false, glideTilt: null, posture: null });
