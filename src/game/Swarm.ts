import { CanvasSource, Container, Sprite, Texture } from 'pixi.js';
import { Smoke } from '../render/Smoke';
import { splatHalfWidth } from '../characters/poo';
import { config } from '../config';
import type { SwarmDef } from '../level/types';
import { HomingField } from './homing';
import { outOfFire, type FireGap } from './Bat';
import { Bodies, Body, CRATE, Query, SWARM, type MBody } from './physics';

type Point = { x: number; y: number };

/** A poo of the bird's the swarm may go for: falling (it chases it) or lying (it feeds on it). `id`: which poo it is. */
export interface SwarmPoo {
  id: object;
  x: number;
  y: number;
  lying: boolean;
}

/** What a swarm steers by, each step. */
export interface SwarmSenses {
  /** the level's bodies (terrain, crates, closed doors): what it finds its way round */
  bodies: MBody[];
  /** where the bird is; null: none to go for (dying) */
  bird: Point | null;
  /** nothing of the level's between its centre and the bird (see `inSight`) */
  seesBird: boolean;
  /** the bird's poos, falling or lying */
  poos: SwarmPoo[];
  /** is there anything at a point: the level's bodies, the ground, beyond the level's edges */
  solid: (x: number, y: number) => boolean;
  /** the dragons' fire, a wall to it */
  fireGap?: FireGap;
}

/** how far (px) apart the free-space probes step */
const PROBE_STEP = 3;
/** how many points round its squeezed outline are tested for room, besides its centre */
const FIT_POINTS = 10;
/** where it feels for a moving body: rings round its centre (share of `shoveReach`, points round it), and its centre */
/** holding, it counts a body as resting on it this near (px) its `body` */
const HOLD_SLACK = 4;
const FEEL_RINGS: [number, number][] = [[1, 16], [0.66, 12], [0.33, 8], [0, 1]];

const randomBetween = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
/** about normally distributed, mean 0, standard deviation 1 (Irwin–Hall, 3 terms): cheap */
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 2;

/**
 * A fly swarm: a cloud of `config.swarm.flyCount` tiny flies, `diameter` across. It can't be killed: poos go
 * straight through it. Touching any of its flies costs the bird a life.
 *
 * A body moving at it (a crate falling or tumbling) shoves it aside: it gets out of the way at once, as fast as the body
 * comes on, and stops as soon as nothing's pushing (no drift on). Pinned (a wall behind it) it slips out sideways; with
 * nowhere at all to go it holds: its `body` turns solid to crates, and they come to rest on it as on anything fixed.
 * It stays put while anything rests on it, and goes its way again once nothing does.
 *
 * The swarm as a whole is a point (its centre) that steers like a homing bat, only more erratically: it drifts about
 * where it started till it sees the bird (nothing of the level's in between), then goes for it round the level's bodies,
 * its heading swinging either way and jolted at random. When the bird dies it loses it: it finds its way back to
 * where it started (round the level's bodies) and drifts there again till it sees the bird anew. Once it has seen the bird (not before: till then it ignores them),
 * a poo of the bird's (falling or lying, within `pooRange`) draws it off: it chases the nearest one and, once it lies somewhere, settles on it and feeds till it's gone; then it goes back
 * to the bird.
 *
 * Each fly is a particle in a harmonic well round the swarm's centre, damped and kicked at random (the standard midge
 * swarm model: Okubo 1986, Kelley & Ouellette 2013), and never leaves the swarm's oval. Feeding, the flies dart up and
 * down over the poo instead, faster, each on its own.
 *
 * It needs room: a gap at least `minScale` of its diameter each way. In a narrower space than its diameter it squeezes
 * to fit (its oval narrower or flatter, shifted to fit between what's either side), so its flies crowd closer; a gap
 * narrower than that it doesn't squeeze for at all. Caught in something (a swinging beam swung into it), it may only
 * back out of it, never on through it.
 *
 * A dragon's fire is a wall to it while it's out, as to a homing bat: it slides along it, or stops; one caught in it
 * may move only so as not to go in deeper. But fire that comes at it (spat at it, or rolling out over it) burns it
 * once it reaches its core (`burnCore` of its radius): its flies fade away and it smokes (a poo's smoke, bigger and
 * slower), gone for good (see `burnt`).
 */
