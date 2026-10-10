import { Container, Sprite } from 'pixi.js';
import { WORLD } from '../config';
import { tex } from '../render/assets';
import { scenery } from '../scenery/scenery';

const spriteAt = (image: string, x: number, y: number, height: number) => {
  const s = new Sprite(tex(image));
  s.anchor.set(0.5);
  s.scale.set(height / s.texture.height);
  s.position.set(x, y);
  return s;
};

export class Background extends Container {
  private clouds: { sprite: Sprite; speed: number }[] = [];

  constructor() {
    super();
    const { sun, clouds, ground } = scenery;
    this.addChild(spriteAt(sun.image, sun.x, sun.y, sun.height));
    for (const c of clouds) {
      const sprite = spriteAt(c.image, c.x, c.y, c.height);
      this.clouds.push({ sprite, speed: c.driftSpeed });
      this.addChild(sprite);
    }
    const g = new Sprite(tex(ground.image));
    g.width = WORLD.width;
    g.scale.y = g.scale.x;
    g.position.set(0, WORLD.groundY - ground.surfaceOffset * g.scale.y);
    this.addChild(g);
  }

  update(dtMs: number) {
    for (const c of this.clouds) {
      c.sprite.x += (c.speed * dtMs) / 1000;
      const half = c.sprite.width / 2;
      if (c.sprite.x - half > WORLD.width) c.sprite.x = -half;
    }
  }
}
