import { describe, expect, it, vi } from 'vitest';
import { batOutline } from '../src/characters/bat';
import { config } from '../src/config';
import { Bat, type Homing } from '../src/game/Bat';
import { HomingField, inSight } from '../src/game/homing';
import { Bodies } from '../src/game/physics';
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

describe('a homing bat (no route)', () => {
  const homer = (x: number, y: number, speed = 1) => batOf({ route: [], loop: false, start: [x, y], target: 0, speed, pooDelay: 0 });
  /** steps the bats `n` times, the field worked out again every 15 steps, as the game does; they can see the bird unless told */
  const run = (bats: Bat[], field: HomingField, bodies: Parameters<HomingField['update']>[0], bird: { x: number; y: number }, n: number, track?: (b: Bat) => void, seesBird = true) => {
    for (let i = 0; i < n; i++) {
      if (i % 15 === 0) field.update(bodies, bird);
      for (const b of bats) {
        const homing: Homing = { field, others: bats.filter((o) => o !== b).map((o) => o.position), seesBird };
        b.step(STEP_MS, homing);
        track?.(b);
      }
    }
  };

  it('flies at the bird, never faster than its speed', () => {
    const b = homer(1000, 300);
    const field = new HomingField();
    let last = b.position;
    run([b], field, [], { x: 200, y: 300 }, 1200, (bat) => {
      const p = bat.position;
      expect(Math.hypot(p.x - last.x, p.y - last.y)).toBeLessThanOrEqual(1 + 1e-9);
      last = p;
    });
    expect(Math.hypot(b.position.x - 200, b.position.y - 300)).toBeLessThan(30);
  });

  it('flies a curvy path, each bat its own', () => {
    const ys = (b: Bat) => {
      const out: number[] = [];
      run([b], new HomingField(), [], { x: 200, y: 300 }, 600, (bat) => out.push(bat.position.y));
      return out;
    };
    const a = ys(homer(1000, 300)), c = ys(homer(1000, 300));
    // off the straight line there...
    expect(Math.max(...a.map((y) => Math.abs(y - 300)))).toBeGreaterThan(5);
    // ...and not the way the other one goes
    expect(Math.max(...a.map((y, i) => Math.abs(y - c[i])))).toBeGreaterThan(2);
  });

  it('goes round a wall between it and the bird, its wings never in it', () => {
    // a wall from the ground up to y 150, between the bat and the bird
    const wall = Bodies.rectangle(640, 395, 40, 490, { isStatic: true });
    const b = homer(900, 500);
    const field = new HomingField();
    const { halfWidth: hw, halfHeight: hh } = batOutline;
    run([b], field, [wall], { x: 300, y: 500 }, 60 * 30, (bat) => {
      const { x, y } = bat.position;
      // the oval round it clear of the wall's box: its nearest point outside the oval
      const dx = Math.max(620 - x, 0, x - 660), dy = Math.max(150 - y, 0, y - 640);
      expect((dx / hw) ** 2 + (dy / hh) ** 2).toBeGreaterThanOrEqual(1);
    });
    expect(Math.hypot(b.position.x - 300, b.position.y - 500)).toBeLessThan(40);
  });

  it('flutters by a wall without its wings going in, starting near it', () => {
    // a wall at x 160–176, the bat's left wing tip just clear of it (as in level 13)
    const wall = Bodies.rectangle(168, 320, 16, 320, { isStatic: true });
    const b = homer(240, 256);
    const { halfWidth: hw } = batOutline;
    run([b], new HomingField(), [wall], { x: 1000, y: 300 }, 60 * 10, (bat) => {
      expect(bat.position.x - hw).toBeGreaterThanOrEqual(176);
    }, false);
  });

  it('keeps apart from the other bats', () => {
    const bats = [homer(1000, 200), homer(1000, 300), homer(1000, 400)];
    const field = new HomingField();
    run(bats, field, [], { x: 300, y: 300 }, 60 * 20);
    for (const a of bats)
      for (const o of bats) if (a !== o) expect(Math.hypot(a.position.x - o.position.x, a.position.y - o.position.y)).toBeGreaterThan(70);
  });

  it('hangs where it is with no bird to go for', () => {
    const b = homer(500, 300);
    run([b], new HomingField(), [], { x: 0, y: 0 }, 0);
    const field = new HomingField();
    field.update([], null);
    for (let i = 0; i < 60; i++) b.step(STEP_MS, { field, others: [], seesBird: true });
    expect(b.position).toEqual({ x: 500, y: 300 });
  });

  it('flutters about where it started till it sees the bird', () => {
    const b = homer(900, 300);
    let far = 0;
    run([b], new HomingField(), [], { x: 200, y: 300 }, 60 * 20, (bat) => {
      far = Math.max(far, Math.hypot(bat.position.x - 900, bat.position.y - 300));
    }, false);
    expect(b.chasing).toBe(false);
    // it moves, but stays about its start
    expect(far).toBeGreaterThan(10);
    expect(far).toBeLessThan(3 * config.bat.homingIdleRadius);
  });

  it('once it has seen the bird, goes for it even out of sight', () => {
    const b = homer(900, 300);
    const field = new HomingField();
    run([b], field, [], { x: 200, y: 300 }, 1);
    expect(b.chasing).toBe(true);
    run([b], field, [], { x: 200, y: 300 }, 60 * 20, undefined, false);
    expect(Math.hypot(b.position.x - 200, b.position.y - 300)).toBeLessThan(40);
  });
});

describe('a homing bat\'s sight', () => {
  it('is blocked by static bodies only', () => {
    const wall = Bodies.rectangle(500, 300, 40, 200, { isStatic: true });
    const crate = Bodies.rectangle(500, 300, 40, 200);
    expect(inSight([wall], { x: 300, y: 300 }, { x: 700, y: 300 })).toBe(false);
    expect(inSight([crate], { x: 300, y: 300 }, { x: 700, y: 300 })).toBe(true);
    // over the top of the wall
    expect(inSight([wall], { x: 300, y: 150 }, { x: 700, y: 150 })).toBe(true);
  });
});
