import { pooDef, splatLifetimeMs } from '../characters/poo';
import { config, WORLD } from '../config';
import { CharacterSprite } from '../render/CharacterSprite';
import { BIRD_GROUP, Bodies, Body, type MBody } from './physics';

type PooAnim = keyof typeof pooDef.animations;

export class Poo {
  readonly body: MBody;
  readonly view = new CharacterSprite<PooAnim>(pooDef);
  state: 'falling' | 'splat' | 'done' = 'falling';
  /** stops the falling sound; called when the poo lands or is removed */
  stopSound: () => void = () => {};
  private splatT = 0;

  constructor(x: number, y: number, vx: number, vy: number) {
    this.body = Bodies.circle(x, y, config.physics.pooRadius, {
      label: 'poo',
      restitution: 0,
      frictionAir: 0.01,
      collisionFilter: { group: BIRD_GROUP },
    });
    Body.setVelocity(this.body, { x: vx, y: vy });
  }

  /** Landed on the ground: becomes a splat (caller removes the physics body). */
  splat() {
    this.stopSound();
    this.state = 'splat';
    this.splatT = 0;
    this.view.play('splat');
    this.view.position.set(this.body.position.x, WORLD.groundY + 2);
  }

  step(stepMs: number) {
    if (this.state !== 'splat') return;
    this.splatT += stepMs;
    if (this.splatT >= splatLifetimeMs) this.state = 'done';
  }

  sync() {
    if (this.state === 'falling') {
      this.view.position.set(this.body.position.x, this.body.position.y);
    } else if (this.state === 'splat') {
      this.view.alpha = Math.min(1, 3 * (1 - this.splatT / splatLifetimeMs));
    }
  }
}
