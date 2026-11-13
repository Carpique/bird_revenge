import { appleDef, missiles } from '../characters/apple';
import { splatLifetimeMs } from '../characters/poo';
import { config, WORLD } from '../config';
import type { VillainKind } from '../level/types';
import { CharacterSprite } from '../render/CharacterSprite';
import { Knockout } from './Knockout';

type AppleAnim = keyof typeof appleDef.animations;

/**
 * Thrown by the villain: an apple, or the ghost's glue (`kind`: who threw it). Flies in a straight line at constant speed (no gravity, outside the physics world)
 * until it leaves the screen. Hit by a poo, it stops, blinks out and drops. Flown into the level or the ground, it splats there
 * as a poo does: a splat lies on the surface for a while, fading out, and hurts no one.
 */
export class Apple {
  readonly view: CharacterSprite<AppleAnim>;
  state: 'flying' | 'hit' | 'splat' | 'done' = 'flying';
  private spinDir: 1 | -1;
  private spins: boolean;
  /** ms in the air, for the glue's wobble */
  private age = 0;
  private knockout: Knockout | null = null;
  private splatT = 0;
  /** where it was before its last step: it flew from there to (x, y) */
  prevX: number;
  prevY: number;

  constructor(
    public x: number,
    public y: number,
    private vx: number,
    private vy: number,
    kind: VillainKind = 'villain',
  ) {
    this.view = new CharacterSprite<AppleAnim>(missiles[kind].def);
    this.spins = missiles[kind].spins;
    this.spinDir = vx >= 0 ? 1 : -1;
    this.prevX = x;
    this.prevY = y;
  }

  /** Hit by a poo: stops where it is, then blinks out and drops. */
  hit() {
    this.state = 'hit';
    this.knockout = new Knockout();
  }

  /**
   * Flew into a surface at (x, y): becomes a splat lying on it, its top the way of the surface's `normal`
   * (so under a shelf it hangs down, on a wall it sticks out sideways).
   */
  splat(x: number, y: number, normal: { x: number; y: number }) {
    this.state = 'splat';
    this.splatT = 0;
    // a little into the surface, as a poo's splat is
    this.x = x - normal.x * 2;
    this.y = y - normal.y * 2;
    this.view.play('splat');
    // the splat's drawing sits on its bottom edge
    this.view.anim.anchor.set(0.5, 1);
    this.view.scale.set(1);
    this.view.rotation = Math.atan2(normal.x, -normal.y);
  }

  step(stepMs: number) {
    if (this.state === 'splat') {
      this.splatT += stepMs;
      if (this.splatT >= splatLifetimeMs) this.state = 'done';
      return;
    }
    if (this.knockout) {
      this.y += this.knockout.step(stepMs);
      if (this.knockout.done) this.state = 'done';
      return;
    }
    if (this.state !== 'flying') return;
    this.prevX = this.x;
    this.prevY = this.y;
    this.x += this.vx;
    this.y += this.vy;
    this.age += stepMs;
    if (this.spins) this.view.rotation += (this.spinDir * config.apple.spin * 2 * Math.PI * stepMs) / 1000;
    else {
      // glue: squashes and stretches as it flies
      const w = Math.sin((this.age / 1000) * config.apple.spin * 4 * Math.PI) * 0.1;
      this.view.scale.set(1 + w, 1 - w);
    }
    const m = config.apple.radius * 2;
    if (this.x < -m || this.x > WORLD.width + m || this.y < -m || this.y > WORLD.height + m) this.state = 'done';
  }

  sync() {
    this.view.position.set(this.x, this.y);
    if (this.state === 'splat') this.view.alpha = Math.min(1, 3 * (1 - this.splatT / splatLifetimeMs));
    else if (this.knockout) this.view.alpha = this.knockout.alpha;
  }
}
