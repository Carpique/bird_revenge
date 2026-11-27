import { beforeEach, describe, expect, it } from 'vitest';
import { config, WORLD } from '../src/config';
import { Bodies, Body, Composite, CRATE, Engine, Query, STEP_MS, type MBody } from '../src/game/physics';
import { hunterOutline, Navigation } from '../src/game/homing';
import { stepSwarms, Swarm, type SwarmPoo, type SwarmSenses } from '../src/game/Swarm';

const R = config.swarm.diameter / 2;

/** the way round the level, a new one for each test, stepped (as the game does each step) whenever a swarm senses */
let nav: Navigation;
beforeEach(() => {
  nav = new Navigation(WORLD.width);
});

/** What a swarm senses among `bodies`, the bird at `bird` (seen or not), with `poos` about. */
const sensesOf = (bodies: MBody[], bird: { x: number; y: number } | null, seesBird: boolean, poos: SwarmPoo[] = []): SwarmSenses => (
  nav.step(STEP_MS, bodies),
  {
  bodies,
  nav,
  bird,
  seesBird,
  poos,
  solid: (x, y) => y >= WORLD.groundY || y < 0 || x < 0 || x > WORLD.width || Query.point(bodies, { x, y }).length > 0,
  }
);

/** The swarm's flies, read from its insides (they're its own business, but the tests want to see them). */
const fliesOf = (s: Swarm) => {
  const f = s as unknown as { fx: Float32Array; fy: Float32Array };
  return Array.from(f.fx, (x, i) => ({ x, y: f.fy[i] }));
};

const run = (s: Swarm, steps: number, senses: () => SwarmSenses, each?: () => void) => {
  for (let i = 0; i < steps; i++) {
    s.step(STEP_MS, senses());
    each?.();
  }
};

