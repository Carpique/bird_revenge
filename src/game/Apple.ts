import { appleDef } from '../characters/apple';
import { config, WORLD } from '../config';
import { CharacterSprite } from '../render/CharacterSprite';

type AppleAnim = keyof typeof appleDef.animations;

/**
 * Thrown by the villain. Flies on a plain parabola (outside the physics world, like the villain's fall),
 * lies on the ground for a moment where it lands, then fades out.
 */
export class Apple {
  readonly view = new CharacterSprite<AppleAnim>(appleDef);
  state: 'flying' | 'landed' | 'done' = 'flying';
  private landedT = 0;
  private spinDir: 1 | -1;

  constructor(
    public x: number,
    public y: number,
    private vx: number,
    private vy: number,
  ) {
    this.spinDir = vx >= 0 ? 1 : -1;
  }

  step(stepMs: number) {
    if (this.state === 'flying') {
      this.vy += config.apple.gravity;
      this.x += this.vx;
      this.y += this.vy;
      this.view.rotation += (this.spinDir * config.apple.spin * 2 * Math.PI * stepMs) / 1000;
      const r = config.apple.radius;
      if (this.y >= WORLD.groundY - r) {
        this.y = WORLD.groundY - r;
        this.state = 'landed';
      } else if (this.x < -r * 2 || this.x > WORLD.width + r * 2) {
        this.state = 'done';
      }
    } else if (this.state === 'landed') {
      this.landedT += stepMs;
      if (this.landedT >= config.apple.groundMs) this.state = 'done';
    }
  }

  sync() {
    this.view.position.set(this.x, this.y);
    if (this.state === 'landed') this.view.alpha = Math.min(1, 3 * (1 - this.landedT / Math.max(1, config.apple.groundMs)));
  }
}
