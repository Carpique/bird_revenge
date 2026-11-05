import { describe, expect, it, vi } from 'vitest';
import { WORLD } from '../src/config';
import { Bodies, STEP_MS } from '../src/game/physics';
import { spanInBand, Villain } from '../src/game/Villain';

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
    const halfW = v.hitbox.width / 2;
    expect(lo).toBeGreaterThanOrEqual(500 + halfW - 2);
    expect(hi).toBeLessThanOrEqual(700 - halfW + 2);
    // ...and he did walk it end to end
    expect(lo).toBeLessThan(500 + halfW + 5);
    expect(hi).toBeGreaterThan(700 - halfW - 5);
    expect(v.body.position.y).toBeCloseTo(380 - v.hitbox.height / 2);
  });

  it('is hit within the ellipse of his hitbox, not in its corners', () => {
    for (const kind of ['villain', 'ghost'] as const) {
      const v = new Villain({ kind, x: 600, y: 640, path: { x0: 600, x1: 600 }, throwDelay: 0 });
      v.step(STEP_MS, { bird: null, obstacles: [] });
      const { width: w, height: h } = v.hitbox;
      const cy = v.top + h / 2;
      expect(v.touches(600, cy, 1)).toBe(true);
      expect(v.touches(600 + w / 2 + 4, cy, 5)).toBe(true);
      expect(v.touches(600, v.top - 4, 5)).toBe(true);
      // the corner of the box around the ellipse
      expect(v.touches(600 + w / 2 - 2, v.top + 2, 1)).toBe(false);
      expect(v.touches(600 - w / 2 + 2, v.top + h - 2, 1)).toBe(false);
    }
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

describe('spanInBand', () => {
  it('is the slice of a body at his height, not its bounding box', () => {
    // a roof sloping down at 45° from (576, 96) to the ground at (1120, 640)
    const roof = Bodies.rectangle(848, 368, 769, 16, { angle: Math.PI / 4 });
    const span = spanInBand(roof, 520, 630)!;
    expect(roof.bounds.min.x).toBeLessThan(580);
    expect(span.x0).toBeGreaterThan(985);
    expect(span.x1).toBeLessThan(1130);
    expect(spanInBand(roof, 700, 800)).toBeNull();
    expect(spanInBand(Bodies.rectangle(100, 100, 50, 50), 0, 200)).toEqual({ x0: 75, x1: 125 });
  });
});
