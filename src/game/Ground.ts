import { Container, Sprite } from 'pixi.js';
import { WORLD } from '../config';
import { tex } from '../render/assets';
import { scenery } from '../scenery/scenery';

/** The ground strip along the bottom of the world. Shared by the game and the splash screen. */
export class Ground extends Container {
  constructor() {
    super();
    const { ground } = scenery;
    const g = new Sprite(tex(ground.image));
    g.width = WORLD.width;
    g.scale.y = g.scale.x;
    g.position.set(0, WORLD.groundY - ground.surfaceOffset * g.scale.y);
    this.addChild(g);
  }
}
