import { pooDef, splatLifetimeMs } from '../characters/poo';
import { config, WORLD } from '../config';
import { CharacterSprite } from '../render/CharacterSprite';
import { Knockout } from './Knockout';
import { BIRD_GROUP, Bodies, Body, type MBody } from './physics';

type PooAnim = keyof typeof pooDef.animations;

export class Poo {
  readonly body: MBody;
  readonly view = new CharacterSprite<PooAnim>(pooDef);
  state: 'falling' | 'splat' | 'hit' | 'done' = 'falling';
  /** stops the falling sound; called when the poo lands or is removed */
  stopSound: () => void = () => {};
  private splatT = 0;
  private knockout: Knockout | null = null;

  constructor(x: number, y: number, vx: number, vy: number) {
    this.body = Bodies.circle(x, y, config.physics.pooRadius, {
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

  step(stepMs: number) {
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
    } else if (this.knockout) {
      this.view.alpha = this.knockout.alpha;
    }
  }
}
