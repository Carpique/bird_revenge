import { describe, expect, it } from 'vitest';
import { config } from '../../src/config';
import { pointingStep, type PointingIntent } from '../../src/game/pointing';
import { Bodies, Body, Composite, Engine, forceFor, STEP_MS } from '../../src/game/physics';
import { allRecordings, simulate, type Tick } from './harness';

/**
 * The bird's motion on recordings of real play (black-box dumps): the full pose pipeline's controls each tick,
 * flown with Matter.js (`pointingStep` and the anti-gravity force as in `Bird.step`, air friction, gravity, the
 * speed cap; no collisions, no floor).
 */

const dumps = allRecordings().filter((r) => r.rec.level === 'black-box');

const intentOf = (k: Tick): PointingIntent => {
  if (k.mode === 'fly') return { mode: 'fly', dx: Math.cos((k.ang * Math.PI) / 180), dy: Math.sin((k.ang * Math.PI) / 180) };
  if (k.mode === 'drift') return { mode: 'drift', dx: k.ang === 0 ? 1 : -1, dy: 0, sink: k.sink };
  if (k.mode === 'hover') return { mode: 'hover', dx: 0, dy: 0 };
  return { mode: 'rest', dx: 0, dy: 0 };
};

/** velocities (px per step, y down) of a free body flown by the ticks' controls */
function fly(ticks: Tick[]) {
  const engine = Engine.create();
  engine.gravity.y = config.physics.gravity;
  const b = Bodies.circle(0, 0, 10);
  Composite.add(engine.world, b);
  const vs: { x: number; y: number }[] = [];
  for (const k of ticks) {
    const p = intentOf(k);
    b.frictionAir = p.mode === 'rest' ? config.physics.birdAirFriction : config.pointing.airFriction;
    const g = pointingStep(b.velocity, p, STEP_MS);
    Body.setVelocity(b, { x: g.x, y: g.y });
    Body.applyForce(b, b.position, { x: 0, y: -forceFor(b, config.physics.gravity * 1000 * (1 - g.gravity)) });
    const v = b.velocity;
    const speed = Math.hypot(v.x, v.y);
    if (speed > config.physics.maxSpeed) Body.setVelocity(b, { x: (v.x / speed) * config.physics.maxSpeed, y: (v.y / speed) * config.physics.maxSpeed });
    Engine.update(engine, STEP_MS);
    vs.push({ ...b.velocity });
  }
  Engine.clear(engine);
  return vs;
}

/** disjoint 100 ms windows (6 ticks) where the velocity changed by more than `px` px per step: jolts */
function jolts(vs: { x: number; y: number }[], px = 5) {
  let n = 0;
  for (let i = 6; i < vs.length; i += 6) if (Math.hypot(vs[i].x - vs[i - 6].x, vs[i].y - vs[i - 6].y) > px) n++;
  return n;
}

/** ms of ticks descending (a lowered tilted T) */
const descendingMs = (ticks: Tick[]) => ticks.filter((k) => k.mode === 'drift' && k.sink > 0).length * STEP_MS;

describe('motion on recordings of play', () => {
  it('there are recordings of play', () => {
    expect(dumps.length).toBeGreaterThan(0);
  });

  for (const r of dumps) {
    it(`${r.name}: no jolts (accel ${config.pointing.accel}; at 3600 there were 8-13 per recording)`, () => {
      const ticks = simulate(r, r.frames, { startState: 'playing' }).ticks.filter((k) => k.state === 'playing');
      expect(jolts(fly(ticks))).toBe(0);
    });
  }

  it('the diagonal descent: seconds of it where a lowered tilted T was held, next to none in the other recordings', () => {
    const ms: Record<string, number> = {};
    for (const r of dumps) ms[r.name] = descendingMs(simulate(r, r.frames, { startState: 'playing' }).ticks);
    console.log(`descending ms: ${JSON.stringify(Object.fromEntries(Object.entries(ms).map(([k, v]) => [k, Math.round(v)])))}`);
    if ('2026-11-09-gra-po-strojeniu' in ms) expect(ms['2026-11-09-gra-po-strojeniu']).toBeGreaterThan(3000);
    for (const name of ['2026-11-09-gra', '2026-11-09-trening']) if (name in ms) expect(ms[name]).toBeLessThan(1000);
  });

  it('the descent starts and stops a handful of times, not flickering', () => {
    for (const r of dumps) {
      const ticks = simulate(r, r.frames, { startState: 'playing' }).ticks;
      let starts = 0;
      for (let i = 1; i < ticks.length; i++) if (ticks[i].sink > 0 && !(ticks[i - 1].sink > 0)) starts++;
      expect(starts, r.name).toBeLessThanOrEqual(20);
    }
  });
});