export class Swarm {
  /** the flies, drawn as dots (and their glow) */
  readonly view = new Container();
  /**
   * What crates rest on while it holds (pinned, with nowhere to go): a fixed block of its squeezed size, in the physics
   * world (the game adds it), solid to crates only then and to nothing else ever.
   */
  readonly body: MBody;
  /** pinned with nowhere to go: it stays put, its `body` solid to crates, while anything rests on it */
  private holding = false;
  /** hangs where it is (the level is won); its flies still buzz about */
  frozen = false;
  /** ms since the fire burnt it; null: not burnt */
  private burnT: number | null = null;
  /** its smoke while it burns away */
  private smoke: Smoke | null = null;
  /** the flies' dots, and the two rings of their glow (a faint wide halo and a stronger one close in): a sprite per fly in each, moved each frame */
  private dots = new Container();
  private glow = new Container();
  private glowOuter = new Container();
  private glowInner = new Container();
  /** glowing flies (evening, night) or dark ones (morning, afternoon) */
  private night = false;
  /** its centre: what steers */
  private x: number;
  private y: number;
  /** its centre's velocity (px per step) */
  private v = { x: 0, y: 0 };
  /** a moving body's shove (px per step), on top of its own flying; dies away fast once nothing's pushing */
  private push = { x: 0, y: 0 };
  /** half its size each way now, and its oval's offset from the centre (squeezed into a gap off to one side) */
  private rx: number;
  private ry: number;
  private ox = 0;
  private oy = 0;
  /** the flies: positions and velocities, and which way each darts while feeding (1 down to the poo, -1 up) */
  private fx: Float32Array;
  private fy: Float32Array;
  private fvx: Float32Array;
  private fvy: Float32Array;
  private dart: Int8Array;
  /** has seen the bird, and goes for it from then on (unless a poo draws it off) */
  private spotted = false;
  /** the poo it's going for, and where; null: none */
  private poo: SwarmPoo | null = null;
  /** settled on a lying poo, feeding */
  private feeding = false;
  /** the way to its target, round the level's bodies */
  private field: HomingField;
  private replanIn = 0;
  /** what the field leads to: the bird, a poo, nothing */
  private fieldTarget: object | null = null;
  /** its clock (s), for its wander */
  private age = 0;
  private wanderSeed = [
    { f: randomBetween(0.7, 1.3), phase: randomBetween(0, 2 * Math.PI), weight: 0.6 },
    { f: randomBetween(2.1, 3.4), phase: randomBetween(0, 2 * Math.PI), weight: 0.4 },
  ];

  /** `levelWidth`: for its way-finding grid */
  constructor(private def: SwarmDef, levelWidth: number) {
    const s = config.swarm;
    this.x = def.x;
    this.y = def.y;
    this.rx = this.ry = this.radius;
    const n = Math.max(0, Math.round(s.flyCount));
    this.fx = new Float32Array(n);
    this.fy = new Float32Array(n);
    this.fvx = new Float32Array(n);
    this.fvy = new Float32Array(n);
    this.dart = new Int8Array(n);
    for (let i = 0; i < n; i++) {
      // evenly over its disc
      const a = Math.random() * 2 * Math.PI, r = Math.sqrt(Math.random()) * this.radius * 0.8;
      this.fx[i] = this.x + Math.cos(a) * r;
      this.fy[i] = this.y + Math.sin(a) * r;
      this.dart[i] = Math.random() < 0.5 ? 1 : -1;
    }
    const min = this.minRadius;
    this.field = new HomingField(levelWidth, { outline: { halfWidth: min, halfHeight: min }, clearance: s.clearance, cell: s.cell });
    this.glow.addChild(this.glowOuter, this.glowInner);
    this.view.addChild(this.glow, this.dots);
    // square, its corners rounded: flat on top, so what comes to rest on it stays there as on a crate
    this.body = Bodies.rectangle(this.x, this.y, 2 * min, 2 * min, {
      isStatic: true,
      label: 'swarm',
      chamfer: { radius: min * 0.3 },
      collisionFilter: { category: SWARM, mask: 0 },
    });
  }

  /** its radius at rest (px) */
  get radius() {
    return config.swarm.diameter / 2;
  }

  /** its radius squeezed as far as it goes (px): the narrowest gap it gets through is twice this */
  get minRadius() {
    return this.radius * Math.min(1, Math.max(0.05, config.swarm.minScale));
  }

  /** its centre */
  get position(): Point {
    return { x: this.x, y: this.y };
  }

  /** has seen the bird, and goes for it (unless a poo draws it off) */
  get chasing() {
    return this.spotted;
  }

  /** pinned with nowhere to go, holding up what's coming at it */
  get isHolding() {
    return this.holding;
  }

