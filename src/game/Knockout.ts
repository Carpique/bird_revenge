import { config } from '../config';
import { STEP_MS } from './physics';

const BLINK_MS = 90;
/** Matter.js gravity per step at gravity 1 (its gravity.scale is 0.001 px/ms²) */
const GRAVITY_PER_STEP = 0.001 * STEP_MS * STEP_MS;
/** same air friction as a falling poo */
const AIR_FRICTION = 0.01;

/**
 * A poo and an apple that hit each other: they hang in the air for a moment, then fall like a poo,
 * blinking and fading out all along.
 */
export class Knockout {
  done = false;
  private t = 0;
  private vy = 0;

  /** Advances one step; returns how far down to move (px). */
  step(stepMs: number): number {
    this.t += stepMs;
    if (this.t >= config.apple.poopedMs) this.done = true;
    if (this.t < config.apple.poopedFallAfterMs) return 0;
    this.vy = this.vy * (1 - AIR_FRICTION) + config.physics.gravity * GRAVITY_PER_STEP;
    return this.vy;
  }

  /** Flickers while fading from 1 to 0. */
  get alpha(): number {
    const fade = Math.max(0, 1 - this.t / Math.max(1, config.apple.poopedMs));
    return Math.floor(this.t / BLINK_MS) % 2 ? fade * 0.25 : fade;
  }
}
