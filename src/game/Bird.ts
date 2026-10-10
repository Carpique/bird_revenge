import { Container } from 'pixi.js';
import { birdDef, birdSquash } from '../characters/bird';
import { config, WORLD } from '../config';
import type { Controls } from '../input/controls';
import { CharacterSprite } from '../render/CharacterSprite';
import { BIRD_GROUP, Bodies, Body, forceFor, type MBody } from './physics';

type BirdAnim = keyof typeof birdDef.animations;

export class Bird {
  readonly body: MBody;
  readonly view = new Container();
  private sprite = new CharacterSprite<BirdAnim>(birdDef);
  /** ms into the squash animation, or null when not squashing */
  private squashT: number | null = null;
  private pooDropped = false;
  private facing: 'left' | 'right' = 'right';

  constructor(x: number) {
    const r = config.physics.birdRadius;
    this.body = Bodies.circle(x, WORLD.groundY - r, r, {
      label: 'bird',
      inertia: Infinity, // never tumbles
      restitution: 0,
      friction: 0.2,
      frictionAir: config.physics.birdAirFriction,
      collisionFilter: { group: BIRD_GROUP },
    });
    this.view.addChild(this.sprite);
  }

  get onGround(): boolean {
    const r = config.physics.birdRadius;
    return this.body.position.y >= WORLD.groundY - r - 1.5 && Math.abs(this.body.velocity.y) < 0.6;
  }

  /** Start the squat-then-poo animation; `drop` is called at the deepest point. */
  squat(): boolean {
    if (this.squashT !== null) return false;
    this.squashT = 0;
    this.pooDropped = false;
    return true;
  }

  /** Physics step: apply flap forces, clamp speed, advance squash. */
  step(c: Controls, stepMs: number, drop: () => void) {
    const b = this.body;
    b.frictionAir = config.physics.birdAirFriction;
    Body.applyForce(b, b.position, { x: forceFor(b, c.steer), y: -forceFor(b, c.lift) });
    const v = b.velocity;
    const speed = Math.hypot(v.x, v.y);
    const max = config.physics.maxSpeed;
    if (speed > max) Body.setVelocity(b, { x: (v.x / speed) * max, y: (v.y / speed) * max });

    if (this.squashT !== null) {
      this.squashT += stepMs;
      const s = birdSquash;
      if (!this.pooDropped && this.squashT >= s.downMs + s.holdMs / 2) {
        this.pooDropped = true;
        drop();
      }
      if (this.squashT >= s.downMs + s.holdMs + s.upMs) this.squashT = null;
    }
  }

  /** Render sync: position, animation frame, facing, squash. */
  sync(c: Controls) {
    const b = this.body;
    const r = config.physics.birdRadius;
    if (Math.abs(b.velocity.x) > 0.4) this.facing = b.velocity.x > 0 ? 'right' : 'left';
    this.sprite.setFacing(this.facing);

    if (this.onGround && c.lift < 50 && !c.flapping) this.sprite.play('idle');
    else if (c.wingPhase !== null) this.sprite.showPhase('flap', c.wingPhase);
    else if (c.flapping) this.sprite.play('flap');
    else this.sprite.showPhase('flap', 0.5); // gliding

    const [sx, sy] = this.squashScale();
    this.view.scale.set(sx, sy);
    // squash around the feet, not the centre
    this.view.position.set(b.position.x, b.position.y + r * (1 - sy));
  }

  private squashScale(): [number, number] {
    if (this.squashT === null) return [1, 1];
    const s = birdSquash;
    const t = this.squashT;
    let k: number;
    if (t < s.downMs) k = easeOut(t / s.downMs);
    else if (t < s.downMs + s.holdMs) k = 1;
    else k = 1 - easeOutBack((t - s.downMs - s.holdMs) / s.upMs);
    return [1 + (s.scaleX - 1) * k, 1 + (s.scaleY - 1) * k];
  }
}

const easeOut = (x: number) => 1 - (1 - x) * (1 - x);
const easeOutBack = (x: number) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};
