import { Container, Graphics, Sprite } from 'pixi.js';
import { pooDef } from '../characters/poo';
import { WORLD } from '../config';
import { tex } from '../render/assets';
import { view } from '../render/fitWorld';

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
  /** px/s, the plane's speed varied at random (before `size`) */
  speed: number;
  /** rad/s, positive clockwise */
  spin: number;
}

/**
 * Background rain of poo for the title screen: several depth planes, further ones smaller, slower
 * and dimmer. Every poo falls all the way down and sinks behind the ground line (the rain is clipped
 * there), then starts again at the top. It fills the whole screen above the ground (`view`), not just the world.
 */
export class PooRain extends Container {
  private drops: Drop[] = [];
  private clip = new Graphics();
  /** the screen (`view`) the clip was drawn for */
  private clipped = { left: 0, top: 0, right: 0 };
  /** every poo's size, and with it its speed, 1 = as in `PLANES` */
  private size = 1;

  constructor() {
    super();
    this.addChild(this.clip);
    this.mask = this.clip;
    this.fitClip();
    // the furthest plane first, so the nearer ones draw over it
    for (const plane of [...PLANES].reverse()) {
      for (let i = 0; i < plane.count; i++) {
        const sprite = new Sprite(tex(pooDef.animations.falling.frames[0]));
        sprite.anchor.set(pooDef.anchor.x, pooDef.anchor.y);
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
    this.resize(1);
  }

  /**
   * Every poo `size` times as big as in `PLANES` (and as fast, so they look the same, only closer). Changing it scatters
   * them afresh over the screen above the ground (`view`), which may have changed shape too.
   */
  setSize(size: number) {
    if (size === this.size) return;
    this.resize(size);
    for (const drop of this.drops) this.respawn(drop, view.top + Math.random() * (WORLD.groundY - view.top));
  }

  private resize(size: number) {
    this.size = size;
    for (const { sprite, plane } of this.drops) sprite.scale.set((pooDef.displayHeight / sprite.texture.height) * plane.scale * size);
  }

  /** Back to falling, at height `y`, a random x and a slightly random speed (it keeps its spin). */
  private respawn(drop: Drop, y: number) {
    drop.sprite.position.set(view.left + Math.random() * (view.right - view.left), y);
    drop.speed = drop.plane.speed * (1 + (Math.random() * 2 - 1) * SPEED_SPREAD);
  }

  /** Clip to the screen above the ground line. */
  private fitClip() {
    const { left, top, right } = view, c = this.clipped;
    if (left === c.left && top === c.top && right === c.right) return;
    this.clipped = { left, top, right };
    this.clip.clear().rect(left, top, right - left, WORLD.groundY - top).fill(0xffffff);
  }

  update(dtMs: number) {
    this.fitClip();
    const dt = Math.min(dtMs, MAX_DT_MS);
    for (const drop of this.drops) {
      const { sprite } = drop;
      sprite.y += (drop.speed * this.size * dt) / 1000;
      sprite.rotation += (drop.spin * dt) / 1000;
      // fully sunk behind the ground line (its farthest corner from the anchor, whichever way it's
      // turned): start again just above the top, at a random delay so the planes don't fall in waves
      const reach = Math.hypot(
        Math.max(sprite.anchor.x, 1 - sprite.anchor.x) * sprite.width,
        Math.max(sprite.anchor.y, 1 - sprite.anchor.y) * sprite.height,
      );
      if (sprite.y - reach >= WORLD.groundY) this.respawn(drop, view.top - sprite.height - Math.random() * WORLD.groundY * 0.5 * this.size);
    }
  }
}
