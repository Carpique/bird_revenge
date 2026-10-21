import { splatHalfWidth } from '../characters/poo';
import { villainDef, villainHitbox } from '../characters/villain';
import { config, WORLD } from '../config';
import { CharacterSprite } from '../render/CharacterSprite';
import type { Cover } from './cover';
import { Bodies, Body, type MBody } from './physics';

type State = 'walking' | 'hit' | 'falling' | 'gone';
type VillainAnim = keyof typeof villainDef.animations;

const MIN_X = 60, MAX_X = WORLD.width - 60;
const HEIGHT = villainDef.displayHeight;
/** body centre when standing on the ground */
const STAND_Y = WORLD.groundY - HEIGHT / 2;
/** where the apple leaves his hand: in front of him (along his facing), above the feet */
const HAND_DX = 22, HAND_Y = WORLD.groundY - 95;
/** he comes out of hiding only this much (% of the screen width) past `hideDistancePct`, so he doesn't dither at the edge */
const UNHIDE_MARGIN_PCT = 5;

/** What the villain reacts to, as it is this step. */
export interface Surroundings {
  /** where the bird is (centre and radius), or null when there's nothing to throw at, hide from or rush at (bird dying) */
  bird: { x: number; y: number; r: number } | null;
  /** centres of the poo splats on the ground, which he won't step into */
  splatXs: readonly number[];
  /** stretches of ground he can hide under */
  covers: readonly Cover[];
}

const randomBetween = (lo: number, hi: number) => lo + Math.random() * Math.max(0, hi - lo);
const nextThrowDelay = () => randomBetween(config.apple.minIntervalMs, config.apple.maxIntervalMs);
const nextWalkTime = () => randomBetween(config.villain.minWalkMs, config.villain.maxWalkMs);
const nextPauseTime = () => randomBetween(config.villain.minPauseMs, config.villain.maxPauseMs);

/**
 * Strolls back and forth along the whole ground, now and then stopping for a moment and walking on the same way. When hit, he is knocked off the screen arcade style:
 * a little hop, then a parabolic fall past the bottom edge, growing as if flying towards the camera.
 * Then a new one comes in.
 * He doesn't throw while the bird is far; hiding from it, every now and then he stops, turns to the bird
 * and throws an apple at it.
 * He never steps into a poo splat: about to, he stops as if for one of his usual stops, then turns back.
 * When the bird comes horizontally close he runs (no stops, no throws) to the nearest cover he can reach
 * without crossing a splat, then roams under it, walking on in a random direction after each stop and
 * throwing from there, until the bird is well away again. With no cover reachable he strolls on as in the open, but still throws.
 * A bird that close and down at his height (on the ground or flying low), though, he rushes at, at his usual speed
 * (still never into a splat); once it's up again he runs for cover.
 */
export class Villain {
  readonly body: MBody;
  readonly view = new CharacterSprite<VillainAnim>(villainDef);
  private state: State = 'walking';
  private x: number;
  /** y of the body centre (the fall scales around it) */
  private y = STAND_Y;
  private vx = 0;
  private vy = 0;
  private scale = 1;
  private dir: 1 | -1 = 1;
  /** the bird came close: he keeps to (or runs for) the nearest cover */
  private hiding = false;
  /** the bird is close and down at his height: he goes for it */
  private rushing = false;
  private timer = 0;
  /** ms until he starts the next throw (counts down only while hiding) */
  private throwIn = nextThrowDelay();
  /** ms until he stops for a moment */
  private walkIn = nextWalkTime();
  /** ms left of a stop, or null when walking */
  private pauseLeft: number | null = null;
  /** ms into the windup of a throw (standing still, facing the bird), or null when not throwing */
  private aimT: number | null = null;
  /** called when an apple leaves his hand, with the hand position */
  onThrow: ((x: number, y: number) => void) | null = null;