  /** settled on a poo, feeding */
  get isFeeding() {
    return this.feeding;
  }

  /** going for a poo (falling or lying) */
  get afterPoo() {
    return this.poo !== null;
  }

  /** which poo it's going for (its `SwarmPoo.id`), or null */
  get pooId(): object | null {
    return this.poo?.id ?? null;
  }

  /** where it started */
  get start(): Point {
    return { x: this.def.x, y: this.def.y };
  }

  /** its oval now: centre and half-size each way (squeezed in a gap) */
  get outline() {
    return { x: this.x + this.ox, y: this.y + this.oy, rx: this.rx, ry: this.ry };
  }

  /** Bright flies with a pale glow (dusk, night) or dark ones with a gold glow (day). */
  setNight(night: boolean) {
    this.night = night;
  }

  /** Does a circle (the bird) touch any of its flies? */
  touches(cx: number, cy: number, r: number): boolean {
    if (this.burnT !== null) return false;
    const o = this.outline;
    // nowhere near its oval: no fly can be touching
    if (Math.abs(cx - o.x) > o.rx + r || Math.abs(cy - o.y) > o.ry + r) return false;
    const d = r + config.swarm.flySize / 2, d2 = d * d;
    for (let i = 0; i < this.fx.length; i++) if ((this.fx[i] - cx) ** 2 + (this.fy[i] - cy) ** 2 < d2) return true;
    return false;
  }

  /** burnt by a dragon's fire, smoking away */
  get burning() {
    return this.burnT !== null;
  }

  /** burnt, and its smoke gone: the game removes it */
  get burnt() {
    return this.burnT !== null && this.burnT >= Math.max(config.evaporate.shrinkMs * config.swarm.burnSlow, this.smoke?.ms ?? 0);
  }

  /** the circle round its centre that a dragon's fire burns it by touching (px) */
  get coreRadius() {
    return this.radius * config.swarm.burnCore;
  }

  /** Caught by a dragon's fire: its flies fade away where they are and it smokes. */
  burn() {
    if (this.burnT !== null) return;
    const s = config.swarm;
    this.burnT = 0;
    this.poo = null;
    this.feeding = false;
    this.hold(false);
    this.smoke = new Smoke(0, { outline: false, slow: s.burnSlow });
    this.smoke.scale.set(s.burnSmokeScale);
    this.smoke.position.set(this.x, this.y);
    this.view.addChild(this.smoke);
  }

  step(stepMs: number, senses: SwarmSenses) {
    if (this.burnT !== null) {
      this.burnT += stepMs;
      if (this.smoke) this.smoke.t = this.burnT;
      return;
    }
    this.age += stepMs / 1000;
    // the bird dying: it loses it, and heads back to where it started till it sees the bird again
    if (!senses.bird) this.spotted = false;
    if (senses.seesBird) this.spotted = true;
    // on standby till it has seen the bird: poos don't draw it yet
    this.choosePoo(this.spotted ? senses.poos : []);
    if (!this.frozen) {
      this.replan(stepMs, senses);
      this.steer(senses);
    }
    this.fitShape(senses.solid);
    this.stepFlies(senses.solid);
  }

  /** Keeps to the poo it's after while it lasts; else (or when one comes into range) goes for the nearest one. */
  private choosePoo(poos: SwarmPoo[]) {
    const current = this.poo && poos.find((p) => p.id === this.poo!.id);
    if (current) {
      this.poo = current;
      return;
    }
    this.feeding = false;
    const range = config.swarm.pooRange;
    let best: SwarmPoo | null = null, bestD = range * range;
    for (const p of poos) {
      const d = (p.x - this.x) ** 2 + (p.y - this.y) ** 2;
      if (d <= bestD) (best = p), (bestD = d);
    }
    this.poo = best;
  }

  /** where it feeds on a lying poo: its centre a little above it, so the flies diving reach it */
  private feedPoint(p: SwarmPoo): Point {
    return { x: p.x, y: p.y - this.minRadius - 2 };
  }

  /** away from where it started (beyond its drift round it): it heads back there */
  private get awayFromStart() {
    const r = Math.max(config.swarm.idleRadius, 1) * 2;
    return (this.x - this.def.x) ** 2 + (this.y - this.def.y) ** 2 > r * r;
  }

