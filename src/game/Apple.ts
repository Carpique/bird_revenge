import { appleDef } from '../characters/apple';
import { config, WORLD } from '../config';
import { CharacterSprite } from '../render/CharacterSprite';
import { Knockout } from './Knockout';

type AppleAnim = keyof typeof appleDef.animations;

/**
 * Thrown by the villain. Flies in a straight line at constant speed (no gravity, outside the physics world)
 * until it leaves the screen. Hit by a poo, it stops, blinks out and drops.
 */
export class Apple {
  readonly view = new CharacterSprite<AppleAnim>(appleDef);
  state: 'flying' | 'hit' | 'done' = 'flying';
  private spinDir: 1 | -1;
  private knockout: Knockout | null = null;

  constructor(
    public x: number,
    public y: number,
    private vx: number,
    private vy: number,
  ) {
    this.spinDir = vx >= 0 ? 1 : -1;
  }

  /** Hit by a poo: stops where it is, then blinks out and drops. */
  hit() {
    this.state = 'hit';
    this.knockout = new Knockout();
  }

  step(stepMs: number) {
    if (this.knockout) {
      this.y += this.knockout.step(stepMs);
      if (this.knockout.done) this.state = 'done';
      return;
    }
    if (this.state !== 'flying') return;
    this.x += this.vx;
    this.y += this.vy;
    this.view.rotation += (this.spinDir * config.apple.spin * 2 * Math.PI * stepMs) / 1000;
    const m = config.apple.radius * 2;
    if (this.x < -m || this.x > WORLD.width + m || this.y < -m || this.y > WORLD.height + m) this.state = 'done';
  }

  sync() {
    this.view.position.set(this.x, this.y);
    if (this.knockout) this.view.alpha = this.knockout.alpha;
  }
}