describe('a fly swarm', () => {
  it('has config.swarm.flyCount flies, all inside its oval, whatever it does', () => {
    const s = new Swarm({ x: 400, y: 300 });
    expect(fliesOf(s)).toHaveLength(config.swarm.flyCount);
    run(s, 600, () => sensesOf([], { x: 1000, y: 200 }, true), () => {
      const o = s.outline;
      for (const f of fliesOf(s)) expect(((f.x - o.x) / o.rx) ** 2 + ((f.y - o.y) / o.ry) ** 2).toBeLessThanOrEqual(1.0001);
    });
  });

  it('drifts about where it started till it sees the bird, then goes for it and touches it', () => {
    const s = new Swarm({ x: 300, y: 300 });
    const bird = { x: 1000, y: 300 };
    run(s, 300, () => sensesOf([], bird, false));
    expect(Math.hypot(s.position.x - 300, s.position.y - 300)).toBeLessThan(R);
    let touched = false;
    run(s, 1200, () => sensesOf([], bird, true), () => (touched ||= s.touches(bird.x, bird.y, config.physics.birdRadius)));
    expect(touched).toBe(true);
  });

  it('leaves the bird for a poo, feeds on it while it lies, and goes back to the bird when it is gone', () => {
    const s = new Swarm({ x: 300, y: 300 });
    const bird = { x: 1000, y: 200 };
    const poo: SwarmPoo = { id: {}, x: 500, y: WORLD.groundY + 2, lying: true };
    run(s, 100, () => sensesOf([], bird, true));
    run(s, 600, () => sensesOf([], bird, false, [poo]));
    expect(s.isFeeding).toBe(true);
    expect(Math.abs(s.position.x - poo.x)).toBeLessThan(config.swarm.feedReach * 2);
    // feeding, the flies dart up and down over it: some right down by it, some well up
    const ys = fliesOf(s).map((f) => f.y);
    expect(Math.max(...ys)).toBeGreaterThan(poo.y - 20);
    expect(Math.min(...ys)).toBeLessThan(poo.y - R);
    // gone: back to the bird
    run(s, 1200, () => sensesOf([], bird, false));
    expect(s.isFeeding).toBe(false);
    expect(Math.hypot(s.position.x - bird.x, s.position.y - bird.y)).toBeLessThan(R * 1.5);
  });

  it("ignores poos till it has seen the bird", () => {
    const s = new Swarm({ x: 300, y: 300 });
    const bird = { x: 1000, y: 200 };
    const poo: SwarmPoo = { id: {}, x: 400, y: WORLD.groundY + 2, lying: true };
    run(s, 300, () => sensesOf([], bird, false, [poo]));
    expect(s.afterPoo).toBe(false);
    expect(Math.hypot(s.position.x - 300, s.position.y - 300)).toBeLessThan(R);
    // seen once: from then on a poo draws it, seen or not
    run(s, 1, () => sensesOf([], bird, true, [poo]));
    run(s, 1, () => sensesOf([], bird, false, [poo]));
    expect(s.pooId).toBe(poo.id);
  });

  /** a wall across the world with a gap `gap` px tall in it, centred at y 300, at x 600–640 */
  const wallWithGap = (gap: number) => [
    Bodies.rectangle(620, (300 - gap / 2) / 2, 40, 300 - gap / 2, { isStatic: true }),
    Bodies.rectangle(620, (300 + gap / 2 + WORLD.groundY) / 2, 40, WORLD.groundY - 300 - gap / 2, { isStatic: true }),
  ];

  it('squeezes through a gap narrower than itself (any hunter gets through one this tall), its flies never in the wall', () => {
    const bodies = wallWithGap(100);
    const s = new Swarm({ x: 300, y: 300 });
    const bird = { x: 1000, y: 300 };
    let flattest = R;
    run(s, 1500, () => sensesOf(bodies, bird, true), () => {
      if (Math.abs(s.position.x - 620) < 10) flattest = Math.min(flattest, s.outline.ry);
      for (const f of fliesOf(s)) expect(Query.point(bodies, f)).toHaveLength(0);
    });
    expect(s.position.x).toBeGreaterThan(700);
    // in the gap it was squeezed flat, to about the gap's height
    expect(flattest).toBeLessThan(R * 0.8);
    expect(flattest).toBeGreaterThanOrEqual(hunterOutline().halfHeight - 1e-6);
  });

  it("doesn't get through a gap lower than the hunters' oval", () => {
    const bodies = wallWithGap(R * 2 * 0.4);
    const s = new Swarm({ x: 300, y: 300 });
    run(s, 1500, () => sensesOf(bodies, { x: 1000, y: 300 }, true));
    expect(s.position.x).toBeLessThan(620);
  });

  it('shares out the poos, one swarm to a poo: a second swarm takes the other poo, or none', () => {
    const a = new Swarm({ x: 300, y: 300 }), b = new Swarm({ x: 360, y: 300 });
    const bird = { x: 1000, y: 200 };
    const near: SwarmPoo = { id: {}, x: 330, y: WORLD.groundY + 2, lying: true };
    const far: SwarmPoo = { id: {}, x: 900, y: WORLD.groundY + 2, lying: true };
    // one poo: one swarm goes for it, the other keeps after the bird
    stepSwarms([a, b], STEP_MS, () => sensesOf([], bird, true, [near]));
    expect([a.pooId, b.pooId].filter((id) => id === near.id)).toHaveLength(1);
    expect([a.pooId, b.pooId]).toContain(null);
    // two: one each, and they keep to them, both feeding
    for (let i = 0; i < 900; i++) stepSwarms([a, b], STEP_MS, () => sensesOf([], bird, true, [near, far]));
    expect(new Set([a.pooId, b.pooId])).toEqual(new Set([near.id, far.id]));
    expect(a.isFeeding && b.isFeeding).toBe(true);
  });

  it('gets out of the way of a crate sliding at it, never letting it through its middle, and stops when it stops', () => {
    const s = new Swarm({ x: 400, y: 300 });
    const crate = Bodies.rectangle(150, 300, 60, 60);
    const bird = { x: 1000, y: 100 };
    for (let i = 0; i < 120; i++) {
      Body.setVelocity(crate, { x: 5, y: 0 });
      Body.translate(crate, { x: 5, y: 0 });
      s.step(STEP_MS, sensesOf([crate], bird, false));
      expect(Query.point([crate], s.position)).toHaveLength(0);
    }
    // it went on unhindered: nothing behind the swarm to pin it, so it never held
    expect(crate.position.x).toBeCloseTo(750);
    // stopped: so does the swarm's shove, at once (shoved far from where it started, it heads back there, no faster
    // than it goes home, with some leeway for its jitter: well short of the crate's 5 px a step)
    Body.setVelocity(crate, { x: 0, y: 0 });
    run(s, 5, () => sensesOf([crate], bird, false));
    const at = s.position;
    run(s, 10, () => sensesOf([crate], bird, false));
    expect(Math.hypot(s.position.x - at.x, s.position.y - at.y)).toBeLessThan(config.swarm.homeSpeed * 10 * 1.4);
  });

  /** A shaft down to the ground at x = 400, a little wider than a squeezed swarm, a crate (narrower) falling into it, a swarm at the bottom: all in a physics world. */
  const shaft = () => {
    const engine = Engine.create();
    const ground = Bodies.rectangle(WORLD.width / 2, WORLD.groundY + 50, WORLD.width, 100, { isStatic: true });
    const half = hunterOutline().halfWidth + 15;
    const walls = [400 - half - 30, 400 + half + 30].map((x) => Bodies.rectangle(x, WORLD.groundY - 200, 60, 400, { isStatic: true }));
    const crate = Bodies.rectangle(400, WORLD.groundY - 330, 2 * half - 10, 40, { collisionFilter: { category: CRATE } });
    Composite.add(engine.world, [ground, ...walls, crate]);
    const s = new Swarm({ x: 400, y: WORLD.groundY - R });
    Composite.add(engine.world, s.body);
    return { engine, ground, walls, crate, s };
  };

  it('pinned with nowhere to go by a falling crate, holds it up as anything fixed would', () => {
    const { engine, ground, walls, crate, s } = shaft();
    for (let i = 0; i < 240; i++) {
      Engine.update(engine, STEP_MS);
      s.step(STEP_MS, sensesOf([ground, ...walls, crate], { x: 1000, y: 100 }, false));
      expect(Query.point([crate], s.position)).toHaveLength(0);
    }
    // the crate rests on it, off the ground by about its squeezed size
    expect(s.isHolding).toBe(true);
    expect(crate.bounds.max.y).toBeLessThan(WORLD.groundY - hunterOutline().halfHeight);
    expect(Math.hypot(crate.velocity.x, crate.velocity.y)).toBeLessThan(0.1);
  });

  it('holding a crate up, stays put while it rests on it, and goes its way once it is gone', () => {
    const { engine, ground, walls, crate, s } = shaft();
    let bodies = [ground, ...walls, crate];
    const bird = { x: 1000, y: 100 };
    const step = () => {
      Engine.update(engine, STEP_MS);
      s.step(STEP_MS, sensesOf(bodies, bird, true));
    };
    for (let i = 0; i < 120; i++) step();
    expect(s.isHolding).toBe(true);
    // the bird in sight makes no odds while the crate rests on it
    const at = s.position;
    for (let i = 0; i < 300; i++) step();
    expect(s.isHolding).toBe(true);
    expect(s.position).toEqual(at);
    // the crate gone: up and out it goes, its body solid to nothing again
    Composite.remove(engine.world, crate);
    bodies = [ground, ...walls];
    for (let i = 0; i < 60; i++) step();
    expect(s.isHolding).toBe(false);
    expect(s.body.collisionFilter.mask).toBe(0);
    expect(s.position.y).toBeLessThan(at.y - 20);
  });

  it('slips out sideways from under a falling crate when it can, holding nothing', () => {
    const engine = Engine.create();
    const ground = Bodies.rectangle(WORLD.width / 2, WORLD.groundY + 50, WORLD.width, 100, { isStatic: true });
    const crate = Bodies.rectangle(400, WORLD.groundY - 300, 160, 40, { collisionFilter: { category: CRATE } });
    Composite.add(engine.world, [ground, crate]);
    const s = new Swarm({ x: 400, y: WORLD.groundY - R });
    Composite.add(engine.world, s.body);
    let held = false;
    for (let i = 0; i < 400; i++) {
      Engine.update(engine, STEP_MS);
      s.step(STEP_MS, sensesOf([ground, crate], { x: 1000, y: 100 }, false));
      held ||= s.isHolding;
    }
    // it never held: the crate came down to the ground, and the swarm is clear of it (back over it, where it started)
    expect(held).toBe(false);
    expect(crate.bounds.max.y).toBeGreaterThan(WORLD.groundY - 3);
    expect(Query.point([crate], s.position)).toHaveLength(0);
  });

  it("stays put, frozen, though its flies don't", () => {
    const s = new Swarm({ x: 300, y: 300 });
    s.frozen = true;
    const before = fliesOf(s);
    run(s, 120, () => sensesOf([], { x: 1000, y: 300 }, true));
    expect(s.position).toEqual({ x: 300, y: 300 });
    expect(fliesOf(s)).not.toEqual(before);
  });
});