  /** where it's heading: a poo (where it feeds, once it lies), the bird once spotted, else back to where it started */
  private target(senses: SwarmSenses): { id: object; at: Point } | null {
    if (this.poo) return { id: this.poo.id, at: this.poo.lying ? this.feedPoint(this.poo) : this.poo };
    if (this.spotted && senses.bird) return { id: this, at: senses.bird };
    if (!this.spotted) return { id: this.def, at: this.start };
    return null;
  }

  /**
   * Works the way to its target out again every `replanMs` (give or take a fifth, at random, so the swarms of a level
   * don't all do it in the same frame: it's the costliest thing they do), or at once when the target changes.
   */
  private replan(stepMs: number, senses: SwarmSenses) {
    const t = this.target(senses);
    this.replanIn -= stepMs;
    if (this.replanIn > 0 && (t?.id ?? null) === this.fieldTarget) return;
    this.replanIn = config.swarm.replanMs * randomBetween(0.8, 1.2);
    this.fieldTarget = t?.id ?? null;
    this.field.update(senses.bodies, t?.at ?? null);
  }

  /** Moves its centre: towards its target round obstacles, wandering and lurching; feeding, it hovers over the poo. */
  private steer(senses: SwarmSenses) {
    const s = config.swarm;
    if (this.holding) {
      if (this.weighedDown(senses.bodies)) {
        this.v = { x: 0, y: 0 };
        this.push = { x: 0, y: 0 };
        return;
      }
      this.hold(false);
    }
    const swing = this.wanderSeed.reduce((a, w) => a + w.weight * Math.sin(2 * Math.PI * s.wanderHz * w.f * this.age + w.phase), 0);
    let wx = 0, wy = 0, speed = s.chaseSpeed;
    const poo = this.poo;
    if (poo?.lying) {
      const f = this.feedPoint(poo);
      const d = Math.hypot(f.x - this.x, f.y - this.y);
      if (d <= s.feedReach) this.feeding = true;
      speed = s.pooSpeed;
      if (this.feeding) {
        // hovering over it: drawn back to it, gently, with a little restlessness
        wx = (f.x - this.x) / s.feedReach;
        wy = (f.y - this.y) / s.feedReach;
        speed = Math.min(s.pooSpeed, d * 0.15) + 0.2;
      } else {
        [wx, wy] = this.wayTo(f, swing * 0.5);
      }
    } else if (poo) {
      speed = s.pooSpeed;
      [wx, wy] = this.wayTo(poo, swing * 0.5);
    } else if (this.spotted && senses.bird) {
      [wx, wy] = this.wayTo(senses.bird, swing);
    } else if (!this.spotted && this.awayFromStart) {
      // lost the bird (it died): back to where it started, round the level's bodies
      speed = s.homeSpeed;
      [wx, wy] = this.wayTo(this.start, swing * 0.5);
    } else {
      // drifting slowly round about where it started
      const a = this.wanderSeed[0].phase + 2 * Math.PI * s.wanderHz * 0.5 * this.age + s.wander * swing;
      const r = Math.max(s.idleRadius, 1);
      wx = Math.cos(a) * 0.5 + (this.spotted ? 0 : (this.def.x - this.x) / r);
      wy = Math.sin(a) * 0.5 + (this.spotted ? 0 : (this.def.y - this.y) / r);
      speed = s.chaseSpeed * 0.2;
    }
    const len = Math.hypot(wx, wy);
    const want = len > 1e-6 ? { x: (wx / len) * speed, y: (wy / len) * speed } : { x: 0, y: 0 };
    const turn = this.feeding ? s.turn * 2 : s.turn;
    this.v.x += (want.x - this.v.x) * turn + (Math.random() * 2 - 1) * s.jitter;
    this.v.y += (want.y - this.v.y) * turn + (Math.random() * 2 - 1) * s.jitter;
    const v = Math.hypot(this.v.x, this.v.y), top = speed * 1.25;
    if (v > top) (this.v.x *= top / v), (this.v.y *= top / v);
    // a body coming at it: out of its way at once, its own flying into it given up; nothing: the shove dies away
    const shove = this.shoveFrom(senses.bodies);
    if (shove) {
      const { n, speed } = shove;
      this.push = { x: n.x * speed, y: n.y * speed };
      const into = this.v.x * n.x + this.v.y * n.y;
      if (into < 0) (this.v.x -= n.x * into), (this.v.y -= n.y * into);
    } else {
      this.push.x *= s.shoveDecay;
      this.push.y *= s.shoveDecay;
    }
    // never where it wouldn't fit, squeezed as far as it goes (the bodies shoving it aside aside); one already stuck may
    // move only to get out
    const ignore = shove?.by ?? [];
    // the fire, as for a bat: one already in it may move only so as not to go in deeper
    const now = this.overlap(this.x, this.y, senses, ignore);
    const free = (x: number, y: number) => this.easesOverlap(now, x, y, senses, ignore) && this.clearOfFire(x, y, senses);
    const x0 = this.x, y0 = this.y;
    const nx = this.x + this.v.x + this.push.x, ny = this.y + this.v.y + this.push.y;
    if (free(nx, ny)) [this.x, this.y] = [nx, ny];
    else if (free(nx, this.y)) [this.x, this.v.y] = [nx, 0];
    else if (free(this.x, ny)) [this.y, this.v.x] = [ny, 0];
    else this.v = { x: 0, y: 0 };
    if (shove) this.giveWay(shove, (this.x - x0) * shove.n.x + (this.y - y0) * shove.n.y, (x, y) => this.fits(x, y, senses) && this.clearOfFire(x, y, senses));
  }

