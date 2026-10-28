import { coinDef, coinRadius, type CoinAnim } from '../characters/coin';
import { config } from '../config';
import type { CoinDef } from '../level/types';
import { CharacterSprite } from '../render/CharacterSprite';

/**
 * A coin to collect. It spins in place (outside the physics world) until the bird flies into it;
 * collected, it floats up and fades away, then it's gone.
 */
export class Coin {
  readonly view = new CharacterSprite<CoinAnim>(coinDef);
  state: 'waiting' | 'collected' | 'done' = 'waiting';
  private collectedT = 0;

  constructor(readonly def: CoinDef) {
    // each from its own frame, so a row of coins doesn't spin in step
    this.view.anim.gotoAndPlay(Math.floor(Math.random() * this.view.anim.totalFrames));
  }

  /** Whether a circle at (x, y) with radius `r` reaches it. */
  touches(x: number, y: number, r: number): boolean {
    const d = r + coinRadius;
    return (x - this.def.x) ** 2 + (y - this.def.y) ** 2 < d * d;
  }

  collect() {
    this.state = 'collected';
  }

  step(stepMs: number) {
    if (this.state !== 'collected') return;
    this.collectedT += stepMs;
    if (this.collectedT >= config.coin.collectedMs) this.state = 'done';
  }

  sync() {
    const k = this.state === 'waiting' ? 0 : Math.min(1, this.collectedT / Math.max(1, config.coin.collectedMs));
    this.view.position.set(this.def.x, this.def.y - config.coin.collectedRise * k);
    this.view.alpha = 1 - k * k;
    this.view.visible = this.state !== 'done';
  }
}