  constructor(x: number) {
    this.x = x;
    this.body = Bodies.rectangle(x, WORLD.groundY - villainHitbox.height / 2, villainHitbox.width, villainHitbox.height, {
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
    const ny = Math.max(WORLD.groundY - h, Math.min(cy, WORLD.groundY));
    return (cx - nx) ** 2 + (cy - ny) ** 2 < r * r;
  }

  /** Returns true if this hit counts. */
  hit(): boolean {
    if (!this.hittable) return false;
    this.enter('hit');
    return true;
  }

  /** Back to a fresh villain walking in from the left (new game). */
  reset(x: number) {
    this.x = x;
    this.dir = 1;
    this.enter('walking');
  }

  step(stepMs: number, { bird, splatXs, covers }: Surroundings) {
    const speed = config.villain.speed;
    const birdX = bird?.x ?? null;
    this.timer += stepMs;
    switch (this.state) {
      case 'walking': {
        this.updatePerception(bird);
        if (this.rushing && bird) {
          // no stops, no throws; stands still under the bird or in front of a splat
          this.aimT = null;
          this.pauseLeft = null;
          const dx = bird.x - this.x;
          if (Math.abs(dx) < speed) break;
          this.dir = dx < 0 ? -1 : 1;
          if (!this.splatAhead(splatXs, speed)) this.x += this.dir * speed;
          break;
        }
        if (this.aimT !== null) {
          if (birdX === null) {
            this.aimT = null;
            this.throwIn = nextThrowDelay();
            break;
          }
          this.dir = birdX < this.x ? -1 : 1;
          this.aimT += stepMs;
          if (this.aimT >= config.apple.windupMs) {
            this.aimT = null;
            this.throwIn = nextThrowDelay();
            this.onThrow?.(this.x + this.dir * HAND_DX, HAND_Y);
          }
          break;
        }
        // where he roams: the whole screen, or (hiding) the stretch under his cover
        let lo = MIN_X, hi = MAX_X;
        const cover = this.hiding ? this.nearestCover(covers, splatXs) : null;
        if (cover) {
          if (this.x < cover.lo || this.x > cover.hi) {
            // running for cover: no stops, no throws
            this.pauseLeft = null;
            this.dir = this.x < cover.lo ? 1 : -1;
            this.x += this.dir * speed;
            break;
          }
          lo = cover.lo;
          hi = cover.hi;
        }
        const onScreen = this.x >= MIN_X && this.x <= MAX_X;
        // only throws when hiding from the bird, fully on screen (also in the middle of a stop)
        if (birdX !== null && this.hiding && onScreen) {
          this.throwIn -= stepMs;
          if (this.throwIn <= 0) {
            this.aimT = 0;
            this.pauseLeft = null;
            break;
          }
        }
        if (this.pauseLeft !== null) {
          this.pauseLeft -= stepMs;
          if (this.pauseLeft <= 0) {
            this.pauseLeft = null;
            this.walkIn = nextWalkTime();
            // under cover he walks on in a random direction; out in the open he strolls the full length,
            // turning only at the ends of his path or at a splat
            if (cover) this.dir = Math.random() < 0.5 ? -1 : 1;
            if (this.splatAhead(splatXs, speed)) this.dir = this.dir > 0 ? -1 : 1;
          }
          break;
        }
        // only stops while fully on screen, so he never lingers half off it
        if (onScreen) {
          this.walkIn -= stepMs;
          if (this.walkIn <= 0) {
            this.pauseLeft = nextPauseTime();
            break;
          }
        }
        if (this.splatAhead(splatXs, speed)) {
          this.pauseLeft = nextPauseTime();
          break;
        }
        this.x += this.dir * speed;
        if (this.x > hi) this.dir = -1;
        if (this.x < lo) this.dir = 1;
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
        if (this.timer >= config.villain.respawnDelayMs) {
          const fromLeft = Math.random() < 0.5;
          this.x = fromLeft ? -60 : WORLD.width + 60;
          this.dir = fromLeft ? 1 : -1;
          this.enter('walking');
        }
        break;
    }
    // only a walking villain can be hit, so the body just parks off-screen otherwise
    Body.setPosition(this.body, { x: this.state === 'walking' ? this.x : -1000, y: WORLD.groundY - villainHitbox.height / 2 });
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

  /**
   * Hides when the bird comes horizontally close; comes out once it's a bit farther away again (or gone).
   * Rushes at it instead while it's that close and down at his height (its circle reaching below the top of his hitbox).
   */
  private updatePerception(bird: Surroundings['bird']) {
    if (!bird) {
      this.hiding = this.rushing = false;
      return;
    }
    const pct = (Math.abs(bird.x - this.x) / WORLD.width) * 100;
    // once on the alert he stays so until the bird is past the margin
    const alertPct = config.villain.hideDistancePct + (this.hiding ? UNHIDE_MARGIN_PCT : 0);
    this.hiding = pct < alertPct;
    this.rushing = this.hiding && bird.y + bird.r > WORLD.groundY - villainHitbox.height;
  }

  /**
   * The closest stretch where his whole hitbox is under a cover, among those he can walk to without
   * stepping into a splat; null when there's none (then he just roams on).
   */
  private nearestCover(covers: readonly Cover[], splatXs: readonly number[]): { lo: number; hi: number } | null {
    const halfW = villainHitbox.width / 2;
    let best: { lo: number; hi: number } | null = null, bestDist = Infinity;
    for (const c of covers) {
      const lo = Math.max(c.x0 + halfW, MIN_X), hi = Math.min(c.x1 - halfW, MAX_X);
      if (lo > hi) continue;
      const target = Math.max(lo, Math.min(this.x, hi));
      const dist = Math.abs(target - this.x);
      if (dist >= bestDist) continue;
      const dir = Math.sign(target - this.x);
      const blocked = dir !== 0 && splatXs.some((sx) => {
        const ahead = (sx - this.x) * dir;
        return ahead > 0 && ahead < dist + halfW + splatHalfWidth;
      });
      if (blocked) continue;
      best = { lo, hi };
      bestDist = dist;
    }
    return best;
  }

  /** Would the next step (of `speed` px) take his feet into a splat in front of him? */
  private splatAhead(splatXs: readonly number[], speed: number): boolean {
    const reach = villainHitbox.width / 2 + splatHalfWidth + speed;
    return splatXs.some((sx) => {
      const ahead = (sx - this.x) * this.dir;
      return ahead > 0 && ahead < reach;
    });
  }

  private enter(state: State) {
    this.state = state;
    this.timer = 0;
    this.aimT = null;
    this.pauseLeft = null;
    this.hiding = this.rushing = false;
    if (state === 'walking') {
      this.throwIn = nextThrowDelay();
      this.walkIn = nextWalkTime();
      this.y = STAND_Y;
      this.scale = 1;
    }
  }
}
