import { Container } from 'pixi.js';
import { birdDef, birdSquash } from '../characters/bird';
import { config, WORLD } from '../config';
import type { Controls } from '../input/controls';
import type { Branch } from '../level/types';
import { landingBranch } from './branches';
import { CharacterSprite } from '../render/CharacterSprite';
import { flightStep, leanFor, sideAmount } from './flight';
import { postureLean, postureStep } from './posture';
import { BIRD_GROUP, Bodies, Body, forceFor, Query, type MBody } from './physics';

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
  /** ms since the last flap (lift) */
  private sinceFlapMs = Infinity;
  /** posture control is steering the bird this step */
  private posturing = false;
  /** current lean, radians (eased towards the direction of sideways flight) */
  private bankAngle = 0;
  /** sitting on a branch (set by `perchOn` after each physics step) */
  perched = false;
  /** standing on a level body: a shelf, a crate (set by `standOn` after each physics step) */
  private supported = false;

  constructor(x: number) {
    const r = config.physics.birdRadius;
    this.body = Bodies.circle(x, WORLD.groundY - r, r, {
      label: 'bird',
      inertia: Infinity, // never tumbles
      restitution: 0,
      // no friction of its own: Matter combines friction with the larger of the two bodies' values, so this
      // would make the bird stick to the walls and ceiling; the ground supplies the friction instead
      friction: 0,
      frictionStatic: 0,
      frictionAir: config.physics.birdAirFriction,
      collisionFilter: { group: BIRD_GROUP },
      // never sleeps: a sleeping body ignores the flap forces
      sleepThreshold: Infinity,
    });
    this.view.addChild(this.sprite);
  }

  /** standing on the ground or on something, or sitting on a branch */
  get onGround(): boolean {
    if (this.perched || this.supported) return true;
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
    this.perched = false;
    this.supported = false;
  }

  /**
   * Is the bird resting on one of `bodies` (shelves, crates)? Looks just under its bottom, straight down
   * and a little to each side (so it also counts at the edge of a shelf).
   */
  standOn(bodies: readonly MBody[]) {
    const b = this.body;
    const r = config.physics.birdRadius;
    this.supported =
      !this.death &&
      Math.abs(b.velocity.y) < 0.6 &&
      [-0.6, 0, 0.6].some((k) => Query.point(bodies as MBody[], { x: b.position.x + k * r, y: b.position.y + r * Math.sqrt(1 - k * k) + 3 }).length > 0);
  }

  /**
   * Land on the branches, which hold the bird only from above (it flies up through them):
   * when the bottom of the bird has crossed a branch's top edge going down during this step,
   * it is put back on top. `prevY` is where the bird's centre was before the step.
   */
  perchOn(branches: readonly Branch[], prevY: number) {
    this.perched = false;
    const b = this.body;
    if (this.death || b.velocity.y < 0) return;
    const r = config.physics.birdRadius;
    const x = b.position.x;
    const landing = landingBranch(branches, x, prevY, b.position.y, r);
    if (!landing) return;
    Body.setPosition(b, { x, y: landing.top - r });
    Body.setVelocity(b, { x: b.velocity.x * (1 - config.physics.branchFriction), y: 0 });
    this.perched = true;
  }

  /** Back in play at (x, y), at rest; `invulnerable` makes it blink and unhurtable for a while. */
  respawn(x: number, y: number, invulnerable: boolean) {
    Body.setPosition(this.body, { x, y });
    Body.setVelocity(this.body, { x: 0, y: 0 });
    this.squashT = null;
    this.death = null;
    this.perched = false;
    this.supported = false;
    this.bankAngle = 0;
    this.sinceFlapMs = Infinity;
    this.invulnT = invulnerable ? config.player.invulnerableMs : 0;
  }

  /** Blink and be unhurtable for (at least) `ms`. */
  makeInvulnerable(ms: number) {
    this.invulnT = Math.max(this.invulnT, ms);
  }

  /** Start the squat-then-poo animation; `drop` is called at the deepest point. */
  squat(): boolean {
    if (this.squashT !== null) return false;
    this.squashT = 0;
    this.pooDropped = false;
    return true;
  }

  /** Physics step: flap lift, sideways flight and the hover; clamp speed, advance squash. */
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
    const p = c.posture;
    // posture: flying can take off from the ground or a branch; the rest only acts in the air
    this.posturing = p !== null && (p.mode === 'fly' || !this.onGround);
    b.frictionAir = this.posturing && p!.mode !== 'fall' ? config.posture.airFriction : config.physics.birdAirFriction;
    // otherwise flapping + tilt + hover: hovering only acts in the air; sideways flight also walks the bird
    // along the ground or a branch
    this.sinceFlapMs = c.lift > 0 ? 0 : this.sinceFlapMs + stepMs;
    const g = this.posturing
      ? postureStep(b.velocity, p!, stepMs)
      : flightStep(b.velocity, c.tilt, c.hover && !this.onGround, this.sinceFlapMs, stepMs);
    Body.setVelocity(b, { x: g.x, y: g.y });
    // Matter applies the full gravity itself; the hover (or flying by posture) holds against it
    const antiGravity = config.physics.gravity * 1000 * (g.holdUp ? 1 : 1 - (g.gravity ?? 1));
    Body.applyForce(b, b.position, { x: 0, y: -forceFor(b, c.lift + antiGravity) });
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
    const d = this.death;
    if (d) {
      this.sprite.showPhase('flap', 0.5);
      this.view.scale.set(1);
      this.view.alpha = 1;
      this.view.position.set(d.x, d.y);
      this.view.rotation = d.turn * (Math.PI / 2) * Math.min(1, d.t / Math.max(1, config.player.dieTurnMs));
      return;
    }
    // lean into sideways flight (in the air)
    const bankTo =
      this.posturing && c.posture ? (postureLean(c.posture) * Math.PI) / 180
      : this.onGround ? 0
      : (leanFor(c.tilt) * Math.PI) / 180;
    this.bankAngle += 0.2 * (bankTo - this.bankAngle);
    this.view.rotation = this.bankAngle;
    const b = this.body;
    const r = config.physics.birdRadius;
    if (Math.abs(b.velocity.x) > 0.4) this.facing = b.velocity.x > 0 ? 'right' : 'left';
    this.sprite.setFacing(this.facing);

    const p = this.posturing ? c.posture : null;
    // posture control: flap while the arms push the bird up or sideways, faster the faster it flies
    if (p?.mode === 'fly' && p.speed > 0) this.sprite.play('flap', config.posture.flapRateMin + (config.posture.flapRateMax - config.posture.flapRateMin) * p.speed);
    else if (this.onGround && c.lift < 50 && !c.flapping) this.sprite.play('idle');
    // flapping mode, tilted or in a T: holding the altitude, the wings beat fast
    else if (!this.posturing && !this.onGround && (c.hover || sideAmount(c.tilt) !== 0)) this.sprite.play('flap', config.tilt.holdFlapRate);
    else if (c.wingPhase !== null) this.sprite.showPhase('flap', c.wingPhase);
    else if (c.flapping) this.sprite.play('flap');
    else this.sprite.showPhase('flap', 0.5); // wings out

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
