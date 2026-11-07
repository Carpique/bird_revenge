import { Container, Rectangle, Sprite, Texture } from 'pixi.js';
import { WORLD } from '../config';
import { tex } from '../render/assets';
import { view } from '../render/fitWorld';
import { scenery } from '../scenery/scenery';

/**
 * The band of the ground image (fractions of its height) repeated below it, to fill the screen under the world; the
 * image is cut off where the soil starts (below the world's bottom)
 */
const SOIL = { from: 0.35, to: 0.87 };

/**
 * The ground strip along the bottom of the world. Shared by the game and the splash screen. When the screen is
 * wider or taller than the world (`view`), `fit` repeats it out to the screen's sides and fills below it with
 * its soil, the pattern simply repeated.
 */
export class Ground extends Container {
  private strip: Texture;
  private soil: Texture;
  /** the copies made for: first and last column (in world widths from the world's), rows of soil */
  private made = { from: 0, to: 0, rows: 0 };

  constructor() {
    super();
    const image = tex(scenery.ground.image);
    const f = image.frame;
    const band = (from: number, to: number) =>
      new Texture({ source: image.source, frame: new Rectangle(f.x, f.y + f.height * from, f.width, f.height * (to - from)) });
    this.strip = band(0, SOIL.to);
    this.soil = band(SOIL.from, SOIL.to);
    this.build(0, 0, 0);
    this.fit();
  }

  /** Cover the screen's width and, below the ground, its height (`view`); call after `fitWorld`. */
  fit() {
    const k = WORLD.width / this.strip.width;
    const soilTop = this.stripTop() + this.strip.height * k, soilH = this.soil.height * k;
    const from = Math.floor(view.left / WORLD.width), to = Math.ceil(view.right / WORLD.width) - 1;
    const rows = Math.max(0, Math.ceil((view.bottom - soilTop) / soilH));
    const m = this.made;
    if (from >= m.from && to <= m.to && rows <= m.rows) return;
    this.build(Math.min(from, m.from), Math.max(to, m.to), Math.max(rows, m.rows));
  }

  private stripTop() {
    return WORLD.groundY - scenery.ground.surfaceOffset * (WORLD.width / this.strip.width);
  }

  private build(from: number, to: number, rows: number) {
    for (const c of this.removeChildren()) c.destroy();
    const k = WORLD.width / this.strip.width;
    const add = (texture: Texture, col: number, top: number) => {
      const s = new Sprite(texture);
      s.scale.set(k);
      s.position.set(col * WORLD.width, top);
      this.addChild(s);
    };
    const soilTop = this.stripTop() + this.strip.height * k, soilH = this.soil.height * k;
    for (let col = from; col <= to; col++) {
      for (let r = 0; r < rows; r++) add(this.soil, col, soilTop + r * soilH);
      add(this.strip, col, this.stripTop());
    }
    this.made = { from, to, rows };
  }
}
