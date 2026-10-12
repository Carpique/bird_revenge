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

/**
 * Walks back and forth on the ground. When hit, he is knocked off the screen arcade style:
 * a little hop, then a parabolic fall past the bottom edge, growing as if flying towards the camera.
 * Then a new one comes in.
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
    this.state = 'hit';
    this.timer = 0;
    return true;
  }

  /** Back to a fresh villain walking in from the left (new game). */
  reset(x: number) {
    this.x = x;
    this.dir = 1;
    this.enter('walking');
  }

  step(stepMs: number) {
    const speed = config.villain.speed;
    this.timer += stepMs;
    switch (this.state) {
      case 'walking':
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
    this.view.play(this.state === 'walking' ? 'walk' : 'hit');
  }

  private enter(state: State) {
    this.state = state;
    this.timer = 0;
    if (state === 'walking') {
      this.y = STAND_Y;
      this.scale = 1;
    }
  }
}
