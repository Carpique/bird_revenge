import { villainDef, villainHitbox } from '../characters/villain';
import { config, WORLD } from '../config';
import { CharacterSprite } from '../render/CharacterSprite';
import { Bodies, Body, type MBody } from './physics';

type State = 'walking' | 'hit' | 'leaving' | 'gone';
type VillainAnim = keyof typeof villainDef.animations;

const MIN_X = 60, MAX_X = WORLD.width - 60;

/** Walks back and forth on the ground; flees after being hit, then a new one comes in. */
export class Villain {
  readonly body: MBody;
  readonly view = new CharacterSprite<VillainAnim>(villainDef);
  private state: State = 'walking';
  private x: number;
  private dir: 1 | -1 = 1;
  private timer = 0;

  constructor(x: number) {
    this.x = x;
    this.body = Bodies.rectangle(x, WORLD.groundY - villainHitbox.height / 2, villainHitbox.width, villainHitbox.height, {
      label: 'villain',
      isStatic: true,
      isSensor: true,
    });
  }

  get hittable() {
    return this.state === 'walking';
  }

  /** Returns true if this hit counts. */
  hit(): boolean {
    if (!this.hittable) return false;
    this.state = 'hit';
    this.timer = 0;
    return true;
  }

  step(stepMs: number) {
    const speed = config.villain.speed;
    this.timer += stepMs;
    switch (this.state) {
      case 'walking':
        this.x += this.dir * speed;
        if (this.x > MAX_X) this.dir = -1;
        if (this.x < MIN_X) this.dir = 1;
        break;
      case 'hit':
        if (this.timer >= config.villain.hitShowMs) {
          this.state = 'leaving';
          this.timer = 0;
        }
        break;
      case 'leaving':
        this.x += this.dir * speed * 3;
        if (this.x < -100 || this.x > WORLD.width + 100) {
          this.state = 'gone';
          this.timer = 0;
        }
        break;
      case 'gone':
        if (this.timer >= config.villain.respawnDelayMs) {
          const fromLeft = Math.random() < 0.5;
          this.x = fromLeft ? -60 : WORLD.width + 60;
          this.dir = fromLeft ? 1 : -1;
          this.state = 'walking';
          this.timer = 0;
        }
        break;
    }
    Body.setPosition(this.body, { x: this.state === 'gone' ? -1000 : this.x, y: WORLD.groundY - villainHitbox.height / 2 });
  }

  sync() {
    this.view.visible = this.state !== 'gone';
    this.view.position.set(this.x, WORLD.groundY);
    this.view.setFacing(this.dir > 0 ? 'right' : 'left');
    this.view.play(this.state === 'hit' ? 'hit' : 'walk');
    this.view.anim.animationSpeed = (villainDef.animations.walk.fps / 60) * (this.state === 'leaving' ? 2.5 : 1);
  }
}
