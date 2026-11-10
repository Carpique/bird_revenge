import { describe, expect, it } from 'vitest';
import { config } from '../../src/config';
import { STEP_MS } from '../../src/game/physics';
import { fly, jolts } from './flight';
import { allRecordings, simulate, type Tick } from './harness';

// the poses, not continuous steering (the default): what these tests measure
config.pointing.continuous = false;

/**
 * The bird's motion on recordings of real play (black-box dumps): the full pose pipeline's controls each tick,
 * flown with Matter.js (`flight.ts`).
 */

const dumps = allRecordings().filter((r) => r.rec.level === 'black-box');

/** ms of ticks descending (a lowered tilted T) */
const descendingMs = (ticks: Tick[]) => ticks.filter((k) => k.mode === 'drift' && k.sink > 0).length * STEP_MS;

describe('motion on recordings of play', () => {
  it('there are recordings of play', () => {
    expect(dumps.length).toBeGreaterThan(0);
  });

  for (const r of dumps) {
    it(`${r.name}: no jolts (accel ${config.pointing.accel}; at 3600 there were 8-13 per recording)`, () => {
      const ticks = simulate(r, r.frames, { startState: 'playing' }).ticks.filter((k) => k.state === 'playing');
      expect(jolts(fly(ticks))).toBe(0);
    });
  }

  it('the diagonal descent: seconds of it where a lowered tilted T was held, next to none in the other recordings', () => {
    const ms: Record<string, number> = {};
    for (const r of dumps) ms[r.name] = descendingMs(simulate(r, r.frames, { startState: 'playing' }).ticks);
    console.log(`descending ms: ${JSON.stringify(Object.fromEntries(Object.entries(ms).map(([k, v]) => [k, Math.round(v)])))}`);
    if ('2026-11-09-gra-po-strojeniu' in ms) expect(ms['2026-11-09-gra-po-strojeniu']).toBeGreaterThan(3000);
    for (const name of ['2026-11-09-gra', '2026-11-09-trening']) if (name in ms) expect(ms[name]).toBeLessThan(1000);
  });

  it('the descent starts and stops a handful of times, not flickering', () => {
    for (const r of dumps) {
      const ticks = simulate(r, r.frames, { startState: 'playing' }).ticks;
      let starts = 0;
      for (let i = 1; i < ticks.length; i++) if (ticks[i].sink > 0 && !(ticks[i - 1].sink > 0)) starts++;
      expect(starts, r.name).toBeLessThanOrEqual(20);
    }
  });
});
