import { AlphaFilter, Container, Graphics } from 'pixi.js';
import { config } from '../config';

/** a cloud's puffs at full size: x, y, radius, in shares of `config.evaporate.size` */
const PUFFS = [
  [0, 0, 0.5],
  [-0.42, 0.14, 0.34],
  [0.44, 0.12, 0.36],
  [-0.18, -0.3, 0.34],
  [0.22, -0.26, 0.3],
];

/**
 * A little smoke going up from where a poo hissed away in a dragon's fire: `config.evaporate.clouds` cartoon clouds,
 * one after another, each starting tiny, growing and rising while it fades. Each cloud is see-through as one shape
 * (a filter), so its overlapping puffs don't show through each other. Set `t` (ms since the hit), then `sync`.
 */
export class Smoke extends Container {
  t = 0;

  /** ms from the hit until the last cloud is gone */
  static get ms() {
    const e = config.evaporate;
    return (e.clouds - 1) * e.staggerMs + e.cloudMs;
  }

  private readonly clouds: { g: Graphics; fade: AlphaFilter; dx: number }[] = [];

  /** `r`: the poo's radius; the clouds come out of its top */
  constructor(private readonly r: number) {
    super();
    const e = config.evaporate;
    for (let i = 0; i < e.clouds; i++) {
      const g = new Graphics();
      // the puffs' outlines first, then their fills over them: one outline round the whole cloud
      for (const [x, y, pr] of PUFFS) g.circle(x * e.size, y * e.size, pr * e.size).stroke({ width: 2, color: '#2b2b2b' });
      for (const [x, y, pr] of PUFFS) g.circle(x * e.size, y * e.size, pr * e.size).fill('#e4e4e4');
      g.rotation = (Math.random() - 0.5) * 0.6;
      const fade = new AlphaFilter({ alpha: 0 });
      g.filters = [fade];
      g.visible = false;
      // drifting a little to either side in turn
      this.clouds.push({ g: this.addChild(g), fade, dx: (i % 2 ? -1 : 1) * (i ? 5 : 1) });
    }
  }

  sync() {
    const e = config.evaporate;
    this.clouds.forEach(({ g, fade, dx }, i) => {
      const k = (this.t - i * e.staggerMs) / e.cloudMs;
      g.visible = k >= 0 && k < 1;
      if (!g.visible) return;
      const ease = 1 - (1 - k) ** 2;
      g.scale.set(e.startScale + (1 - e.startScale) * ease);
      g.position.set(dx * ease, -this.r * 0.5 - e.rise * ease);
      // fully there for the first third, then fading away
      fade.alpha = e.alpha * Math.min(1, (1 - k) / (2 / 3));
    });
  }
}
