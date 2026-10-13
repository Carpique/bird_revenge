import { villainDef, villainHitbox } from '../characters/villain';
import { config, WORLD } from '../config';
import { CharacterSprite } from '../render/CharacterSprite';
import { Bodies, Body, type MBody } from './physics';

type State = 'walking' | 'hit' | 'falling' | 'gone';
type VillainAnim = keyof typeof villainDef.animations;

const MIN_X = 60, MAX_X = WORLD.width - 60;
const HEIGHT = villainDef.displayHeight;
/** body centre when standing on the ground */
const STAND_Y = WORLD.groundY - HEIGHT / 2;
/** where the apple leaves his hand: in front of him (along his facing), above the feet */
const HAND_DX = 22, HAND_Y = WORLD.groundY - 95;

const nextThrowDelay = () => {
  const { minIntervalMs: lo, maxIntervalMs: hi } = config.apple;
  return lo + Math.random() * Math.max(0, hi - lo);
};

/**
 * Walks back and forth on the ground. When hit, he is knocked off the screen arcade style:
 * a little hop, then a parabolic fall past the bottom edge, growing as if flying towards the camera.
 * Then a new one comes in.
 * Every now and then, while walking on screen, he stops, turns to the bird and throws an apple at it.
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
  private timer = 0;
  /** ms until he starts the next throw */
  private throwIn = nextThrowDelay();
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

  /** `targetX`: where the bird is, or null when there's nothing to throw at (bird dying) */
  step(stepMs: number, targetX: number | null) {
    const speed = config.villain.speed;
    this.timer += stepMs;
    switch (this.state) {
      case 'walking':
        if (this.aimT !== null) {
          if (targetX === null) {
            this.aimT = null;
            this.throwIn = nextThrowDelay();
            break;
          }
          this.dir = targetX < this.x ? -1 : 1;
          this.aimT += stepMs;
          if (this.aimT >= config.apple.windupMs) {
            this.aimT = null;
            this.throwIn = nextThrowDelay();
            this.onThrow?.(this.x + this.dir * HAND_DX, HAND_Y);
          }
          break;
        }
        // only throws while fully on screen
        if (targetX !== null && this.x >= MIN_X && this.x <= MAX_X) {
          this.throwIn -= stepMs;
          if (this.throwIn <= 0) {
            this.aimT = 0;
            break;
          }
        }
        this.x += this.dir * speed;
        if (this.x > MAX_X) this.dir = -1;
        if (this.x < MIN_X) this.dir = 1;
        break;
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
    // standing still in the windup of a throw
    if (this.aimT !== null) this.view.showPhase('walk', 0);
    else this.view.play(this.state === 'walking' ? 'walk' : 'hit');
  }

  private enter(state: State) {
    this.state = state;
    this.timer = 0;
    this.aimT = null;
    if (state === 'walking') {
      this.throwIn = nextThrowDelay();
      this.y = STAND_Y;
      this.scale = 1;
    }
  }
}