  /**
   * The push of the moving bodies coming at it (within `shoveReach` of its centre now, or in `shoveLead` steps): the way
   * out (away from them), how fast it must go that way (as fast as they come on, more the deeper they're in), and who.
   */
  private shoveFrom(bodies: MBody[]): { by: MBody[]; n: Point; speed: number } | null {
    const s = config.swarm;
    const r = this.radius * s.shoveReach;
    const by: MBody[] = [];
    let px = 0, py = 0;
    for (const b of bodies) {
      if (b.isStatic) continue;
      const vb = b.velocity;
      if (Math.hypot(vb.x, vb.y) < s.shoveMinSpeed) continue;
      const lx = vb.x * s.shoveLead, ly = vb.y * s.shoveLead;
      // nowhere near, now or in `shoveLead` steps
      const bb = b.bounds;
      if (Math.min(bb.min.x, bb.min.x + lx) > this.x + r || Math.max(bb.max.x, bb.max.x + lx) < this.x - r) continue;
      if (Math.min(bb.min.y, bb.min.y + ly) > this.y + r || Math.max(bb.max.y, bb.max.y + ly) < this.y - r) continue;
      // where it is in it, or in its way: which side, and how far in
      let sx = 0, sy = 0, deepest = Infinity;
      for (const [k, count] of FEEL_RINGS) {
        for (let i = 0; i < count; i++) {
          const a = (i / count) * 2 * Math.PI, dx = Math.cos(a) * r * k, dy = Math.sin(a) * r * k;
          const x = this.x + dx, y = this.y + dy;
          if (!Query.point([b], { x, y }).length && !Query.point([b], { x: x - lx, y: y - ly }).length) continue;
          sx += dx;
          sy += dy;
          deepest = Math.min(deepest, k);
        }
      }
      if (deepest === Infinity) continue;
      // the way out: away from where it's touched (straight on: the way the body's going)
      const n = unit(-sx, -sy) ?? unit(vb.x, vb.y)!;
      const coming = vb.x * n.x + vb.y * n.y;
      if (coming <= 0) continue;
      const speed = coming * s.shoveOvershoot + s.shoveStiffness * r * (1.1 - deepest);
      px += n.x * speed;
      py += n.y * speed;
      by.push(b);
    }
    const n = unit(px, py);
    return n ? { by, n, speed: Math.hypot(px, py) } : null;
  }

  /**
   * Shoved but got less than half as far as it must out of the way (`got`, px): pinned. Out sideways if it can (towards
   * the nearer edge of what's pushing) to where it fits clear of everything, them too; else it holds (see `hold`).
   */
  private giveWay(shove: { by: MBody[]; n: Point; speed: number }, got: number, free: (x: number, y: number) => boolean) {
    const { n, speed } = shove;
    if (got >= speed * 0.5) return;
    // towards the nearer edge of what's pushing: the side it's off its middle, sideways to the push
    let ax = 0, ay = 0;
    for (const b of shove.by) (ax += this.x - b.position.x), (ay += this.y - b.position.y);
    const side = Math.sign(ay * n.x - ax * n.y) || (Math.random() < 0.5 ? 1 : -1);
    for (const k of [side, -side]) {
      const tx = -n.y * k * speed, ty = n.x * k * speed;
      if (free(this.x + tx, this.y + ty)) {
        this.x += tx;
        this.y += ty;
        this.push = { x: tx, y: ty };
        return;
      }
    }
    this.push = { x: 0, y: 0 };
    this.hold(true);
  }

