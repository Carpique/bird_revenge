import { config } from '../config';
import { Body, Sleeping, type MBody } from './physics';

/** Matter's gravity scale: a body's weight is its mass × gravity × this */
const GRAVITY_SCALE = 0.001;

/**
 * A splat (a poo's, an apple's) lying on a movable body: it stays on it as the body moves and turns, and weighs on it
 * where it lies with its `mass`, until it's gone (`release`). Splats on one body add up.
 */
export class Stuck {
  /** where on the body: offset from its centre and angle, with the body unrotated */
  private readonly dx: number;
  private readonly dy: number;
  private readonly angle: number;
  private released = false;

  /** `x`, `y`, `rotation`: where the splat lies now, in the world */
  constructor(private readonly body: MBody, x: number, y: number, rotation: number, private readonly mass: number) {
    const dx = x - body.position.x, dy = y - body.position.y;
    const c = Math.cos(body.angle), s = Math.sin(body.angle);
    this.dx = dx * c + dy * s;
    this.dy = dy * c - dx * s;
    this.angle = rotation - body.angle;
    Body.setMass(body, body.mass + mass);
  }

  /** Where the splat is now. */
  get position() {
    const c = Math.cos(this.body.angle), s = Math.sin(this.body.angle);
    return { x: this.body.position.x + this.dx * c - this.dy * s, y: this.body.position.y + this.dx * s + this.dy * c };
  }

  get rotation() {
    return this.angle + this.body.angle;
  }

  /** Before each physics step: the body's mass carries the splat's weight at its centre, the rest is the turn of it lying off the centre. */
  step() {
    this.body.torque += (this.position.x - this.body.position.x) * this.mass * config.physics.gravity * GRAVITY_SCALE;
  }

  /** The splat is gone: its weight is off the body, which may have gone to sleep under it. */
  release() {
    if (this.released) return;
    this.released = true;
    Body.setMass(this.body, this.body.mass - this.mass);
    Sleeping.set(this.body, false);
  }
}

/**
 * Something of `mass` flying at (vx, vy) (px per step) hits the movable `body` at (x, y) and stays in it: the body takes
 * its momentum, there (it turns when hit off its centre). What a physics body (a poo) gets from Matter's collision.
 */
export function strike(body: MBody, x: number, y: number, vx: number, vy: number, mass: number) {
  Sleeping.set(body, false);
  const k = mass / (body.mass + mass);
  const rx = x - body.position.x, ry = y - body.position.y;
  Body.setVelocity(body, { x: body.velocity.x + vx * k, y: body.velocity.y + vy * k });
  Body.setAngularVelocity(body, body.angularVelocity + ((rx * vy - ry * vx) * mass) / body.inertia);
}
