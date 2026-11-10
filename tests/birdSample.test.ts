import { describe, expect, it, vi } from 'vitest';
import { config, WORLD } from '../src/config';
import { Bird, type BirdSample } from '../src/game/Bird';
import { Body } from '../src/game/physics';

// no textures in tests: a sprite that draws nothing, in a container that takes it as it is
vi.mock('../src/render/CharacterSprite', () => ({
  CharacterSprite: class {},
}));
vi.mock('pixi.js', () => ({ Container: class { addChild() {} } }));

describe('Bird.sample', () => {
  it('writes the body (px, px per step) and the flags into the object it is given, allocating nothing', () => {
    const b = new Bird(400);
    const out: BirdSample = { x: 0, y: 0, vx: 0, vy: 0, onGround: false, perched: false, dying: false };
    expect(b.sample(out)).toBe(out); // the same object back
    expect(out).toEqual({ x: 400, y: WORLD.groundY - config.physics.birdRadius, vx: 0, vy: 0, onGround: true, perched: false, dying: false });

    Body.setPosition(b.body, { x: 500, y: 200 });
    Body.setVelocity(b.body, { x: 3, y: -4 });
    b.sample(out);
    expect(out).toMatchObject({ x: 500, y: 200, vx: 3, vy: -4, onGround: false, perched: false, dying: false });

    b.perched = true;
    expect(b.sample(out)).toMatchObject({ onGround: true, perched: true });
  });

  it('while dying: the death fall, not the body, and never on the ground', () => {
    const b = new Bird(400);
    b.die();
    const out = b.sample({ x: 0, y: 0, vx: 0, vy: 0, onGround: true, perched: true, dying: false });
    expect(out.dying).toBe(true);
    expect(out.onGround).toBe(false);
    expect(out.perched).toBe(false);
    expect(out.vy).toBe(-config.player.dieJumpSpeed);
    expect(Math.abs(out.vx)).toBe(config.player.dieSideSpeed);
  });
});