  /** Is anything movable resting on its `body` (or pressing on it): within `HOLD_SLACK` of it? */
  private weighedDown(bodies: MBody[]) {
    const { min, max } = this.body.bounds, d = HOLD_SLACK;
    const near = { min: { x: min.x - d, y: min.y - d }, max: { x: max.x + d, y: max.y + d } };
    return bodies.some((b) => !b.isStatic && Query.region([b], near).length > 0);
  }

  /** Holds (its `body` where it is, solid to crates) or lets go (its `body` solid to nothing). */
  private hold(on: boolean) {
    this.holding = on;
    this.body.collisionFilter.mask = on ? CRATE : 0;
    if (on) Body.setPosition(this.body, { x: this.x, y: this.y });
  }

  /** The way towards `to` (a unit vector) round the level's bodies, its heading swung `swing` (× `wander`) either way. */
  private wayTo(to: Point, swing: number): [number, number] {
    const way = this.field.way(this.position) ?? unit(to.x - this.x, to.y - this.y);
    if (!way) return [0, 0];
    const a = config.swarm.wander * swing, cos = Math.cos(a), sin = Math.sin(a);
    return [way.x * cos - way.y * sin, way.x * sin + way.y * cos];
  }

  /**
   * Would it fit at (x, y), squeezed as far as it goes: nothing solid in its smallest circle (but for `ignore`: the
   * bodies shoving it aside)?
   */
  private fits(x: number, y: number, senses: SwarmSenses, ignore: MBody[] = []) {
    return this.overlap(x, y, senses, ignore).blocked === 0;
  }

  /**
   * How much of its smallest circle at (x, y) is in something solid (but for `ignore`): how many of its test points
   * (its centre and `FIT_POINTS` round it), and the way out (from those points towards the centre; zero: none, or only
   * the centre).
   */
  private overlap(x: number, y: number, senses: SwarmSenses, ignore: MBody[] = []) {
    const r = this.minRadius * 0.95;
    const solid = (px: number, py: number) => senses.solid(px, py) && !(ignore.length && Query.point(ignore, { x: px, y: py }).length);
    let blocked = solid(x, y) ? 1 : 0, ex = 0, ey = 0;
    for (let i = 0; i < FIT_POINTS; i++) {
      const a = (i / FIT_POINTS) * 2 * Math.PI, dx = Math.cos(a), dy = Math.sin(a);
      if (!solid(x + dx * r, y + dy * r)) continue;
      blocked++;
      ex -= dx;
      ey -= dy;
    }
    return { blocked, ex, ey };
  }

  /**
   * May it go from where it is (its overlap there: `now`) to (x, y)? Fitting now: only where it fits too. Already in
   * something (a swinging beam swung into it): only out of it, never deeper (no more of it in, nor any way into it),
   * so it can't slip through what it's caught in.
   */
  private easesOverlap(now: { blocked: number; ex: number; ey: number }, x: number, y: number, senses: SwarmSenses, ignore: MBody[]) {
    if (now.blocked === 0) return this.fits(x, y, senses, ignore);
    if ((x - this.x) * now.ex + (y - this.y) * now.ey < 0) return false;
    return this.overlap(x, y, senses, ignore).blocked <= now.blocked;
  }

  /** Does going to (x, y) keep it out of the dragons' fire, or (already in it) at least go no deeper, as for a bat? */
  private clearOfFire(x: number, y: number, senses: SwarmSenses) {
    return !senses.fireGap || outOfFire(senses.fireGap, this.position, { x, y });
  }

