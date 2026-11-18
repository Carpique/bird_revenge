import { describe, expect, it } from 'vitest';
import { WORLD } from '../src/config';
import { centredOn, follow, scrolls } from '../src/game/camera';

const W = WORLD.width;

describe('camera', () => {
  it('only a level wider than the world scrolls', () => {
    expect(scrolls(W)).toBe(false);
    expect(scrolls(W + 16)).toBe(true);
  });

  it('starts with the bird in the middle, as far as the level allows', () => {
    expect(centredOn(2000, 4 * W)).toBe(2000 - W / 2);
    expect(centredOn(100, 4 * W)).toBe(0);
    expect(centredOn(4 * W - 100, 4 * W)).toBe(3 * W);
    expect(centredOn(900, W)).toBe(0);
  });

  it('stays put while the bird is in the middle third', () => {
    for (const x of [1000 + W / 3, 1000 + W / 2, 1000 + (2 * W) / 3]) expect(follow(1000, x, 4 * W)).toBeCloseTo(1000);
  });

  it('scrolls just enough to keep the bird at the edge of the middle third', () => {
    expect(follow(1000, 1000 + (2 * W) / 3 + 10, 4 * W)).toBeCloseTo(1010);
    expect(follow(1000, 1000 + W / 3 - 10, 4 * W)).toBeCloseTo(990);
  });

  it("stops at the level's ends", () => {
    expect(follow(5, 20, 4 * W)).toBe(0);
    expect(follow(3 * W - 5, 4 * W - 20, 4 * W)).toBe(3 * W);
    expect(follow(0, W - 20, W)).toBe(0);
  });

  it('splits a screen wider than the world into its own thirds', () => {
    // 1880 px across, 300 past the world each side: the middle third is 326.67..953.33 of the world
    expect(follow(1000, 1000 + 950, 4 * W, -300, W + 300)).toBe(1000);
    expect(follow(1000, 1000 + 960, 4 * W, -300, W + 300)).toBeCloseTo(1000 + 960 - (W + 300 - 1880 / 3));
  });
});
