import { describe, expect, it } from 'vitest';
import { config, WORLD } from '../src/config';
import { Bodies, Query, STEP_MS, type MBody } from '../src/game/physics';
import { Swarm, type SwarmPoo, type SwarmSenses } from '../src/game/Swarm';

const R = config.swarm.diameter / 2;

/** What a swarm senses among `bodies`, the bird at `bird` (seen or not), with `poos` about. */
const sensesOf = (bodies: MBody[], bird: { x: number; y: number } | null, seesBird: boolean, poos: SwarmPoo[] = []): SwarmSenses => ({
  bodies,
  bird,
  seesBird,
  poos,
  solid: (x, y) => y >= WORLD.groundY || y < 0 || x < 0 || x > WORLD.width || Query.point(bodies, { x, y }).length > 0,
});

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
    const s = new Swarm({ x: 400, y: 300 }, WORLD.width);
    expect(fliesOf(s)).toHaveLength(config.swarm.flyCount);
    run(s, 600, () => sensesOf([], { x: 1000, y: 200 }, true), () => {
      const o = s.outline;
      for (const f of fliesOf(s)) expect(((f.x - o.x) / o.rx) ** 2 + ((f.y - o.y) / o.ry) ** 2).toBeLessThanOrEqual(1.0001);
    });
  });

  it('drifts about where it started till it sees the bird, then goes for it and touches it', () => {
    const s = new Swarm({ x: 300, y: 300 }, WORLD.width);
    const bird = { x: 1000, y: 300 };
    run(s, 300, () => sensesOf([], bird, false));
    expect(Math.hypot(s.position.x - 300, s.position.y - 300)).toBeLessThan(R);
    let touched = false;
    run(s, 1200, () => sensesOf([], bird, true), () => (touched ||= s.touches(bird.x, bird.y, config.physics.birdRadius)));
    expect(touched).toBe(true);
  });

  it('leaves the bird for a poo, feeds on it while it lies, and goes back to the bird when it is gone', () => {
    const s = new Swarm({ x: 300, y: 300 }, WORLD.width);
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

  /** a wall across the world with a gap `gap` px tall in it, centred at y 300, at x 600–640 */
  const wallWithGap = (gap: number) => [
    Bodies.rectangle(620, (300 - gap / 2) / 2, 40, 300 - gap / 2, { isStatic: true }),
    Bodies.rectangle(620, (300 + gap / 2 + WORLD.groundY) / 2, 40, WORLD.groundY - 300 - gap / 2, { isStatic: true }),
  ];

  it('squeezes through a gap narrower than itself (down to half its height), its flies never in the wall', () => {
    const bodies = wallWithGap(R * 2 * 0.6);
    const s = new Swarm({ x: 300, y: 300 }, WORLD.width);
    const bird = { x: 1000, y: 300 };
    let flattest = R;
    run(s, 1500, () => sensesOf(bodies, bird, true), () => {
      if (Math.abs(s.position.x - 620) < 10) flattest = Math.min(flattest, s.outline.ry);
      for (const f of fliesOf(s)) expect(Query.point(bodies, f)).toHaveLength(0);
    });
    expect(s.position.x).toBeGreaterThan(700);
    // in the gap it was squeezed flat, to about the gap's height
    expect(flattest).toBeLessThan(R * 0.7);
    expect(flattest).toBeGreaterThanOrEqual(R * config.swarm.minScale - 1e-6);
  });

  it("doesn't get through a gap under half its height", () => {
    const bodies = wallWithGap(R * 2 * 0.4);
    const s = new Swarm({ x: 300, y: 300 }, WORLD.width);
    run(s, 1500, () => sensesOf(bodies, { x: 1000, y: 300 }, true));
    expect(s.position.x).toBeLessThan(620);
  });

  it("stays put, frozen, though its flies don't", () => {
    const s = new Swarm({ x: 300, y: 300 }, WORLD.width);
    s.frozen = true;
    const before = fliesOf(s);
    run(s, 120, () => sensesOf([], { x: 1000, y: 300 }, true));
    expect(s.position).toEqual({ x: 300, y: 300 });
    expect(fliesOf(s)).not.toEqual(before);
  });
});
