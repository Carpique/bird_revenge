import { Container, Graphics, Sprite } from 'pixi.js';
import { pooDef } from '../characters/poo';
import { WORLD } from '../config';
import { tex } from '../render/assets';

/** depth planes, nearest first: the nearest is full poo size and already half-transparent */
const PLANES = [
  { scale: 1, alpha: 0.5, speed: 38, count: 6 },
  { scale: 0.72, alpha: 0.32, speed: 28, count: 14 },
  { scale: 0.5, alpha: 0.2, speed: 20, count: 24 },
  { scale: 0.34, alpha: 0.12, speed: 14, count: 40 },
];
/** longest frame step taken at once, so a backgrounded tab doesn't drop everything in one go */
const MAX_DT_MS = 50;
/** each poo's speed differs from its plane's by up to this fraction, either way */
const SPEED_SPREAD = 0.2;
/**
 * fastest spin of a poo (rad/s): 30 RPM; each gets a random speed up to this (evenly spread, so 15 RPM
 * on average), either way round
 */
const MAX_SPIN = Math.PI;

interface Drop {
  sprite: Sprite;
  plane: (typeof PLANES)[number];
  /** px/s, the plane's speed varied at random */
  speed: number;
  /** rad/s, positive clockwise */
  spin: number;
}

/**
 * Background rain of poo for the title screen: several depth planes, further ones smaller, slower
 * and dimmer. Every poo falls all the way down and sinks behind the ground line (the rain is clipped
 * there), then starts again at the top.
 */
export class PooRain extends Container {
  private drops: Drop[] = [];

  constructor() {
    super();
    const clip = new Graphics().rect(0, 0, WORLD.width, WORLD.groundY).fill(0xffffff);
    this.addChild(clip);
    this.mask = clip;
    // the furthest plane first, so the nearer ones draw over it
    for (const plane of [...PLANES].reverse()) {
      for (let i = 0; i < plane.count; i++) {
        const sprite = new Sprite(tex(pooDef.animations.falling.frames[0]));
        sprite.anchor.set(pooDef.anchor.x, pooDef.anchor.y);
        sprite.scale.set((pooDef.displayHeight / sprite.texture.height) * plane.scale);
        sprite.alpha = plane.alpha;
        // a random starting angle and spin, kept for good: the poo turns the same way at the same rate
        // through every fall
        sprite.rotation = Math.random() * 2 * Math.PI;
        const drop = { sprite, plane, speed: plane.speed, spin: (Math.random() * 2 - 1) * MAX_SPIN };
        this.drops.push(drop);
        this.addChild(sprite);
        this.respawn(drop, Math.random() * WORLD.groundY);
      }
    }
  }

  /** Back to falling, at height `y`, a random x and a slightly random speed (it keeps its spin). */
  private respawn(drop: Drop, y: number) {
    drop.sprite.position.set(Math.random() * WORLD.width, y);
    drop.speed = drop.plane.speed * (1 + (Math.random() * 2 - 1) * SPEED_SPREAD);
  }

  update(dtMs: number) {
    const dt = Math.min(dtMs, MAX_DT_MS);
    for (const drop of this.drops) {
      const { sprite } = drop;
      sprite.y += (drop.speed * dt) / 1000;
      sprite.rotation += (drop.spin * dt) / 1000;
      // fully sunk behind the ground line (its farthest corner from the anchor, whichever way it's
      // turned): start again just above the top, at a random delay so the planes don't fall in waves
      const reach = Math.hypot(
        Math.max(sprite.anchor.x, 1 - sprite.anchor.x) * sprite.width,
        Math.max(sprite.anchor.y, 1 - sprite.anchor.y) * sprite.height,
      );
      if (sprite.y - reach >= WORLD.groundY) this.respawn(drop, -sprite.height - Math.random() * WORLD.groundY * 0.5);
    }
  }
}
