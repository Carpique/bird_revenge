import type { ButtonDef } from '../level/types';

/** how far (px) below a button's bottom edge something may be and still press it: a splat lies a bit into the surface */
const BELOW = 6;

/**
 * A button on a surface (logic only; `LevelView` draws it). Something on it presses it; it stays in effect
 * while pressed and for its `duration` after being let go (for good when that's 0).
 */
export class Button {
  pressed = false;
  /** ms it stays in effect after being let go */
  private left = 0;

  constructor(readonly def: ButtonDef) {}

  /** switching its target right now */
  get active(): boolean {
    return this.pressed || this.left > 0;
  }

  /** Is the point (x, y) on the button: the bottom of the bird, a splat? */
  under(x: number, y: number): boolean {
    const d = this.def;
    return x >= d.x0 && x <= d.x1 && y >= d.y0 && y <= d.y1 + BELOW;
  }

  /** Is a circle at (x, y) of radius `r` touching the button: a falling poo? */
  touches(x: number, y: number, r: number): boolean {
    const d = this.def;
    const nx = Math.max(d.x0, Math.min(x, d.x1)), ny = Math.max(d.y0, Math.min(y, d.y1));
    return (x - nx) ** 2 + (y - ny) ** 2 <= r * r;
  }

  /** Advance by `stepMs`, pressed or not this step; true when it was just pressed. */
  step(pressed: boolean, stepMs: number): boolean {
    const was = this.pressed;
    this.pressed = pressed;
    if (pressed) this.left = this.def.duration > 0 ? this.def.duration * 1000 : Infinity;
    else this.left = Math.max(0, this.left - stepMs);
    return pressed && !was;
  }
}
