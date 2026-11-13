import { Container, FillGradient, Graphics, Sprite, Texture } from 'pixi.js';
import { WORLD } from '../config';
import type { TimeOfDay } from '../level/types';
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

/** How far past the world the sky reaches, in world sizes: further than any screen shows (`view`). */
const SKY_MARGIN = 3;

/** A repeatable random sequence in 0..1 (mulberry32), so the stars are the same every time. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The full moon, `r` its radius, centred on 0,0: a soft glow, the disc, a few grey seas. */
function moon(r: number): Graphics {
  const { color, glow } = scenery.moon;
  const g = new Graphics();
  // a soft halo: many faint rings, stacking up towards the disc
  for (let i = 12; i > 0; i--) g.circle(0, 0, r * (1 + i * 0.12)).fill({ color: glow, alpha: 0.025 });
  g.circle(0, 0, r).fill(color);
  const seas: [number, number, number][] = [[-0.3, -0.25, 0.28], [0.25, -0.1, 0.2], [0.05, 0.35, 0.24], [-0.4, 0.25, 0.12], [0.45, 0.35, 0.1]];
  for (const [x, y, s] of seas) g.circle(x * r, y * r, s * r).fill({ color: '#cfcab0', alpha: 0.55 });
  return g;
}

/**
 * Stars over the sky in two layers that twinkle out of step; denser towards the top. `perWorld`: how many in a
 * world-sized stretch of sky, spread over every stretch a screen can show.
 */
function stars(perWorld: number): [Graphics, Graphics] {
  const rnd = random(7);
  const layers: [Graphics, Graphics] = [new Graphics(), new Graphics()];
  const top = -WORLD.height, bottom = WORLD.groundY * 0.7;
  for (let col = -1; col <= 1; col++) {
    for (let i = 0; i < perWorld * 2; i++) {
      const x = (col + rnd()) * WORLD.width, y = top + (bottom - top) * rnd() ** 1.6;
      const r = 0.7 + rnd() ** 3 * 1.8;
      layers[i % 2].circle(x, y, r).fill({ color: '#ffffff', alpha: 0.45 + rnd() * 0.55 });
    }
  }
  return layers;
}

/** How far past the world's sides the haze reaches before wrapping round: more than half its widest cloud. */
const HAZE_MARGIN = 360;

/** A soft white blob fading out to nothing at its rim; stretched, the stuff the haze is made of. */
function blobTexture(): Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const fade = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  fade.addColorStop(0, 'rgba(255,255,255,1)');
  fade.addColorStop(0.45, 'rgba(255,255,255,0.6)');
  fade.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, size, size);
  return Texture.from(canvas);
}

/**
 * The hazy clouds of one band (`scenery.haze`): each a flat blob with two smaller ones over it, off centre, for an
 * uneven shape. Spread evenly across the screen, then shifted at random, which leaves the gaps.
 */
function hazeBand(band: (typeof scenery.haze)[number], blob: Texture, rnd: () => number) {
  const between = ([from, to]: [number, number], t = rnd()) => from + (to - from) * t;
  const span = WORLD.width + 2 * HAZE_MARGIN;
  const blobs: { sprite: Sprite; alpha: number; speed: number }[] = [];
  const add = (x: number, y: number, width: number, height: number, alpha: number) => {
    const sprite = new Sprite(blob);
    sprite.anchor.set(0.5);
    sprite.position.set(x, y);
    sprite.width = width;
    sprite.height = height;
    blobs.push({ sprite, alpha, speed: band.driftSpeed });
  };
  for (let i = 0; i < band.count; i++) {
    const x = -HAZE_MARGIN + ((i + rnd()) / band.count) * span, y = between(band.y, rnd() ** 1.5);
    const width = between(band.width), height = between(band.height), alpha = between(band.alpha);
    add(x, y, width, height, alpha);
    for (const side of [-1, 1]) {
      const k = 0.5 + rnd() * 0.3;
      add(x + side * rnd() * 0.35 * width, y + (rnd() - 0.5) * 0.6 * height, width * k, height * k, alpha * 0.7);
    }
  }
  return blobs;
}

