import { Container, Sprite } from 'pixi.js';
import { WORLD } from '../config';
import { tex } from '../render/assets';
import { view } from '../render/fitWorld';
import { scenery } from '../scenery/scenery';
import { Ground } from './Ground';

const spriteAt = (image: string, x: number, y: number, height: number) => {
  const s = new Sprite(tex(image));
  s.anchor.set(0.5);
  s.scale.set(height / s.texture.height);
  s.position.set(x, y);
  return s;
};

export class Background extends Container {
  private clouds: { sprite: Sprite; speed: number }[] = [];
  private ground = new Ground();

  constructor() {
    super();
    const { sun, clouds } = scenery;
    this.addChild(spriteAt(sun.image, sun.x, sun.y, sun.height));
    for (const c of clouds) {
      const sprite = spriteAt(c.image, c.x, c.y, c.height);
      this.clouds.push({ sprite, speed: c.driftSpeed });
      this.addChild(sprite);
    }
    this.addChild(this.ground);
  }

  /** Extend the ground to the screen's edges (`view`); call after `fitWorld`. */
  fit() {
    this.ground.fit();
  }

  update(dtMs: number) {
    // the clouds drift across the whole screen, also where it's wider than the world
    const left = Math.min(0, view.left), right = Math.max(WORLD.width, view.right);
    for (const c of this.clouds) {
      c.sprite.x += (c.speed * dtMs) / 1000;
      const half = c.sprite.width / 2;
      if (c.sprite.x - half > right) c.sprite.x = left - half;
    }
  }
}
