import { describe, expect, it } from 'vitest';
import { capFrameRate } from '../src/render/frameCap';

/** How many of `refreshes` animation frames at `hz` (with `jitter` ms of alternating noise) run the ticker. */
function framesRun(hz: number, refreshes: number, jitter = 0) {
  const runs: number[] = [];
  const ticker = { update: (t?: number) => void runs.push(t!) };
  capFrameRate(ticker, 60);
  for (let i = 0; i < refreshes; i++) ticker.update(1000 + (i * 1000) / hz + (i % 2 ? jitter : -jitter));
  return runs;
}

describe('capFrameRate', () => {
  it('runs every other refresh at 120 Hz', () => {
    const runs = framesRun(120, 240);
    expect(runs.length).toBe(120);
    for (let i = 1; i < runs.length; i++) expect(runs[i] - runs[i - 1]).toBeCloseTo(1000 / 60, 5);
  });

  it('runs every refresh at 60 Hz, also with jitter', () => {
    expect(framesRun(60, 120).length).toBe(120);
    expect(framesRun(60, 120, 0.4).length).toBe(120);
  });

  it('averages 60 fps at 144 Hz', () => {
    expect(framesRun(144, 144).length).toBeGreaterThanOrEqual(59);
    expect(framesRun(144, 144).length).toBeLessThanOrEqual(61);
  });

  it('runs every refresh below 60 Hz', () => {
    expect(framesRun(30, 60).length).toBe(60);
  });

  it('runs the first frame at once and does not catch up after a hitch', () => {
    const runs: number[] = [];
    const ticker = { update: (t?: number) => void runs.push(t!) };
    capFrameRate(ticker, 60);
    ticker.update(0);
    ticker.update(500); // a hitch
    ticker.update(508.3);
    ticker.update(516.7);
    expect(runs).toEqual([0, 500, 516.7]);
  });

  it('returns the uncapped update', () => {
    const runs: number[] = [];
    const ticker = { update: (t?: number) => void runs.push(t!) };
    const now = capFrameRate(ticker, 60);
    ticker.update(0);
    now(1);
    expect(runs).toEqual([0, 1]);
  });
});
