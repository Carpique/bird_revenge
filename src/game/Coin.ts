import { coinDef, coinRadius, type CoinAnim } from '../characters/coin';
import { config } from '../config';
import type { CoinDef } from '../level/types';
import { CharacterSprite } from '../render/CharacterSprite';
import { Sprite, Texture } from 'pixi.js';

/** A soft round glow, white (tinted per `glowHue`) at the centre and fading out to the edge; made once, shared by every coin. */
let glowTexture: Texture | undefined;
function glow(): Texture {
  if (glowTexture) return glowTexture;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255, 255, 255, 1)');
  g.addColorStop(0.35, 'rgba(255, 255, 255, 0.55)');
  g.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return (glowTexture = Texture.from(canvas));
}

/**
 * A coin to collect. It spins in place (outside the physics world) until the bird flies into it;
 * collected, it floats up and fades away, then it's gone.
 */
export class Coin {
  readonly view = new CharacterSprite<CoinAnim>(coinDef);
  private glow = new Sprite(glow());
  state: 'waiting' | 'collected' | 'done' = 'waiting';
  private collectedT = 0;
  /** time (ms) for the glow's pulse; each coin starts at its own point */
  private t = Math.random() * 10000;

  constructor(readonly def: CoinDef) {
    // each from its own frame, so a row of coins doesn't spin in step
    this.view.anim.gotoAndPlay(Math.floor(Math.random() * this.view.anim.totalFrames));
    this.glow.anchor.set(0.5);
    this.view.addChildAt(this.glow, 0);
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
    this.t += stepMs;
    if (this.state !== 'collected') return;
    this.collectedT += stepMs;
    if (this.collectedT >= config.coin.collectedMs) this.state = 'done';
  }

  sync() {
    const k = this.state === 'waiting' ? 0 : Math.min(1, this.collectedT / Math.max(1, config.coin.collectedMs));
    this.view.position.set(this.def.x, this.def.y - config.coin.collectedRise * k);
    this.view.alpha = 1 - k * k;
    this.view.visible = this.state !== 'done';
    const { glowSize, glowAlpha, glowHue, glowPulse, glowPulseMs } = config.coin;
    this.glow.tint = { h: glowHue, s: 100, l: 50 };
    const pulse = Math.sin((this.t / Math.max(1, glowPulseMs)) * Math.PI * 2);
    this.glow.width = this.glow.height = glowSize * (1 + 0.5 * glowPulse * pulse);
    this.glow.alpha = glowAlpha * (1 - 0.5 * glowPulse * (1 - pulse));
  }
}