  /**
   * Its oval as the room round its centre allows: as big as it is at rest where there's room, squeezed (no further than
   * `minScale`) and shifted to fit between what's either side where there isn't. Squeezes fast, swells back slowly.
   */
  private fitShape(solid: (x: number, y: number) => boolean) {
    const R = this.radius, min = this.minRadius;
    const free = (dx: number, dy: number, ax: number, ay: number) => {
      let d = 0;
      while (d < R && !solid(this.x + ax + dx * (d + PROBE_STEP), this.y + ay + dy * (d + PROBE_STEP))) d += PROBE_STEP;
      return d;
    };
    // the room either way, along three lines across it, so it doesn't poke into a ledge just off its middle
    const band = (k: number) => [-k, 0, k];
    let left = R, right = R, up = R, down = R;
    for (const off of band(this.ry * 0.6)) {
      left = Math.min(left, free(-1, 0, 0, off));
      right = Math.min(right, free(1, 0, 0, off));
    }
    for (const off of band(this.rx * 0.6)) {
      up = Math.min(up, free(0, -1, off, 0));
      down = Math.min(down, free(0, 1, off, 0));
    }
    const fit = (neg: number, pos: number) => {
      // too narrow for it even squeezed as far as it goes (`minScale` of its full size): it doesn't squeeze for it
      // (it won't get through), but keeps its size, its flies just kept out of what's in the way
      if (neg + pos < 2 * min) return [R, 0];
      const half = Math.min(R, (neg + pos) / 2);
      // shifted off the centre only as far as it must be to keep clear of either side
      return [half, Math.min(Math.max(0, half - neg), pos - half)];
    };
    const [rx, ox] = fit(left, right), [ry, oy] = fit(up, down);
    const ease = (from: number, to: number) => from + (to - from) * (to < from ? 0.35 : 0.06);
    this.rx = ease(this.rx, rx);
    this.ry = ease(this.ry, ry);
    this.ox = ease(this.ox, ox);
    this.oy = ease(this.oy, oy);
  }

  /** Each fly: pulled to the centre, damped, kicked at random (feeding: darting up and down over the poo), kept in the oval and out of things. */
  private stepFlies(solid: (x: number, y: number) => boolean) {
    const s = config.swarm;
    const { x: cx, y: cy, rx, ry } = this.outline;
    const R = this.radius;
    // squeezed one way, the pull that way is stronger, so the flies crowd into the narrower oval
    const kx = s.flySpring * (R / rx) ** 2, ky = s.flySpring * (R / ry) ** 2;
    const g = s.flyDamping;
    const feed = this.feeding && this.poo ? this.poo : null;
    const maxV = feed ? s.flyMaxSpeed * 1.4 : s.flyMaxSpeed;
    const top = cy - ry * s.feedRise;
    // feeding, the sideways kicks and a pull to the poo such that the flies spread (one standard deviation) over
    // `feedSpread` splats' half-widths: a harmonic well's spread is noise / sqrt(2 · damping · pull)
    const feedSide = s.feedNoise * 0.6, spread = splatHalfWidth * s.feedSpread;
    const kFeed = (feedSide * feedSide) / (2 * g * spread * spread);
    for (let i = 0; i < this.fx.length; i++) {
      let x = this.fx[i], y = this.fy[i], vx = this.fvx[i], vy = this.fvy[i];
      let ax: number, ay: number;
      if (feed) {
        // over the poo, sideways spread about as wide as the patch it lies on...
        ax = -kFeed * (x - feed.x) - g * vx + feedSide * gauss();
        // ...diving to it and rising off it again, each fly in its own time, now and then turning back halfway
        if (this.dart[i] > 0 && y >= feed.y - 6) this.dart[i] = -1;
        else if (this.dart[i] < 0 && y <= top) this.dart[i] = 1;
        else if (Math.random() < 0.01) this.dart[i] = -this.dart[i];
        ay = this.dart[i] * s.feedDart - g * 0.5 * vy + s.feedNoise * gauss();
      } else {
        // the flies keep up with the swarm (mostly): damped against its velocity, not the air's
        ax = -kx * (x - cx) - g * (vx - 0.8 * this.v.x) + s.flyNoise * gauss();
        ay = -ky * (y - cy) - g * (vy - 0.8 * this.v.y) + s.flyNoise * gauss();
      }
      vx += ax;
      vy += ay;
      const v = Math.hypot(vx, vy);
      if (v > maxV) (vx *= maxV / v), (vy *= maxV / v);
      let nx = x + vx, ny = y + vy;
      // never out of the oval: back onto its edge, bouncing off it
      const ex = (nx - cx) / rx, ey = (ny - cy) / ry, e = ex * ex + ey * ey;
      if (e > 1) {
        const k = 1 / Math.sqrt(e);
        nx = cx + (nx - cx) * k;
        ny = cy + (ny - cy) * k;
        // the edge's outward normal there
        const gx = (nx - cx) / (rx * rx), gy = (ny - cy) / (ry * ry), gl = Math.hypot(gx, gy) || 1;
        const out = (vx * gx + vy * gy) / gl;
        if (out > 0) (vx -= (1.6 * out * gx) / gl), (vy -= (1.6 * out * gy) / gl);
      }
      // never into anything: it turns back; one caught in something (the swarm squeezing past it) is drawn out
      if (solid(nx, ny)) {
        if (solid(x, y)) (nx = x + (cx - x) * 0.3), (ny = y + (cy - y) * 0.3);
        else (nx = x), (ny = y);
        vx *= -0.5;
        vy *= -0.5;
      }
      this.fx[i] = nx;
      this.fy[i] = ny;
      this.fvx[i] = vx;
      this.fvy[i] = vy;
    }
  }

