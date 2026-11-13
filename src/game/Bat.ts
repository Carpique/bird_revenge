import { batDef, batHitbox, batRadius, homingBatDef } from '../characters/bat';
import { config, WORLD } from '../config';
import type { BatDef } from '../level/types';
import { CharacterSprite } from '../render/CharacterSprite';
import type { HomingField } from './homing';
import { Bodies, Body, type MBody } from './physics';

type State = 'flying' | 'hit' | 'falling' | 'gone';
type BatAnim = keyof typeof batDef.animations;

/** where its poo leaves it: below its centre */
const POO_DY = 18;
/** how far it leans (radians) per px per step of sideways speed, and at most */
const LEAN = 0.04, MAX_LEAN = 0.3;

const randomBetween = (lo: number, hi: number) => lo + Math.random() * Math.max(0, hi - lo);

/** Whether going from `from` to `to` keeps out of the fire, or (already in it) at least goes no deeper. */
const outOfFire = (fireGap: FireGap, from: { x: number; y: number }, to: { x: number; y: number }) => {
  const gap = fireGap(to);
  return gap >= 0 || gap >= fireGap(from);
};

/** What a homing bat steers by: the way to the bird, where the other flying bats are, and whether it can see the bird. */
export interface Homing {
  field: HomingField;
  others: { x: number; y: number }[];
  /** nothing static between it and the bird, centre to centre (see `inSight`) */
  seesBird: boolean;
}

/** How far a bat at a point is from a dragon's fire, edge to edge (px); below 0: in it (see `Dragon.gap`). */
export type FireGap = (p: { x: number; y: number }) => number;

/**
 * Flies along its route at a steady speed, from its start: there and back again along an open polyline,
 * round and round a closed one. Every `pooDelay` seconds or so (± `bat.intervalSpread`) it poos straight down,
 * wherever it is; its poo hurts only the bird (see Game).
 * A bat without a route homes in on the bird instead, at the same steady speed, once it has seen it (nothing static in
 * between): round the level's bodies (see `HomingField`), keeping apart from the other bats, turning smoothly; till then it
 * flutters about where it started.
 * Hit by the bird's poo, it hangs in the air for a moment in its "hit" pose, then tumbles off the bottom of the screen,
 * gone for good. Touching a flying bat costs the bird a life, as a walking villain does.
 * A dragon's fire is a wall to it while it's out: one on a route turns back at it (one going round a closed route
 * hangs there till it's gone), a homing one slides along it, or stops.
 */
export class Bat {
  readonly body: MBody;
  /** a homing bat is dark purple, a route-flying one dusky grey */
  readonly view: CharacterSprite<BatAnim>;
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
  /** a homing bat's velocity (px per step) */
  private v = { x: 0, y: 0 };
  /** a homing bat has seen the bird, and goes for it from then on */
  private spotted = false;
  /** a homing bat's clock (s), for its wander */
  private age = 0;
  /** its own wander: two swings of their own speed (times `homingWanderHz`), from their own phase, and how much of each */
  private wander = [
    { f: randomBetween(0.7, 1.3), phase: randomBetween(0, 2 * Math.PI), weight: 0.65 },
    { f: randomBetween(1.9, 3.1), phase: randomBetween(0, 2 * Math.PI), weight: 0.35 },
  ];

