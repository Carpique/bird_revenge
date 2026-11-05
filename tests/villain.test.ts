import { describe, expect, it, vi } from 'vitest';
import { villainHitbox } from '../src/characters/villain';
import { WORLD } from '../src/config';
import { STEP_MS } from '../src/game/physics';
import { Villain } from '../src/game/Villain';

// no textures in tests: a sprite that draws nothing
vi.mock('../src/render/CharacterSprite', () => ({
  CharacterSprite: class {},
}));

/** Where the villain's centre is: read through his hitbox body. */
const xOf = (v: Villain) => v.body.position.x;

describe('a villain', () => {
  it('stays on his shelf, turning at its edges', () => {
    // a path wider than the shelf (500..700): the edges stop him first
    const v = new Villain({ kind: 'villain', x: 600, y: 380, path: { x0: 300, x1: 900 }, throwDelay: 0 });
    const offShelf = [{ x0: -1000, x1: 500 }, { x0: 700, x1: 3000 }];
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < 60 * 120; i++) {
      v.step(STEP_MS, { bird: null, obstacles: offShelf });
      lo = Math.min(lo, xOf(v));
      hi = Math.max(hi, xOf(v));
    }
    const halfW = villainHitbox.width / 2;
    expect(lo).toBeGreaterThanOrEqual(500 + halfW - 2);
    expect(hi).toBeLessThanOrEqual(700 - halfW + 2);
    // ...and he did walk it end to end
    expect(lo).toBeLessThan(500 + halfW + 5);
    expect(hi).toBeGreaterThan(700 - halfW - 5);
    expect(v.body.position.y).toBe(380 - villainHitbox.height / 2);
  });

  it('stands on the ground when placed with his feet below it', () => {
    const v = new Villain({ kind: 'ghost', x: 600, y: WORLD.groundY + 16, path: { x0: 300, x1: 900 }, throwDelay: 0 });
    expect(v.feet).toBe(WORLD.groundY);
  });

  it('starts off a random way', () => {
    const dirs = new Set<number>();
    for (let i = 0; i < 40; i++) {
      const v = new Villain({ kind: 'villain', x: 600, y: 640, path: { x0: 300, x1: 900 }, throwDelay: 0 });
      for (let s = 0; s < 5; s++) v.step(STEP_MS, { bird: null, obstacles: [] });
      dirs.add(Math.sign(xOf(v) - 600));
    }
    expect(dirs).toEqual(new Set([-1, 1]));
  });
});
