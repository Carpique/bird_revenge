import { villainDef, villainHitbox } from '../characters/villain';
import { config, WORLD } from '../config';
import type { VillainDef } from '../level/types';
import { CharacterSprite } from '../render/CharacterSprite';
import { Bodies, Body, type MBody } from './physics';

type State = 'walking' | 'hit' | 'falling' | 'gone';
type VillainAnim = keyof typeof villainDef.animations;

/** his centre stays this far inside the screen edges, whatever his path */
const MIN_X = 60, MAX_X = WORLD.width - 60;
const HEIGHT = villainDef.displayHeight;
/** where the apple leaves his hand: in front of him (the way he walks), above the feet */
const HAND_DX = 22, HAND_DY = 95;

/** A stretch of ground, `x0` < `x1` (world px). */
export interface Span {
  x0: number;
  x1: number;
}

/** What the villain reacts to, as it is this step. */
export interface Surroundings {
  /** where the bird is, or null when there's nothing to throw at (bird dying) */
  bird: { x: number; y: number } | null;
  /**
   * what he won't walk into, one list per villain (they stand at different heights): poo splats, crates, terrain at his height,
   * and the stretches with nothing under his feet (past the edges of the shelf he walks on)
   */
  obstacles: readonly Span[];
}

const randomBetween = (lo: number, hi: number) => lo + Math.random() * Math.max(0, hi - lo);
const nextWalkTime = () => randomBetween(config.villain.minWalkMs, config.villain.maxWalkMs);
const nextPauseTime = () => randomBetween(config.villain.minPauseMs, config.villain.maxPauseMs);

/**
 * Walks back and forth along his path (on the ground, or on a shelf), now and then stopping for a moment and walking on the same way.
 * He starts off a random way, and his stops and throws are random too, so villains don't move in step.
 * He turns only at the ends of the path, or at an obstacle (a poo splat, a crate, the edge of his shelf): about to walk into one,
 * he stops as if for one of his usual stops, then turns back.
 * Every `throwDelay` seconds or so he stops and throws an apple at the bird, then walks on the way he was going.
 * He never turns to throw: only at a bird in front of him (the half of the world the way he walks); with the bird behind him
 * the throw waits until it's in front.
 * When hit, he is knocked off the screen arcade style: a little hop, then a parabolic fall past the bottom edge,
 * growing as if flying towards the camera. He's gone for good then.
 */
export class Villain {
  readonly body: MBody;
  readonly view = new CharacterSprite<VillainAnim>(villainDef);
  private state: State = 'walking';
  private x = 0;
  /** y of his feet: what he walks on */
  private feetY = WORLD.groundY;
  /** y of the body centre (the fall scales around it) */
  private y = WORLD.groundY - HEIGHT / 2;
  private vx = 0;
  private vy = 0;
  private scale = 1;
  /** the way he walks, and looks */
  private dir: 1 | -1 = 1;
  /** his path: the stretch his centre stays within */
  private lo = MIN_X;
  private hi = MAX_X;
  private timer = 0;
  /** average s between throws, 0 = never throws */
  private throwDelay = 0;
  /** ms until he starts the next throw */
  private throwIn = Infinity;
  /** ms until he stops for a moment */
  private walkIn = nextWalkTime();
  /** ms left of a stop, or null when walking */
  private pauseLeft: number | null = null;
  /** ms into the windup of a throw (standing still), or null when not throwing */
  private aimT: number | null = null;
  /** called when an apple leaves his hand, with the hand position and the way he faces (the apple must fly that way, or straight up/down) */
  onThrow: ((x: number, y: number, dir: 1 | -1) => void) | null = null;

  constructor(def: VillainDef) {
    this.place(def);
    this.body = Bodies.rectangle(this.x, this.feetY - villainHitbox.height / 2, villainHitbox.width, villainHitbox.height, {
      label: 'villain',
      isStatic: true,
      isSensor: true,
    });
  }

  get hittable() {
    return this.state === 'walking';
  }

  /** knocked off and flying towards the camera: drawn in front of everything */
  get falling() {
    return this.state === 'falling';
  }

  /** Does a circle (the bird) overlap the hitbox of a walking villain? */
  touches(cx: number, cy: number, r: number): boolean {
    if (this.state !== 'walking') return false;
    const { width: w, height: h } = villainHitbox;
    const nx = Math.max(this.x - w / 2, Math.min(cx, this.x + w / 2));
    const ny = Math.max(this.feetY - h, Math.min(cy, this.feetY));
    return (cx - nx) ** 2 + (cy - ny) ** 2 < r * r;
  }

  /** Returns true if this hit counts. */
  hit(): boolean {
    if (!this.hittable) return false;
    this.enter('hit');
    return true;
  }

