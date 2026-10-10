/**
 * Character definitions describe *what* to draw; the game code never hard-codes image paths.
 * To swap in real hand-drawn art, replace the files (or edit the paths) in the definition files.
 * Frames can be SVG or PNG (paths are relative to /public).
 */
export interface AnimationDef {
  /** image paths relative to /public, in playback order */
  frames: string[];
  /** playback speed when the animation runs on its own */
  fps: number;
  loop?: boolean;
}

export interface CharacterDef<A extends string = string> {
  id: string;
  /** on-screen height in world pixels; width follows the image aspect ratio */
  displayHeight: number;
  /** point of the image that sits on the physics body's position (0..1) */
  anchor: { x: number; y: number };
  /** the direction the art faces; sprites are mirrored when moving the other way */
  facing: 'left' | 'right';
  animations: Record<A, AnimationDef>;
  defaultAnimation: A;
}
