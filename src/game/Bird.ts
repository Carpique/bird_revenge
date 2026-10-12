import { Container } from 'pixi.js';
import { birdDef, birdSquash } from '../characters/bird';
import { config, WORLD } from '../config';
import type { Controls } from '../input/controls';
import { CharacterSprite } from '../render/CharacterSprite';
import { BIRD_GROUP, Bodies, Body, forceFor, type MBody } from './physics';

type BirdAnim = keyof typeof birdDef.animations;

/** Knocked off by the villain: falls off the screen on its side (animated by hand, outside the physics world). */
interface Death {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** ms since dying */
  t: number;
  /** +1 turns clockwise, -1 anticlockwise */
  turn: 1 | -1;
}

export class Bird {
  readonly body: MBody;
  readonly view = new Container();
  private sprite = new CharacterSprite<BirdAnim>(birdDef);
  /** ms into the squash animation, or null when not squashing */
  private squashT: number | null = null;
  private pooDropped = false;
  private facing: 'left' | 'right' = 'right';
  /** ms of invulnerability left after coming back from losing a life */
  private invulnT = 0;
  private death: Death | null = null;

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

  get invulnerable(): boolean {
    return this.invulnT > 0;
  }

  get dying(): boolean {
    return this.death !== null;
  }

  /** ms since dying, or null when alive */
  get deathMs(): number | null {
    return this.death?.t ?? null;
  }

  /** the death fall has left the bottom of the screen */
  get fallen(): boolean {
    return this.death !== null && this.death.y - birdDef.displayHeight > WORLD.height;
  }

  /**
   * Touched the villain: a little hop, then a parabolic fall off the screen, turned on its side.
   * The caller takes the body out of the physics world until `respawn()`.
   */
  die() {
    const p = this.body.position;
    const back = this.facing === 'right' ? -1 : 1;
    this.death = {
      x: p.x,
      y: p.y,
      vx: back * config.player.dieSideSpeed,
      vy: -config.player.dieJumpSpeed,
      t: 0,
      turn: back === -1 ? -1 : 1,
    };
    this.squashT = null;
  }

  /** Back in play at (x, y), at rest; `invulnerable` makes it blink and unhurtable for a while. */
  respawn(x: number, y: number, invulnerable: boolean) {
    Body.setPosition(this.body, { x, y });
    Body.setVelocity(this.body, { x: 0, y: 0 });
    this.squashT = null;
    this.death = null;
    this.invulnT = invulnerable ? config.player.invulnerableMs : 0;
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
    const d = this.death;
    if (d) {
      d.t += stepMs;
      d.vy += config.player.dieGravity;
      d.x += d.vx;
      d.y += d.vy;
      return;
    }
    const b = this.body;
    this.invulnT = Math.max(0, this.invulnT - stepMs);
    // gliding only while falling: it slows the fall but never lifts
    const glide = c.gliding && b.velocity.y > 0;
    b.frictionAir = glide ? config.glide.airFriction : config.physics.birdAirFriction;
    // gliding cancels part of gravity (Matter applies the full gravity itself)
    const antiGravity = glide ? (1 - config.glide.gravityScale) * config.physics.gravity * 1000 : 0;
    Body.applyForce(b, b.position, { x: forceFor(b, c.steer), y: -forceFor(b, c.lift + antiGravity) });
    let v = b.velocity;
    if (glide && c.glideSlide !== null) {
      // arms tilted: ease towards the slide speed (speeding up or slowing down to it)
      const maxDv = config.glide.sideAccel * (stepMs / 1000) ** 2;
      const dv = c.glideSlide - v.x;
      Body.setVelocity(b, { x: v.x + Math.max(-maxDv, Math.min(maxDv, dv)), y: v.y });
      v = b.velocity;
    }
    if (glide && v.y > config.glide.maxFallSpeed) {
      Body.setVelocity(b, { x: v.x, y: config.glide.maxFallSpeed });
      v = b.velocity;
    }
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
    const d = this.death;
    if (d) {
      this.sprite.showPhase('flap', 0.5);
      this.view.scale.set(1);
      this.view.alpha = 1;
      this.view.position.set(d.x, d.y);
      this.view.rotation = d.turn * (Math.PI / 2) * Math.min(1, d.t / Math.max(1, config.player.dieTurnMs));
      return;
    }
    this.view.rotation = 0;
    const b = this.body;
    const r = config.physics.birdRadius;
    if (Math.abs(b.velocity.x) > 0.4) this.facing = b.velocity.x > 0 ? 'right' : 'left';
    this.sprite.setFacing(this.facing);

    if (this.onGround && c.lift < 50 && !c.flapping) this.sprite.play('idle');
    else if (c.wingPhase !== null) this.sprite.showPhase('flap', c.wingPhase);
    else if (c.gliding) this.sprite.showPhase('flap', 0.5);
    else if (c.flapping) this.sprite.play('flap');
    else this.sprite.showPhase('flap', 0.5); // gliding

    const [sx, sy] = this.squashScale();
    this.view.scale.set(sx, sy);
    // blink while invulnerable
    this.view.alpha = this.invulnT > 0 && Math.floor(this.invulnT / 100) % 2 === 0 ? 0.25 : 1;
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
