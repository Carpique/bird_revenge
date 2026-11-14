import { describe, expect, it, vi } from 'vitest';
import { config, WORLD } from '../src/config';
import { Bodies, Body, Composite, Engine, Events, STEP_MS, type MBody } from '../src/game/physics';
import { Poo } from '../src/game/Poo';
import { Villain } from '../src/game/Villain';
import { buildLevel } from '../src/level/build';
import type { LevelDef, VillainKind } from '../src/level/types';

// no textures in tests: sprites that draw nothing
vi.mock('../src/render/CharacterSprite', () => ({
  CharacterSprite: class {},
}));

const villain = (kind: VillainKind = 'villain') => new Villain({ kind, x: 600, y: WORLD.groundY, path: { x0: 300, x1: 900 }, throwDelay: 0 });

/** A wooden crate as a level builds it, above the villain's head. */
const crate = (): MBody => {
  const def = { id: 1, kind: 'body', material: 'wood', density: 0, sleeping: false, shape: { kind: 'rect', x: 600, y: 300, width: 50, height: 50, angle: 0 } };
  return buildLevel({ bodies: [def], joints: [] } as unknown as LevelDef).bodies[0].body;
};

/** Drops `body` on a villain (of `kind`) standing at x 600; returns the least (most upward) vertical speed it had, where it ended and how often it hit him. */
function dropOnVillain(body: MBody, kind: VillainKind = 'villain') {
  const engine = Engine.create({ gravity: { x: 0, y: config.physics.gravity } });
  Composite.add(engine.world, [villain(kind).body, body]);
  let up = Infinity, hits = 0;
  Events.on(engine, 'collisionStart', () => hits++);
  for (let i = 0; i < 120; i++) {
    Engine.update(engine, STEP_MS);
    up = Math.min(up, body.velocity.y);
  }
  return { up, y: body.position.y, hits };
}

describe('what falls on a villain', () => {
  it('bounces off, if it is a crate', () => {
    const { up, y } = dropOnVillain(crate());
    expect(up).toBeLessThan(-1);
    expect(y).toBeLessThan(WORLD.groundY - 100);
  });

  it('hits him, if it is the bird\'s poo', () => {
    expect(dropOnVillain(new Poo(600, 300, 0, 1).body).hits).toBeGreaterThan(0);
  });

  it('goes through a ghost, if it is a crate, while the bird\'s poo still hits it', () => {
    const { y, hits } = dropOnVillain(crate(), 'ghost');
    expect(hits).toBe(0);
    expect(y).toBeGreaterThan(WORLD.groundY);
    expect(dropOnVillain(new Poo(600, 300, 0, 1).body, 'ghost').hits).toBeGreaterThan(0);
  });

  it('goes through, if it is a bat\'s poo or anything else (the bird)', () => {
    const batPoo = dropOnVillain(new Poo(600, 300, 0, 1, 'bat').body);
    expect(batPoo.hits).toBe(0);
    expect(batPoo.y).toBeGreaterThan(WORLD.groundY);
    const bird = Bodies.circle(600, 300, 20);
    Body.setVelocity(bird, { x: 0, y: 1 });
    expect(dropOnVillain(bird).y).toBeGreaterThan(WORLD.groundY);
  });
});
