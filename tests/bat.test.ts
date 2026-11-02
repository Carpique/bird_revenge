import { describe, expect, it, vi } from 'vitest';
import { config } from '../src/config';
import { Bat } from '../src/game/Bat';
import { STEP_MS } from '../src/game/physics';
import type { BatDef } from '../src/level/types';

// no textures in tests: a sprite that draws nothing
vi.mock('../src/render/CharacterSprite', () => ({
  CharacterSprite: class {},
}));

const posOf = (b: Bat) => ({ ...b.body.position });

/** A bat starting at its route's first point, unless told otherwise. */
const batOf = (def: Omit<BatDef, 'start' | 'target'> & Partial<BatDef>) => new Bat({ start: def.route[0], target: 1, ...def });

describe('a bat', () => {
  it('flies an open route there and back, at its speed', () => {
    const b = batOf({ route: [[100, 100], [300, 100], [300, 200]], loop: false, speed: 2, pooDelay: 0 });
    const xs: number[] = [], ys: number[] = [];
    // 300 px out: 150 steps; then back again
    for (let i = 0; i < 300; i++) {
      b.step(STEP_MS);
      xs.push(posOf(b).x);
      ys.push(posOf(b).y);
    }
    expect(Math.max(...xs)).toBeCloseTo(300);
    expect(Math.max(...ys)).toBeCloseTo(200);
    expect(xs[149]).toBeCloseTo(300);
    expect(ys[149]).toBeCloseTo(200);
    // back at the start after twice that
    expect(xs[299]).toBeCloseTo(100);
    expect(ys[299]).toBeCloseTo(100);
  });

  it('goes round a closed route', () => {
    // a 100 px square: 400 px round, 200 steps
    const b = batOf({ route: [[0, 0], [100, 0], [100, 100], [0, 100]], loop: true, speed: 2, pooDelay: 0 });
    for (let i = 0; i < 150; i++) b.step(STEP_MS);
    expect(posOf(b)).toEqual({ x: 0, y: 100 });
    for (let i = 0; i < 50; i++) b.step(STEP_MS);
    expect(posOf(b).x).toBeCloseTo(0);
    expect(posOf(b).y).toBeCloseTo(0);
  });

  it('starts where it is told, flying to its target first', () => {
    // halfway along the bottom of a 100 px square, flying to its bottom-left corner, then up its left side
    const b = batOf({ route: [[0, 0], [100, 0], [100, 100], [0, 100]], loop: true, start: [50, 100], target: 3, speed: 2, pooDelay: 0 });
    for (let i = 0; i < 25; i++) b.step(STEP_MS);
    expect(posOf(b)).toEqual({ x: 0, y: 100 });
    for (let i = 0; i < 25; i++) b.step(STEP_MS);
    expect(posOf(b)).toEqual({ x: 0, y: 50 });
  });

  it('poos straight below itself, about every pooDelay', () => {
    const b = batOf({ route: [[0, 50], [1000, 50]], loop: false, speed: 1, pooDelay: 1 });
    const poos: { x: number; y: number }[] = [];
    b.onPoo = (x, y) => poos.push({ x, y });
    for (let i = 0; i < 60 * 10; i++) {
      const before = poos.length;
      b.step(STEP_MS);
      // a new poo leaves right under the bat
      if (poos.length > before) expect(poos.at(-1)!.x).toBe(posOf(b).x);
    }
    const spread = config.bat.intervalSpread;
    expect(poos.length).toBeGreaterThanOrEqual(Math.floor(10 / (1 + spread)));
    expect(poos.length).toBeLessThanOrEqual(Math.ceil(10 / (1 - spread)));
    for (const p of poos) expect(p.y).toBeGreaterThan(50);
  });

  it('never poos with no pooDelay', () => {
    const b = batOf({ route: [[0, 50], [1000, 50]], loop: false, speed: 1, pooDelay: 0 });
    const onPoo = vi.fn();
    b.onPoo = onPoo;
    for (let i = 0; i < 60 * 30; i++) b.step(STEP_MS);
    expect(onPoo).not.toHaveBeenCalled();
  });

  it('is hurt by touching only while flying, and knocked off by a hit', () => {
    const b = batOf({ route: [[200, 200], [400, 200]], loop: false, speed: 2, pooDelay: 0 });
    b.step(STEP_MS);
    const { x, y } = posOf(b);
    expect(b.touches(x + 30, y, 20)).toBe(true);
    expect(b.touches(x + 100, y, 20)).toBe(false);
    expect(b.hit()).toBe(true);
    expect(b.hit()).toBe(false);
    expect(b.touches(x, y, 20)).toBe(false);
  });
});
