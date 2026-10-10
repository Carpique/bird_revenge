/** MediaPipe Pose landmark indices. "Left" = the person's own left. */
export const L = {
  nose: 0,
  leftEye: 2,
  rightEye: 5,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
} as const;

export type PartName = 'head' | 'torso' | 'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg';
export const PART_NAMES: PartName[] = ['head', 'torso', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'];
/**
 * Parts that must be in frame to play. Legs are optional: MediaPipe still estimates them (straight)
 * when they are off-frame, and the hip angles that the shoot detector uses only need the hips.
 */
export const REQUIRED_PARTS: PartName[] = ['torso', 'leftArm', 'rightArm'];

/** Landmarks that must all be visible for a body part to count as visible. */
export const PART_LANDMARKS: Record<PartName, number[]> = {
  head: [L.nose, L.leftEye, L.rightEye],
  torso: [L.leftShoulder, L.rightShoulder, L.leftHip, L.rightHip],
  leftArm: [L.leftElbow, L.leftWrist],
  rightArm: [L.rightElbow, L.rightWrist],
  leftLeg: [L.leftKnee, L.leftAnkle],
  rightLeg: [L.rightKnee, L.rightAnkle],
};

/** Skeleton edges for drawing. */
export const SKELETON: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28],
  [27, 31], [28, 32], [0, 2], [0, 5],
];
