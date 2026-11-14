import { describe, expect, it, vi } from 'vitest';
import { config } from '../src/config';
import { Apple } from '../src/game/Apple';
import { Body, type MBody } from '../src/game/physics';
import { Poo } from '../src/game/Poo';
import { buildLevel } from '../src/level/build';
import type { LevelDef } from '../src/level/types';

// no textures in tests: a sprite that only keeps where it is
vi.mock('../src/render/CharacterSprite', () => ({
  CharacterSprite: class {
    x = 0;
    y = 0;
    rotation = 0;
    alpha = 1;
    position = { set: (x: number, y: number) => ((this.x = x), (this.y = y)) };
    anim = { anchor: { set() {} } };
    scale = { set() {} };
    play() {}
    destroy() {}
  },
}));

/** A wooden plank as a level builds it: 200 wide, its top at y 290. */
const plank = (): MBody => {
  const def = { id: 1, kind: 'body', material: 'wood', density: 0, sleeping: false, shape: { kind: 'rect', x: 600, y: 300, width: 200, height: 20, angle: 0 } };
  return buildLevel({ bodies: [def], joints: [] } as unknown as LevelDef).bodies[0].body;
};

/** A poo splatted on the plank's top at `x`. */
const splatOn = (body: MBody, x: number) => {
  const poo = new Poo(x, 280, 0, 1);
  poo.splat(290, 0, body);
  return poo;
};

describe('a splat on a movable body', () => {
  it('adds its mass, splats adding up, until it is gone', () => {
    const body = plank(), mass = body.mass;
    const a = splatOn(body, 650), b = splatOn(body, 560);
    expect(body.mass).toBeCloseTo(mass + a.body.mass + b.body.mass);
    a.destroy();
    expect(body.mass).toBeCloseTo(mass + b.body.mass);
    b.destroy();
    expect(body.mass).toBeCloseTo(mass);
  });

  it('weighs on the side it lies on', () => {
    const body = plank();
    const right = splatOn(body, 680);
    right.step(16);
    expect(body.torque).toBeGreaterThan(0);
    const left = splatOn(body, 520);
    body.torque = 0;
    right.step(16);
    left.step(16);
    expect(body.torque).toBeCloseTo(0);
  });

  it('stays on it as it moves and turns', () => {
    const body = plank();
    const poo = splatOn(body, 680);
    Body.setPosition(body, { x: 700, y: 400 });
    Body.setAngle(body, Math.PI / 2);
    poo.sync();
    expect(poo.view.x).toBeCloseTo(700 + 8);
    expect(poo.view.y).toBeCloseTo(400 + 80);
    expect(poo.view.rotation).toBeCloseTo(Math.PI / 2);
  });

  it('adds nothing to terrain or the ground', () => {
    const poo = new Poo(600, 280, 0, 1);
    poo.splat(290);
    poo.step(16);
    expect(() => poo.destroy()).not.toThrow();
  });
});

describe('an apple hitting a movable body', () => {
  it('pushes it, turns it when off centre, and its splat weighs on it until gone', () => {
    const body = plank(), mass = body.mass;
    const apple = new Apple(680, 280, 0, 5);
    apple.splat(680, 290, { x: 0, y: -1 }, body);
    expect(body.velocity.y).toBeGreaterThan(0);
    expect(body.angularVelocity).toBeGreaterThan(0);
    expect(body.mass).toBeCloseTo(mass + config.apple.mass);
    apple.step(16);
    expect(body.torque).toBeGreaterThan(0);
    Body.setPosition(body, { x: 700, y: 400 });
    apple.sync();
    expect(apple.x).toBeCloseTo(780);
    apple.destroy();
    expect(body.mass).toBeCloseTo(mass);
  });
});
