import { config } from '../config';
import { postureIntent, type PostureIntent } from '../game/posture';
import type { PoseFrame } from '../pose/types';
import { armElevation } from './geometry';

export interface PostureOutput {
  /** player's left arm (screen left), smoothed, deg above horizontal (90 up, 0 level, -90 down); null when not visible */
  left: number | null;
  right: number | null;
  /** what the arms ask of the bird, or null when an arm isn't visible */
  intent: PostureIntent | null;
}

/** Posture control: reads both arms' angles above/below horizontal every frame (no gesture timing involved). */
export class PostureDetector {
  private left: number | null = null;
  private right: number | null = null;

  update(f: PoseFrame, leftVisible: boolean, rightVisible: boolean): PostureOutput {
    const a = config.posture.smoothing;
    const ema = (prev: number | null, x: number) => (prev === null ? x : prev + a * (x - prev));
    this.left = leftVisible ? ema(this.left, armElevation(f, 'left') - 90) : null;
    this.right = rightVisible ? ema(this.right, armElevation(f, 'right') - 90) : null;
    const intent = this.left !== null && this.right !== null ? postureIntent(this.left, this.right) : null;
    return { left: this.left, right: this.right, intent };
  }
}
