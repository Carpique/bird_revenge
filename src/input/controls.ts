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
}

export const noControls = (): Controls => ({ lift: 0, steer: 0, wingPhase: null, flapping: false });
