import { batDef, batRadius } from '../characters/bat';
import { config, WORLD } from '../config';
import type { BatDef } from '../level/types';
import { CharacterSprite } from '../render/CharacterSprite';
import { Bodies, Body, type MBody } from './physics';

type State = 'flying' | 'hit' | 'falling' | 'gone';
type BatAnim = keyof typeof batDef.animations;

/** where its poo leaves it: below its centre */
const POO_DY = 18;
/** how far it leans (radians) per px per step of sideways speed, and at most */
const LEAN = 0.04, MAX_LEAN = 0.3;

const randomBetween = (lo: number, hi: number) => lo + Math.random() * Math.max(0, hi - lo);

/**
 * Flies along its route at a steady speed, from its start: there and back again along an open polyline,
 * round and round a closed one. Every `pooDelay` seconds or so (± `bat.intervalSpread`) it poos straight down,
 * wherever it is; its poo hurts only the bird (see Game).
 * Hit by the bird's poo, it hangs in the air for a moment in its "hit" pose, then tumbles off the bottom of the screen,
 * gone for good. Touching a flying bat costs the bird a life, as a walking villain does.
 */
export class Bat {
  readonly body: MBody;
  readonly view = new CharacterSprite<BatAnim>(batDef);
  /** hangs in the air where it is (the level is won); one already hit still falls */
  frozen = false;
  /** called when it poos, with where the poo leaves it */
  onPoo: ((x: number, y: number) => void) | null = null;
  private state: State = 'flying';
  private x: number;
  private y: number;
  /** sideways speed this step, for the lean */
  private vx = 0;
  private vy = 0;
  private timer = 0;
  /** index of the route point it's flying to */
  private target: number;
  /** which way along the route it goes: forward (1) or back (-1); only an open route turns back */
  private dir: 1 | -1 = 1;
  /** ms until it poos next */
  private pooIn: number;

  constructor(private def: BatDef) {
    [this.x, this.y] = def.start;
    this.target = def.target;
    this.pooIn = this.nextPooDelay();
    this.body = Bodies.circle(this.x, this.y, batRadius, { label: 'bat', isStatic: true, isSensor: true });
  }

  get hittable() {
    return this.state === 'flying';
  }

  /** Does a circle (the bird) overlap a flying bat? */
  touches(cx: number, cy: number, r: number): boolean {
    if (this.state !== 'flying') return false;
    const d = r + batRadius;
    return (cx - this.x) ** 2 + (cy - this.y) ** 2 < d * d;
  }

  /** Returns true if this hit counts. */
  hit(): boolean {
    if (!this.hittable) return false;
    this.enter('hit');
    return true;
  }

  /** where it is: its centre */
  get position() {
    return { x: this.x, y: this.y };
  }

  step(stepMs: number) {
    if (this.frozen && this.state === 'flying') return;
    this.timer += stepMs;
    switch (this.state) {
      case 'flying': {
        const x0 = this.x;
        this.fly(this.def.speed);
        this.vx = this.x - x0;
        this.pooIn -= stepMs;
        if (this.pooIn <= 0) {
          this.pooIn = this.nextPooDelay();
          this.onPoo?.(this.x, this.y + POO_DY);
        }
        break;
      }
      case 'hit':
        if (this.timer >= config.bat.hitShowMs) {
          this.enter('falling');
          this.vy = 0;
        }
        break;
      case 'falling':
        this.vy += config.bat.fallGravity;
        this.y += this.vy;
        this.view.rotation += (config.bat.fallSpin * 2 * Math.PI * stepMs) / 1000;
        if (this.y - batDef.displayHeight > WORLD.height) this.enter('gone');
        break;
      case 'gone':
        break;
    }
    // only a flying bat can be hit, so the body just parks off-screen otherwise
    Body.setPosition(this.body, this.state === 'flying' ? { x: this.x, y: this.y } : { x: -1000, y: -1000 });
  }

  sync() {
    this.view.visible = this.state !== 'gone';
    this.view.position.set(this.x, this.y);
    if (this.state === 'flying') this.view.rotation = Math.max(-MAX_LEAN, Math.min(this.vx * LEAN, MAX_LEAN));
    if (this.frozen && this.state === 'flying') this.view.anim.stop();
    else this.view.play(this.state === 'flying' ? 'fly' : 'hit');
  }

  /** Moves `dist` px along the route, turning at the ends of an open one, going round a closed one. */
  private fly(dist: number) {
    const route = this.def.route;
    // a few points at most per step; the cap stops a route of all-equal points spinning forever
    for (let i = 0; i < route.length * 2 && dist > 0; i++) {
      const [tx, ty] = route[this.target];
      const left = Math.hypot(tx - this.x, ty - this.y);
      if (left > dist) {
        this.x += ((tx - this.x) * dist) / left;
        this.y += ((ty - this.y) * dist) / left;
        return;
      }
      this.x = tx;
      this.y = ty;
      dist -= left;
      this.target = this.nextTarget();
    }
  }

  /** The route point after the one it just reached. */
  private nextTarget(): number {
    const n = this.def.route.length;
    if (this.def.loop) return (this.target + this.dir + n) % n;
    if (this.target + this.dir < 0 || this.target + this.dir >= n) this.dir = this.dir > 0 ? -1 : 1;
    return this.target + this.dir;
  }

  /** ms until the next poo: around `pooDelay`, never (Infinity) when it's 0 */
  private nextPooDelay() {
    if (this.def.pooDelay <= 0) return Infinity;
    const ms = this.def.pooDelay * 1000, spread = config.bat.intervalSpread;
    return randomBetween(ms * (1 - spread), ms * (1 + spread));
  }

  private enter(state: State) {
    this.state = state;
    this.timer = 0;
  }
}
