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
 * A dragon: it never moves and can't be hurt (it's outside the physics world, and poos pass it by); `initialDelay` s
 * into the level, then exactly `throwDelay` s after its fire is back in, it spits fire along its route (`fireRoute`), up to the first wall, terrain, crate, villain or bat in the way. The bird touching the fire loses a life (`touches`);
 * villains and bats keep out of it as out of a wall (`gap`, `spansInBand`).
 * Its timing is fixed, not random, and nothing else in the game changes it, so a player can learn its pattern.
 * Its view holds the dragon and, in world coordinates, its fire.
 */
export class Dragon {
  readonly view = new Container();
  readonly route: FirePath;
  phase: DragonPhase = 'resting';
  /** called as the fire starts rolling out */
  onSpit: () => void = () => {};
  private readonly sprite: CharacterSprite<DragonAnim>;
  private readonly fire: FireStream;
  /** ms left in the current phase (opening, spitting, closing) */
  private phaseMs = 0;
  /**
   * ms until the next spit starts (the jaw opening): `initialDelay` at the start, then exactly `throwDelay` from when the
   * fire is fully back in (counting on while the jaw closes); never (Infinity) with a `throwDelay` of 0
   */
  private spitIn: number;
  /** ms since the spit began */
  private spitT = 0;
  /** how far along its route the fire can go before something blocks it (px) */
  private clear: number;
  /** how far along its route the fire is out (px): it rolls out no faster than `rollMs` allows, also past a blocker gone */
  private shown = 0;
  private fidget: DragonAnim = 'idle';
  /** ms until the current fidget (or the wait for the next one) ends */
  private fidgetMs = randomWait();
  private shake = { x: 0, y: 0, ms: 0 };

  constructor(readonly def: DragonDef) {
    this.spitIn = def.throwDelay > 0 ? def.initialDelay * 1000 : Infinity;
    this.route = fireRoute(def);
    this.clear = this.route.length;
    this.sprite = new CharacterSprite<DragonAnim>(dragonDef);
    this.sprite.setFacing(def.facing);
    this.fire = new FireStream(this.route);
    this.view.addChild(this.sprite, this.fire);
  }

  /** ms the whole spit takes: rolling out, staying out, rolling back */
  get spitMs() {
    return 2 * dragonConfig.fire.rollMs + this.def.flameDuration * 1000;
  }

  /** How far the fire has rolled out, 0–1 (1: all the way, though the level may block it short of that); 0: none. */
  get out(): number {
    if (this.phase !== 'spitting') return 0;
    const roll = dragonConfig.fire.rollMs, t = this.spitT;
    const out = t < roll ? t / roll : t < this.spitMs - roll ? 1 : (this.spitMs - t) / roll;
    return Math.max(0, Math.min(1, out));
  }

  /** How far along its route the fire is out (px), stopping where something blocks it; 0: none. */
  get reach(): number {
    return this.phase === 'spitting' ? this.shown : 0;
  }

  /** whether something stops the fire where it is now */
  private get blocked() {
    const reach = this.reach;
    return reach > 0 && reach >= this.clear && this.clear < this.route.length;
  }

  /**
   * How far along its route the fire burns (px); 0: nowhere. Short of `reach` by `hitTrim` of its thin tail and
   * `halfThickness` (all of them: the burning part, `halfThickness` round it, ends where the tail starts).
   */
  get burnReach(): number {
    const f = dragonConfig.fire;
    const tail = (this.blocked ? f.blockedTaperOver : f.taperOver) * f.tailShare;
    return Math.max(0, this.reach - f.hitTrim * (tail + f.halfThickness));
  }

  /** Whether a circle at (x, y) with radius `r` touches the fire. */
  touches(x: number, y: number, r: number): boolean {
    const burn = this.burnReach;
    return burn > 0 && this.route.distanceTo(x, y, burn) < r + dragonConfig.fire.halfThickness;
  }

  /** How far a circle at (x, y) with radius `r` is from the fire, edge to edge (px); below 0: in it; Infinity: no fire out. */
  gap(x: number, y: number, r: number): number {
    const reach = this.reach;
    return reach > 0 ? this.route.distanceTo(x, y, reach) - r - dragonConfig.fire.halfThickness : Infinity;
  }

  /** The x ranges the fire covers between heights `top` and `bottom`, thickness and all: what a villain won't walk into. */
  spansInBand(top: number, bottom: number): { x0: number; x1: number }[] {
    const reach = this.reach;
    return reach > 0 ? this.route.spansInBand(reach, top, bottom, dragonConfig.fire.halfThickness) : [];
  }

  /** Spit now, if it's resting. */
  spitNow() {
    if (this.phase === 'resting') this.spitIn = 0;
  }

  /**
   * `blocked`: whether a point is inside something that stops the fire (walls, terrain, crates, villains, bats).
   * Checked while it spits, as doors open, crates and characters move.
   */
  step(stepMs: number, blocked?: (x: number, y: number) => boolean) {
    this.fire.step(stepMs);
    if (this.phase === 'resting' || this.phase === 'closing') this.spitIn -= stepMs;
    if (this.phase === 'resting') {
      this.stepFidget(stepMs);
      if (this.spitIn <= 0) {
        this.enter('opening', animMs('open'));
        this.fidget = 'idle';
      }
      return;
    }
    this.phaseMs -= stepMs;
    if (this.phase === 'spitting') {
      this.spitT += stepMs;
      this.stepShake(stepMs);
      this.clear = blocked ? this.route.clearLength(blocked) : this.route.length;
      const len = this.route.length;
      this.shown = Math.min(this.clear, this.out * len, this.shown + (len * stepMs) / dragonConfig.fire.rollMs);
    }
    if (this.phaseMs > 0) return;
    switch (this.phase) {
      case 'opening':
        this.enter('spitting', this.spitMs);
        this.spitT = 0;
        this.shown = 0;
        this.onSpit();
        break;
      case 'spitting':
        // the fire is fully back in: the wait for the next spit starts now
        this.spitIn = this.nextSpitDelay();
        this.enter('closing', animMs('close'));
        this.shake = { x: 0, y: 0, ms: 0 };
        break;
      case 'closing':
        this.enter('resting', 0);
        this.fidgetMs = randomWait();
        break;
    }
  }

  sync() {
    const anim: Record<DragonPhase, DragonAnim> = { resting: this.fidget, opening: 'open', spitting: 'spit', closing: 'close' };
    this.sprite.play(anim[this.phase]);
    this.sprite.position.set(this.def.x + this.shake.x, this.def.y + this.shake.y);
    this.fire.reach = this.reach;
    this.fire.blocked = this.blocked;
    this.fire.sync();
  }

  private enter(phase: DragonPhase, ms: number) {
    this.phase = phase;
    this.phaseMs = ms;
  }

  /** ms from the fire being back in to the next spit: exactly `throwDelay`, never (Infinity) when it's 0 */
  private nextSpitDelay() {
    return this.def.throwDelay > 0 ? this.def.throwDelay * 1000 : Infinity;
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
