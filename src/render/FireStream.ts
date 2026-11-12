import { Container, Sprite, type Texture } from 'pixi.js';
import { dragonConfig, fireDef, fireLayers, type FireLayer } from '../characters/dragon';
import type { FirePath } from '../game/firePath';
import { tex } from './assets';

/**
 * A dragon's fire: puffs flowing along `path` (world px) from its start, the mouth, out to `reach` px along it.
 * Each puff is a sprite in every layer (`fireLayers`, each layer a container drawn on top of the one before), so the
 * overlapping puffs merge into one stream with a single outline. The puffs turn with the path, upright either way.
 */
export class FireStream extends Container {
  /** how far along the path the fire is out (px); 0: none */
  reach = 0;
  private t = 0;
  private readonly layers: Container[];
  private readonly textures: Record<FireLayer, Texture[]>;
  private readonly baseScale: number;
  private readonly parts: Sprite[][] = [];

  constructor(readonly path: FirePath) {
    super();
    this.textures = Object.fromEntries(fireLayers.map((l) => [l, fireDef.animations[l].frames.map(tex)])) as Record<FireLayer, Texture[]>;
    this.baseScale = fireDef.displayHeight / this.textures.outer[0].height;
    this.layers = fireLayers.map(() => this.addChild(new Container()));
    // enough puffs to cover the path; they wrap round past its end, so one comes out of the mouth every `puffSpacing`
    const n = Math.ceil(path.length / dragonConfig.fire.puffSpacing) + 2;
    for (let i = 0; i < n; i++) {
      this.parts.push(
        this.layers.map((layer, l) => {
          const s = new Sprite(this.textures[fireLayers[l]][0]);
          s.anchor.set(fireDef.anchor.x, fireDef.anchor.y);
          return layer.addChild(s);
        }),
      );
    }
  }

  step(stepMs: number) {
    this.t += stepMs;
  }

  sync() {
    const f = dragonConfig.fire;
    const len = this.path.length;
    const n = this.parts.length;
    const travelled = (this.t * f.flowSpeed) / 1000;
    const fps = fireDef.animations.outer.fps;
    const frameCount = this.textures.outer.length;
    for (let i = 0; i < n; i++) {
      const parts = this.parts[i];
      const d = (travelled + i * f.puffSpacing) % (n * f.puffSpacing);
      const shown = this.reach > 0 && d <= this.reach && d <= len;
      for (const s of parts) s.visible = shown;
      if (!shown) continue;
      const grow = f.startScale + (1 - f.startScale) * smoothstep(d / f.growOver);
      const taper = f.endScale + (1 - f.endScale) * smoothstep((this.reach - d) / f.taperOver);
      const scale = this.baseScale * grow * taper * (1 + (f.spread * d) / len);
      const at = this.path.pointAt(d);
      // a wobble across the path, growing away from the mouth
      const off = Math.sin(d / 22 - this.t / 110) * f.wobble * (d / len);
      const x = at.x - Math.sin(at.angle) * off, y = at.y + Math.cos(at.angle) * off;
      // heading left, the puff is mirrored rather than turned upside down, so its flames still lick upwards
      const left = Math.cos(at.angle) < 0;
      const rotation = (left ? at.angle - Math.PI : at.angle) + Math.sin(i * 1.3 + this.t / 170) * 0.06;
      // each puff flickers through the frames out of step with its neighbours
      const frame = (Math.floor((this.t * fps) / 1000) + i * 3) % frameCount;
      parts.forEach((s, l) => {
        s.texture = this.textures[fireLayers[l]][frame];
        s.position.set(x, y);
        s.scale.set(left ? -scale : scale, scale);
        s.rotation = rotation;
      });
    }
  }
}

const smoothstep = (x: number) => {
  const c = Math.max(0, Math.min(1, x));
  return c * c * (3 - 2 * c);
};
