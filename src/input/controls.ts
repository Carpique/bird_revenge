import type { PostureIntent } from '../game/posture';

/** What the bird is told to do this frame, from pose and/or keyboard. */
export interface Controls {
  /** upward acceleration, px/s² */
  lift: number;
  /**
   * tilt of the arms, deg, as seen on screen with y up (+ = the right hand is higher): the bird flies
   * sideways towards the lower hand, faster the more they're tilted
   */
  tilt: number;
  /**
   * arms spread out and held still (or Shift held): in the air the bird hovers. How much of the fall it holds back,
   * 0..1: 1 keeps its altitude (a T), less sinks (arms lowered), 0 = no hover
   */
  hover: number;
  /** wing frame from the player's arm height (pose mode), or null to animate on its own */
  wingPhase: number | null;
  /** keyboard flap held (bird plays the flap loop) */
  flapping: boolean;
  /** posture control (`config.posture.flapping` off): what the arm angles ask for; null when off or no arms in view */
  posture: PostureIntent | null;
}

export const noControls = (): Controls => ({ lift: 0, tilt: 0, hover: 0, wingPhase: null, flapping: false, posture: null });