  sync() {
    const s = config.swarm;
    const size = s.flySize;
    const color = this.night ? s.nightColor : s.dayColor;
    if (this.burnT !== null) {
      // burning: the flies fade away where they are, the smoke rising
      const fade = Math.max(0, 1 - this.burnT / (config.evaporate.shrinkMs * s.burnSlow));
      this.glow.alpha = fade;
      this.dots.alpha = fade * (this.night ? 1 : 0.9);
      this.smoke?.sync();
      return;
    }
    const n = this.fx.length;
    if (!n) return;
    if (this.dots.children.length !== n) this.makeSprites(n);
    // the glow: a faint wide halo, and a stronger one close in, so it fades out rather than ending in a disc;
    // lit up against the dark at night, gold over the bright sky by day (like a coin's)
    const glowColor = this.night ? s.nightColor : s.dayGlowColor;
    this.glow.blendMode = this.night ? 'add' : 'normal';
    this.glowOuter.tint = this.glowInner.tint = glowColor;
    this.glowOuter.alpha = s.glowAlpha * 0.5;
    this.glowInner.alpha = s.glowAlpha;
    this.dots.tint = color;
    this.dots.alpha = this.night ? 1 : 0.9;
    const outer = (size * s.glowSize) / DISC_SIZE, inner = outer / 2;
    // by day little dark squares are crisper than circles at this size
    const dotTexture = this.night ? disc() : Texture.WHITE;
    const dot = size / dotTexture.width;
    const o = this.glowOuter.children, g = this.glowInner.children, d = this.dots.children as Sprite[];
    for (let i = 0; i < n; i++) {
      const x = this.fx[i], y = this.fy[i];
      o[i].position.set(x, y);
      o[i].scale.set(outer);
      g[i].position.set(x, y);
      g[i].scale.set(inner);
      if (d[i].texture !== dotTexture) d[i].texture = dotTexture;
      d[i].position.set(x, y);
      d[i].scale.set(dot);
    }
  }

  /** A sprite per fly in each of the glow's rings and in the dots, all centred on the fly. */
  private makeSprites(n: number) {
    for (const c of [this.glowOuter, this.glowInner, this.dots]) {
      c.removeChildren().forEach((sp) => sp.destroy());
      for (let i = 0; i < n; i++) c.addChild(new Sprite({ texture: c === this.dots ? Texture.WHITE : disc(), anchor: 0.5 }));
    }
  }

  destroy() {
    this.view.destroy({ children: true });
  }
}

/** size (px) of the disc texture the flies and their glow are drawn with */
const DISC_SIZE = 64;
let discTexture: Texture | undefined;
/** A white disc, smooth-edged, mipmapped so it stays smooth shrunk to a fly's few pixels; made once, shared by every swarm. */
function disc(): Texture {
  if (discTexture) return discTexture;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = DISC_SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(DISC_SIZE / 2, DISC_SIZE / 2, DISC_SIZE / 2 - 1, 0, 2 * Math.PI);
  ctx.fill();
  return (discTexture = new Texture({ source: new CanvasSource({ resource: canvas, autoGenerateMipmaps: true }) }));
}

/**
 * Steps `swarms` (those in play) one after another, one swarm to a poo: each keeps the poo it's after and chooses only
 * among those no other swarm has claimed, so the poo a swarm picks this step is out of the next one's choice.
 * `sensesOf`: what each senses, with all the poos about.
 */
export function stepSwarms(swarms: readonly Swarm[], stepMs: number, sensesOf: (s: Swarm) => SwarmSenses) {
  const claimed = new Map<object, Swarm>();
  for (const s of swarms) {
    const id = s.pooId;
    if (id) claimed.set(id, s);
  }
  for (const s of swarms) {
    const senses = sensesOf(s);
    const before = s.pooId;
    const free = senses.poos.filter((p) => (claimed.get(p.id) ?? s) === s);
    s.step(stepMs, { ...senses, poos: free });
    if (before && claimed.get(before) === s) claimed.delete(before);
    const now = s.pooId;
    if (now) claimed.set(now, s);
  }
}

const unit = (x: number, y: number): Point | null => {
  const len = Math.hypot(x, y);
  return len > 1e-6 ? { x: x / len, y: y / len } : null;
};
