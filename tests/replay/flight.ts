import { config } from '../../src/config';
import { pointingStep, type PointingIntent } from '../../src/game/pointing';
import { Bodies, Body, Composite, Engine, forceFor, STEP_MS } from '../../src/game/physics';
import type { Tick } from './harness';

/**
 * The bird's motion under the ticks' controls, flown with Matter.js (`pointingStep` and the anti-gravity force as in
 * `Bird.step`, air friction, gravity, the speed cap; no collisions, no floor), for the replay tests of motion.
 */

/** the intent a tick gives the bird: its own when it carries one (continuous steering's velocity too), else from the mode */
export const intentOf = (k: Tick): PointingIntent => {
  if (k.intent) return k.intent;
  if (k.mode === 'fly') return { mode: 'fly', dx: Math.cos((k.ang * Math.PI) / 180), dy: Math.sin((k.ang * Math.PI) / 180) };
  if (k.mode === 'drift') return { mode: 'drift', dx: k.ang === 0 ? 1 : -1, dy: 0, sink: k.sink };
  if (k.mode === 'hover') return { mode: 'hover', dx: 0, dy: 0 };
  return { mode: 'rest', dx: 0, dy: 0 };
};

/** velocities (px per step, y down) of a free body flown by the ticks' controls */
export function fly(ticks: Tick[]) {
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
export function jolts(vs: { x: number; y: number }[], px = 5) {
  let n = 0;
  for (let i = 6; i < vs.length; i += 6) if (Math.hypot(vs[i].x - vs[i - 6].x, vs[i].y - vs[i - 6].y) > px) n++;
  return n;
}
