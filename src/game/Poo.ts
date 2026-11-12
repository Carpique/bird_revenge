import { batPooDef, pooDef, splatLifetimeMs } from '../characters/poo';
import { config, WORLD } from '../config';
import { CharacterSprite } from '../render/CharacterSprite';
import { Smoke } from '../render/Smoke';
import { Knockout } from './Knockout';
import { BIRD_GROUP, Bodies, Body, type MBody } from './physics';

type PooAnim = keyof typeof pooDef.animations;

/** whose poo it is: the bird's hits villains, bats and apples and presses buttons; a bat's only hurts the bird */
export type PooOwner = 'bird' | 'bat';

export class Poo {
  readonly body: MBody;
  readonly view: CharacterSprite<PooAnim>;
  /** collision radius (px) */
  readonly radius: number;
  state: 'falling' | 'splat' | 'hit' | 'evaporating' | 'done' = 'falling';
  /** stops the falling sound; called when the poo lands or is removed */
  stopSound: () => void = () => {};
  private splatT = 0;
  private knockout: Knockout | null = null;
  /** ms since it hit a dragon's fire */
  private evaporateT = 0;
  /** the smoke going up from it while it evaporates, beside it in its layer */
  private smoke: Smoke | null = null;

  constructor(x: number, y: number, vx: number, vy: number, readonly owner: PooOwner = 'bird') {
    this.view = new CharacterSprite<PooAnim>(owner === 'bat' ? batPooDef : pooDef);
    this.radius = owner === 'bat' ? config.bat.pooRadius : config.physics.pooRadius;
    // in the bird's group: it never bumps into the bird (a bat's poo hits it by distance, see Game) or other poos
    this.body = Bodies.circle(x, y, this.radius, {
      label: 'poo',
      restitution: 0,
      frictionAir: 0.01,
      collisionFilter: { group: BIRD_GROUP },
    });
    Body.setVelocity(this.body, { x: vx, y: vy });
  }

  /** the splat lies on the ground (not on a branch), where the villain walks */
  onGround = false;

  /**
   * Landed: becomes a splat at surface height `y` (the ground by default), tilted by `angle` to lie
   * along a branch (caller removes the physics body).
   */
  splat(y = WORLD.groundY, angle = 0) {
    this.stopSound();
    this.state = 'splat';
    this.splatT = 0;
    this.onGround = y === WORLD.groundY;
    this.view.play('splat');
    this.view.rotation = angle;
    this.view.position.set(this.body.position.x, y + 2);
  }

  /** Hit an apple: stops where it is, then blinks out and drops (caller removes the physics body). */
  hit() {
    this.stopSound();
    this.state = 'hit';
    this.knockout = new Knockout();
    this.view.position.set(this.body.position.x, this.body.position.y);
  }

  /** Flew into a dragon's fire: stops where it is, shrinks away and smokes (caller removes the physics body). */
  evaporate() {
    this.stopSound();
    this.state = 'evaporating';
    this.evaporateT = 0;
    this.view.position.set(this.body.position.x, this.body.position.y);
    this.smoke = new Smoke(this.radius);
    this.smoke.position.copyFrom(this.view.position);
    this.view.parent?.addChild(this.smoke);
  }

  destroy() {
    this.view.destroy();
    this.smoke?.destroy({ children: true });
  }

  step(stepMs: number) {
    if (this.state === 'evaporating') {
      this.evaporateT += stepMs;
      if (this.smoke) this.smoke.t = this.evaporateT;
      if (this.evaporateT >= Math.max(config.evaporate.shrinkMs, Smoke.ms)) this.state = 'done';
      return;
    }
    if (this.knockout) {
      this.view.y += this.knockout.step(stepMs);
      if (this.knockout.done) this.state = 'done';
      return;
    }
    if (this.state !== 'splat') return;
    this.splatT += stepMs;
    if (this.splatT >= splatLifetimeMs) this.state = 'done';
  }

  sync() {
    if (this.state === 'falling') {
      this.view.position.set(this.body.position.x, this.body.position.y);
    } else if (this.state === 'splat') {
      this.view.alpha = Math.min(1, 3 * (1 - this.splatT / splatLifetimeMs));
    } else if (this.state === 'evaporating') {
      const e = config.evaporate;
      this.view.scale.set(Math.max(0, 1 - this.evaporateT / e.shrinkMs));
      this.smoke?.sync();
    } else if (this.knockout) {
      this.view.alpha = this.knockout.alpha;
    }
  }
}