  constructor(private def: BatDef) {
    this.view = new CharacterSprite<BatAnim>(def.route.length ? batDef : homingBatDef);
    [this.x, this.y] = def.start;
    this.target = def.target;
    this.pooIn = this.nextPooDelay();
    const { width, height } = batHitbox;
    this.body = Bodies.rectangle(this.x, this.y, width, height, {
      label: 'bat',
      isStatic: true,
      isSensor: true,
      chamfer: { radius: height / 2 },
    });
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

  /** how far it leans (radians) with its sideways speed */
  private get lean() {
    return Math.max(-MAX_LEAN, Math.min(this.vx * LEAN, MAX_LEAN));
  }

  /** no route: it homes in on the bird */
  get homing() {
    return this.def.route.length === 0;
  }

  /** a homing bat that has seen the bird, and is after it */
  get chasing() {
    return this.spotted;
  }

  /** where it is: its centre */
  get position() {
    return { x: this.x, y: this.y };
  }

  /** `homing`: what a homing bat steers by; without it, one hangs where it is. `fireGap`: the dragons' fire to keep out of. */
  step(stepMs: number, homing?: Homing, fireGap?: FireGap) {
    if (this.frozen && this.state === 'flying') return;
    this.timer += stepMs;
    switch (this.state) {
      case 'flying': {
        const x0 = this.x;
        this.age += stepMs / 1000;
        if (this.homing) this.home(this.def.speed, homing, fireGap);
        else this.flyClearOf(fireGap);
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
    // the wide hitbox leans with the wings
    if (this.state === 'flying') Body.setAngle(this.body, this.lean);
  }

  sync() {
    this.view.visible = this.state !== 'gone';
    this.view.position.set(this.x, this.y);
    if (this.state === 'flying') this.view.rotation = this.lean;
    if (this.frozen && this.state === 'flying') this.view.anim.stop();
    else this.view.play(this.state === 'flying' ? 'fly' : 'hit');
  }

  /** Moves along the route, unless that takes it into the fire: then it turns back (or, on a closed route, waits). */
  private flyClearOf(fireGap: FireGap | undefined) {
    const before = { x: this.x, y: this.y, target: this.target, dir: this.dir };
    this.fly(this.def.speed);
    if (!fireGap || outOfFire(fireGap, before, this.position)) return;
    ({ x: this.x, y: this.y, target: this.target, dir: this.dir } = before);
    this.turnBack();
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

  /**
   * Flies `speed` px (at most) towards the bird, the way the field shows, away from bats too close; turning a share of the
   * way at a time, so it swerves rather than jerks. Its heading swings either way of the bird's, smoothly and unevenly,
   * so its path curves the way a bat's does, and no two bats fly alike. Before it has seen the bird it loops about where
   * it started instead. Its wings never go into a body: blocked, it slides along it, or stops.
   */
  private home(speed: number, homing: Homing | undefined, fireGap: FireGap | undefined) {
    const { homingSeparation: separation, homingSeparationWeight: separationWeight, homingTurn: turn, homingWander, homingWanderHz, homingIdleRadius } = config.bat;
    if (homing?.seesBird) this.spotted = true;
    const swing = this.wander.reduce((a, w) => a + w.weight * Math.sin(2 * Math.PI * homingWanderHz * w.f * this.age + w.phase), 0);
    let wx = 0, wy = 0;
    if (this.spotted) {
      const way = homing?.field.way(this.position) ?? null;
      if (way) {
        const a = homingWander * swing, cos = Math.cos(a), sin = Math.sin(a);
        wx = way.x * cos - way.y * sin;
        wy = way.x * sin + way.y * cos;
      }
    } else {
      // a heading going slowly round, unevenly, and a pull back to the start growing with the distance: loops about it
      const a = this.wander[0].phase + 2 * Math.PI * homingWanderHz * this.age + homingWander * swing;
      const [sx, sy] = this.def.start;
      const r = Math.max(homingIdleRadius, 1);
      wx = Math.cos(a) + (sx - this.x) / r;
      wy = Math.sin(a) + (sy - this.y) / r;
    }
    for (const o of homing?.others ?? []) {
      const dx = this.x - o.x, dy = this.y - o.y, d = Math.hypot(dx, dy);
      if (d >= separation) continue;
      // right on top of each other: apart sideways, any way
      const [ux, uy] = d > 1e-6 ? [dx / d, dy / d] : [1, 0];
      const push = (separationWeight * (separation - d)) / separation;
      wx += ux * push;
      wy += uy * push;
    }
    const len = Math.hypot(wx, wy);
    const want = len > 1e-6 ? { x: (wx / len) * speed, y: (wy / len) * speed } : { x: 0, y: 0 };
    this.v.x += (want.x - this.v.x) * turn;
    this.v.y += (want.y - this.v.y) * turn;
    const v = Math.hypot(this.v.x, this.v.y);
    if (v > speed) {
      this.v.x *= speed / v;
      this.v.y *= speed / v;
    }
    const field = homing?.field;
    // one already in something (a body moved onto it, or it started there) may move only so as not to go in deeper
    const now = field?.overlap(this.position) ?? 0;
    const free = (x: number, y: number) =>
      (!field || field.overlap({ x, y }) <= now) && (!fireGap || outOfFire(fireGap, this.position, { x, y }));
    const nx = this.x + this.v.x, ny = this.y + this.v.y;
    if (free(nx, ny)) [this.x, this.y] = [nx, ny];
    else if (free(nx, this.y)) [this.x, this.v.y] = [nx, 0];
    else if (free(this.x, ny)) [this.y, this.v.x] = [ny, 0];
    else this.v = { x: 0, y: 0 };
  }

  /** Turns round on an open route, to fly back the way it came (towards the point it last passed). */
  turnBack() {
    if (this.def.loop || this.homing) return;
    this.dir = this.dir > 0 ? -1 : 1;
    this.target = Math.max(0, Math.min(this.target + this.dir, this.def.route.length - 1));
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
