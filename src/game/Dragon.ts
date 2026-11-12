import { Container } from 'pixi.js';
import { dragonConfig, dragonDef, type DragonAnim } from '../characters/dragon';
import type { DragonDef } from '../level/types';
import { CharacterSprite } from '../render/CharacterSprite';
import { FireStream } from '../render/FireStream';
import { fireRoute, type FirePath } from './firePath';

/**
 * resting: fidgeting now and then; opening: the jaw opening; spitting: the fire rolling out along its route, staying
 * out for `flameDuration`, rolling back into the mouth, the body shaking all the while; closing: the jaw closing.
 * Then resting again.
 */
export type DragonPhase = 'resting' | 'opening' | 'spitting' | 'closing';

/**
 * A dragon: it never moves and can't be hurt (it's outside the physics world, and poos pass it by); every `throwDelay`
 * seconds or so it spits fire along its route (`fireRoute`). The bird touching the fire loses a life (`touches`).
 * Its view holds the dragon and, in world coordinates, its fire.
 */
export class Dragon {
  readonly view = new Container();
  readonly route: FirePath;
  phase: DragonPhase = 'resting';
  private readonly sprite: CharacterSprite<DragonAnim>;
  private readonly fire: FireStream;
  /** ms left in the current phase */
  private phaseMs: number;
  /** ms since the spit began */
  private spitT = 0;
  private fidget: DragonAnim = 'idle';
  /** ms until the current fidget (or the wait for the next one) ends */
  private fidgetMs = randomWait();
  private shake = { x: 0, y: 0, ms: 0 };

  constructor(readonly def: DragonDef) {
    const [lo, hi] = dragonConfig.firstRestShare;
    this.phaseMs = this.nextSpitDelay() * (lo + Math.random() * (hi - lo));
    this.route = fireRoute(def);
    this.sprite = new CharacterSprite<DragonAnim>(dragonDef);
    this.sprite.setFacing(def.facing);
    this.fire = new FireStream(this.route);
    this.view.addChild(this.sprite, this.fire);
  }

  /** ms the whole spit takes: rolling out, staying out, rolling back */
  get spitMs() {
    return 2 * dragonConfig.fire.rollMs + this.def.flameDuration * 1000;
  }

  /** How far along its route the fire is out (px); 0: none. */
  get reach(): number {
    if (this.phase !== 'spitting') return 0;
    const roll = dragonConfig.fire.rollMs, t = this.spitT;
    const out = t < roll ? t / roll : t < this.spitMs - roll ? 1 : (this.spitMs - t) / roll;
    return Math.max(0, Math.min(1, out)) * this.route.length;
  }

  /** Whether a circle at (x, y) with radius `r` touches the fire. */
  touches(x: number, y: number, r: number): boolean {
    const reach = this.reach;
    return reach > 0 && this.route.distanceTo(x, y, reach) < r + dragonConfig.fire.halfThickness;
  }

  /** Spit now, if it's resting. */
  spitNow() {
    if (this.phase === 'resting') this.phaseMs = 0;
  }

  step(stepMs: number) {
    this.fire.step(stepMs);
    this.phaseMs -= stepMs;
    if (this.phase === 'resting') this.stepFidget(stepMs);
    if (this.phase === 'spitting') {
      this.spitT += stepMs;
      this.stepShake(stepMs);
    }
    if (this.phaseMs > 0) return;
    switch (this.phase) {
      case 'resting':
        this.enter('opening', animMs('open'));
        this.fidget = 'idle';
        break;
      case 'opening':
        this.enter('spitting', this.spitMs);
        this.spitT = 0;
        break;
      case 'spitting':
        this.enter('closing', animMs('close'));
        this.shake = { x: 0, y: 0, ms: 0 };
        break;
      case 'closing':
        this.enter('resting', this.nextSpitDelay());
        this.fidgetMs = randomWait();
        break;
    }
  }

  sync() {
    const anim: Record<DragonPhase, DragonAnim> = { resting: this.fidget, opening: 'open', spitting: 'spit', closing: 'close' };
    this.sprite.play(anim[this.phase]);
    this.sprite.position.set(this.def.x + this.shake.x, this.def.y + this.shake.y);
    this.fire.reach = this.reach;
    this.fire.sync();
  }

  private enter(phase: DragonPhase, ms: number) {
    this.phase = phase;
    this.phaseMs = ms;
  }

  /** ms until the next spit: around `throwDelay`, never (Infinity) when it's 0 */
  private nextSpitDelay() {
    if (this.def.throwDelay <= 0) return Infinity;
    const ms = this.def.throwDelay * 1000, spread = dragonConfig.intervalSpread;
    return ms * (1 - spread + Math.random() * 2 * spread);
  }

  private stepFidget(stepMs: number) {
    this.fidgetMs -= stepMs;
    if (this.fidgetMs > 0) return;
    const f = dragonConfig.fidget;
    if (this.fidget !== 'idle') {
      this.fidget = 'idle';
      this.fidgetMs = randomWait();
      return;
    }
    const r = Math.random();
    this.fidget = r < f.tailChance ? 'tail' : r < f.tailChance + f.smokeChance ? 'smoke' : 'blink';
    this.fidgetMs = { tail: f.tailMs, smoke: f.smokeMs, blink: f.blinkMs }[this.fidget as 'tail' | 'smoke' | 'blink'];
  }

  private stepShake(stepMs: number) {
    this.shake.ms -= stepMs;
    if (this.shake.ms > 0) return;
    const { px, ms } = dragonConfig.shake;
    this.shake = { x: (Math.random() * 2 - 1) * px, y: (Math.random() * 2 - 1) * px * 0.6, ms };
  }
}

/** how long a non-looping animation takes (ms) */
const animMs = (name: DragonAnim) => {
  const a = dragonDef.animations[name];
  return (a.frames.length / a.fps) * 1000;
};

const randomWait = () => {
  const f = dragonConfig.fidget;
  return f.minWaitMs + Math.random() * (f.maxWaitMs - f.minWaitMs);
};