  step(stepMs: number, { bird, obstacles }: Surroundings) {
    const speed = config.villain.speed;
    this.timer += stepMs;
    switch (this.state) {
      case 'walking': {
        if (this.aimT !== null) {
          if (!bird) {
            this.aimT = null;
            this.throwIn = this.nextThrowDelay();
            break;
          }
          this.aimT += stepMs;
          if (this.aimT >= config.apple.windupMs) {
            this.aimT = null;
            this.throwIn = this.nextThrowDelay();
            this.onThrow?.(this.x + this.dir * HAND_DX, this.feetY - HAND_DY, this.dir);
          }
          break;
        }
        // throws (also in the middle of a stop) while there's a bird in front of him to throw at
        if (bird) {
          this.throwIn -= stepMs;
          if (this.throwIn <= 0 && (bird.x - this.x) * this.dir >= 0) {
            this.aimT = 0;
            break;
          }
        }
        if (this.pauseLeft !== null) {
          this.pauseLeft -= stepMs;
          if (this.pauseLeft <= 0) {
            this.pauseLeft = null;
            this.walkIn = nextWalkTime();
            if (this.obstacleAhead(obstacles, speed)) this.turn();
          }
          break;
        }
        this.walkIn -= stepMs;
        if (this.walkIn <= 0 || this.obstacleAhead(obstacles, speed)) {
          this.pauseLeft = nextPauseTime();
          break;
        }
        this.x = Math.max(this.lo, Math.min(this.x + this.dir * speed, this.hi));
        if (this.x === (this.dir > 0 ? this.hi : this.lo)) this.turn();
        break;
      }
      case 'hit':
        if (this.timer >= config.villain.hitShowMs) {
          this.enter('falling');
          this.vx = -this.dir * config.villain.fallSideSpeed;
          this.vy = -config.villain.fallJumpSpeed;
        }
        break;
      case 'falling':
        this.vy += config.villain.fallGravity;
        this.x += this.vx;
        this.y += this.vy;
        this.scale += (config.villain.fallGrowth * stepMs) / 1000;
        // gone once the top of the (grown) sprite is below the screen
        if (this.y - (HEIGHT * this.scale) / 2 > WORLD.height) this.enter('gone');
        break;
      case 'gone':
        break;
    }
    // only a walking villain can be hit, so the body just parks off-screen otherwise
    Body.setPosition(this.body, { x: this.state === 'walking' ? this.x : -1000, y: this.feetY - villainHitbox.height / 2 });
  }

  sync() {
    this.view.visible = this.state !== 'gone';
    // the sprite's anchor is at the feet; keep the body centre in place while scaling
    this.view.scale.set(this.scale);
    this.view.position.set(this.x, this.y + (HEIGHT * this.scale) / 2);
    this.view.setFacing(this.dir > 0 ? 'right' : 'left');
    // standing still: in the windup of a throw, or stopped for a moment
    if (this.aimT !== null || this.pauseLeft !== null) this.view.showPhase('walk', 0);
    else this.view.play(this.state === 'walking' ? 'walk' : 'hit');
  }

  private turn() {
    this.dir = this.dir > 0 ? -1 : 1;
  }

  /** Would the next step (of `speed` px) take his feet into an obstacle in front of him? */
  private obstacleAhead(obstacles: readonly Span[], speed: number): boolean {
    const reach = villainHitbox.width / 2 + speed;
    return obstacles.some((o) => this.gapTo(o) < reach);
  }

  /**
   * How far the near side of an obstacle is from his centre, the way he walks; Infinity when it's behind him
   * (its middle is: so he can always walk out of one he's in).
   */
  private gapTo(o: Span): number {
    if (((o.x0 + o.x1) / 2 - this.x) * this.dir <= 0) return Infinity;
    return this.dir > 0 ? o.x0 - this.x : this.x - o.x1;
  }

  /** y of his feet: what he walks on */
  get feet() {
    return this.feetY;
  }

  /** Puts him at his start on his path (kept on the screen), facing a random way. */
  private place({ x, y, path, throwDelay }: VillainDef) {
    this.throwDelay = throwDelay;
    this.feetY = y;
    this.lo = Math.max(path.x0, MIN_X);
    this.hi = Math.min(path.x1, MAX_X);
    if (this.lo > this.hi) this.lo = this.hi = (this.lo + this.hi) / 2;
    this.x = Math.max(this.lo, Math.min(x, this.hi));
    this.dir = Math.random() < 0.5 ? -1 : 1;
    this.enter('walking');
  }

  /** ms until the next throw: around `throwDelay`, never (Infinity) when it's 0 */
  private nextThrowDelay() {
    if (this.throwDelay <= 0) return Infinity;
    const ms = this.throwDelay * 1000, spread = config.apple.intervalSpread;
    return randomBetween(ms * (1 - spread), ms * (1 + spread));
  }

  private enter(state: State) {
    this.state = state;
    this.timer = 0;
    this.aimT = null;
    this.pauseLeft = null;
    if (state === 'walking') {
      this.throwIn = this.nextThrowDelay();
      this.walkIn = nextWalkTime();
      this.y = this.feetY - HEIGHT / 2;
      this.scale = 1;
    }
  }
}