/** The sky, sun or moon and stars, drifting clouds, the haze above the world and the ground behind everything; `timeOfDay` sets which. */
export class Background extends Container {
  private sky = new Graphics();
  private sun: Sprite;
  private moon: Graphics;
  private stars: [Graphics, Graphics];
  private clouds: { sprite: Sprite; speed: number }[] = [];
  /** the hazy clouds at and above the world's top, where the bird can't fly */
  private haze = new Container();
  private hazeClouds: { sprite: Sprite; alpha: number; speed: number }[] = [];
  private ground = new Ground();
  private time: TimeOfDay | null = null;
  /** the sky's gradient, destroyed when the sky changes */
  private gradient: FillGradient | null = null;
  /** ms, for the stars' twinkling */
  private t = 0;

  constructor() {
    super();
    const { sun, clouds } = scenery;
    this.sun = spriteAt(sun.image, sun.x, sun.y, sun.height);
    this.moon = moon(scenery.moon.height / 2);
    this.moon.position.set(sun.x, sun.y);
    this.stars = stars(scenery.timesOfDay.night.stars);
    this.addChild(this.sky, ...this.stars, this.sun, this.moon);
    for (const c of clouds) {
      const sprite = spriteAt(c.image, c.x, c.y, c.height);
      this.clouds.push({ sprite, speed: c.driftSpeed });
      this.addChild(sprite);
    }
    const rnd = random(11), blob = blobTexture();
    for (const band of scenery.haze) this.hazeClouds.push(...hazeBand(band, blob, rnd));
    this.haze.addChild(...this.hazeClouds.map((c) => c.sprite));
    this.addChild(this.haze, this.ground);
    this.timeOfDay = 'afternoon';
  }

  set timeOfDay(time: TimeOfDay) {
    if (time === this.time) return;
    this.time = time;
    const look = scenery.timesOfDay[time];
    this.drawSky(look);
    this.sun.visible = look.sun;
    this.moon.visible = look.moon;
    for (const s of this.stars) s.visible = look.stars > 0;
    for (const c of this.clouds) {
      c.sprite.tint = look.tint;
      c.sprite.alpha = look.clouds;
    }
    for (const c of this.hazeClouds) {
      c.sprite.tint = look.tint;
      c.sprite.alpha = c.alpha * look.clouds;
    }
    this.ground.tint = look.tint;
  }

  private drawSky(look: (typeof scenery.timesOfDay)[TimeOfDay]) {
    const w = WORLD.width, h = WORLD.height, m = SKY_MARGIN;
    const between = 'between' in look ? look.between : [];
    this.gradient?.destroy();
    this.gradient = new FillGradient({
      type: 'linear',
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      colorStops: [
        { offset: 0, color: look.top },
        ...between.map(([offset, color]) => ({ offset, color })),
        { offset: 1, color: look.horizon },
      ],
      textureSpace: 'local',
    });
    // above the world's top: the top colour; the gradient down to the ground; behind the ground, its own colour
    this.sky
      .clear()
      .rect(-w * m, -h * m, w * (2 * m + 1), h * m)
      .fill(look.top)
      .rect(-w * m, 0, w * (2 * m + 1), WORLD.groundY)
      .fill(this.gradient)
      .rect(-w * m, WORLD.groundY, w * (2 * m + 1), h * m)
      .fill('behindGround' in look ? look.behindGround : look.horizon);
  }

  /** Extend the ground to the screen's edges (`view`), and show the haze if the screen reaches above the world; call after `fitWorld`. */
  fit() {
    this.ground.fit();
    this.haze.visible = view.top < 0;
  }

  update(dtMs: number) {
    // the clouds drift across the whole screen, also where it's wider than the world
    const left = Math.min(0, view.left), right = Math.max(WORLD.width, view.right);
    for (const c of this.clouds) {
      c.sprite.x += (c.speed * dtMs) / 1000;
      const half = c.sprite.width / 2;
      if (c.sprite.x - half > right) c.sprite.x = left - half;
    }
    if (this.haze.visible) {
      // all wrap round the same stretch, so each band keeps its pattern
      for (const c of this.hazeClouds) {
        c.sprite.x += (c.speed * dtMs) / 1000;
        if (c.sprite.x > WORLD.width + HAZE_MARGIN) c.sprite.x -= WORLD.width + 2 * HAZE_MARGIN;
      }
    }
    if (this.stars[0].visible) {
      this.t += dtMs;
      const a = (this.t / 1000) * 1.3;
      this.stars[0].alpha = 0.75 + 0.25 * Math.sin(a);
      this.stars[1].alpha = 0.75 + 0.25 * Math.sin(a + Math.PI);
    }
  }
}
