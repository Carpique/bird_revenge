import { describe, expect, it, vi } from 'vitest';
import { dragonConfig, dragonMouth } from '../src/characters/dragon';
import { Dragon } from '../src/game/Dragon';
import { FirePath, fireRoute } from '../src/game/firePath';
import { STEP_MS } from '../src/game/physics';
import type { DragonDef } from '../src/level/types';

// no textures in tests: a dragon and fire that draw nothing
vi.mock('../src/render/CharacterSprite', async () => {
  const { Container } = await import('pixi.js');
  return { CharacterSprite: class extends Container { setFacing() {} } };
});
vi.mock('../src/render/FireStream', async () => {
  const { Container } = await import('pixi.js');
  return { FireStream: class extends Container { step() {} } };
});

const def = (more: Partial<DragonDef> = {}): DragonDef => ({ x: 300, y: 640, facing: 'right', path: null, fireLength: 240, throwDelay: 4, flameDuration: 1, ...more });

/** Steps `d` until `until` holds (at most a minute), returning the ms that took. */
function stepUntil(d: Dragon, until: () => boolean): number {
  let ms = 0;
  while (!until() && ms < 60_000) {
    d.step(STEP_MS);
    ms += STEP_MS;
  }
  return ms;
}

describe('a dragon fire route', () => {
  it('goes straight ahead from the mouth, either way', () => {
    const right = fireRoute(def());
    expect(right.points).toEqual([
      [300 + dragonMouth.x, 640 + dragonMouth.y],
      [300 + dragonMouth.x + 240, 640 + dragonMouth.y],
    ]);
    const left = fireRoute(def({ facing: 'left', fireLength: 100 }));
    expect(left.points[1][0]).toBeCloseTo(300 - dragonMouth.x - 100);
    expect(left.length).toBeCloseTo(100);
  });

  it('runs from the mouth on to its path, from the end nearer the mouth', () => {
    const mouth: [number, number] = [300 + dragonMouth.x, 640 + dragonMouth.y];
    const route = fireRoute(def({ path: [[700, 400], [500, 600]] }));
    expect(route.points).toEqual([mouth, [500, 600], [700, 400]]);
  });

  it('finds points along it and how near things are to its first part', () => {
    const p = new FirePath([[0, 0], [100, 0], [100, 100]]);
    expect(p.length).toBe(200);
    expect(p.pointAt(150)).toEqual({ x: 100, y: 50, angle: Math.PI / 2 });
    expect(p.distanceTo(50, 10, 200)).toBeCloseTo(10);
    // the corner is 100 along: only reached that far
    expect(p.distanceTo(110, 80, 200)).toBeCloseTo(10);
    expect(p.distanceTo(110, 80, 100)).toBeCloseTo(Math.hypot(10, 80));
    expect(p.distanceTo(80, 0, 50)).toBeCloseTo(30);
  });

  it('is clear up to the first thing in the way', () => {
    const p = new FirePath([[0, 0], [100, 0], [100, 100]]);
    expect(p.clearLength(() => false)).toBe(200);
    // a wall across the second leg, from 50 down
    const clear = p.clearLength((_x, y) => y >= 50 && y <= 60);
    expect(clear).toBeGreaterThanOrEqual(140);
    expect(clear).toBeLessThan(150);
    expect(p.clearLength(() => true)).toBe(0);
  });
});

describe('a dragon', () => {
  it('rolls its fire out in rollMs, keeps it out for flameDuration, rolls it back in rollMs', () => {
    const d = new Dragon(def({ flameDuration: 1 }));
    stepUntil(d, () => d.phase === 'spitting');
    const len = d.route.length, roll = dragonConfig.fire.rollMs;
    const out = stepUntil(d, () => d.reach >= len);
    expect(out).toBeGreaterThan(roll - 2 * STEP_MS);
    expect(out).toBeLessThan(roll + 2 * STEP_MS);
    const held = stepUntil(d, () => d.reach < len);
    expect(held).toBeGreaterThan(1000 - 2 * STEP_MS);
    expect(held).toBeLessThan(1000 + 2 * STEP_MS);
    const back = stepUntil(d, () => d.reach === 0);
    expect(back).toBeGreaterThan(roll - 2 * STEP_MS);
    expect(back).toBeLessThan(roll + 2 * STEP_MS);
  });

  it('spits every throwDelay or so, and never with a throwDelay of 0', () => {
    const d = new Dragon(def({ throwDelay: 2 }));
    stepUntil(d, () => d.phase === 'spitting');
    stepUntil(d, () => d.phase === 'resting');
    const wait = stepUntil(d, () => d.phase !== 'resting');
    const spread = dragonConfig.intervalSpread;
    expect(wait).toBeGreaterThanOrEqual(2000 * (1 - spread) - STEP_MS);
    expect(wait).toBeLessThanOrEqual(2000 * (1 + spread) + STEP_MS);

    const never = new Dragon(def({ throwDelay: 0 }));
    expect(stepUntil(never, () => never.phase !== 'resting')).toBeGreaterThanOrEqual(60_000);
  });

  it('burns only where its fire is', () => {
    const d = new Dragon(def());
    const [mx, my] = [300 + dragonMouth.x, 640 + dragonMouth.y];
    const r = 10, reach = dragonConfig.fire.halfThickness + r;
    expect(d.touches(mx + 100, my, r)).toBe(false);
    stepUntil(d, () => d.reach >= d.route.length);
    expect(d.touches(mx + 100, my, r)).toBe(true);
    expect(d.touches(mx + 100, my - reach + 1, r)).toBe(true);
    expect(d.touches(mx + 100, my - reach - 1, r)).toBe(false);
    // the burning part (with `halfThickness` round it) ends `hitTrim` of the way back from the tip to where the tail starts
    const f = dragonConfig.fire;
    const burnEnd = 240 + f.halfThickness - f.hitTrim * (f.taperOver * f.tailShare + f.halfThickness);
    expect(d.touches(mx + burnEnd - 1 + r, my, r)).toBe(true);
    expect(d.touches(mx + burnEnd + 1 + r, my, r)).toBe(false);
    // halfway back, the far half is out
    stepUntil(d, () => d.reach > 0 && d.reach < d.route.length / 2);
    expect(d.touches(mx + 220, my, r)).toBe(false);
    expect(d.touches(mx + 40, my, r)).toBe(true);
  });

  it('has its fire stopped by a wall, but burns up to it', () => {
    const d = new Dragon(def());
    const [mx, my] = [300 + dragonMouth.x, 640 + dragonMouth.y];
    const wall = (x: number) => x >= mx + 100 && x <= mx + 120;
    const step = () => d.step(STEP_MS, wall);
    while (d.phase !== 'spitting') step();
    for (let ms = 0; ms < dragonConfig.fire.rollMs + 200; ms += STEP_MS) step();
    expect(d.reach).toBeLessThanOrEqual(100);
    expect(d.reach).toBeGreaterThan(90);
    expect(d.touches(mx + 80, my, 10)).toBe(true);
    // behind the wall
    expect(d.touches(mx + 180, my, 10)).toBe(false);
  });
});
