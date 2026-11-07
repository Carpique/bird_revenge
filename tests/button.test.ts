import { describe, expect, it } from 'vitest';
import { Button } from '../src/game/Button';
import type { ButtonDef } from '../src/level/types';

const button = (duration: number) =>
  new Button({ id: 1, x0: 0, x1: 10, y0: 0, y1: 10, target: 2, action: 'open', duration } satisfies ButtonDef);

/** Press, let go, and record the ms (after letting go) at which each blink starts, stepping 1 ms at a time. */
function blinkStarts(duration: number): number[] {
  const b = button(duration);
  b.step(true, 1);
  const starts: number[] = [];
  let was = false;
  for (let t = 1; b.active; t++) {
    b.step(false, 1);
    if (b.blinkBack && !was) starts.push(t);
    was = b.blinkBack;
  }
  return starts;
}

describe('a button about to wear off', () => {
  it("doesn't blink while pressed or when it lasts for good", () => {
    const b = button(3);
    b.step(true, 1);
    expect(b.blinkBack).toBe(false);
    const forGood = button(0);
    forGood.step(true, 1);
    forGood.step(false, 1);
    expect(forGood.blinkBack).toBe(false);
  });

  it('blinks 4 times a second for its last 2 s', () => {
    expect(blinkStarts(5)).toEqual([3000, 3250, 3500, 3750, 4000, 4250, 4500, 4750]);
  });

  it('blinks for the second half of a shorter time, as many times, faster', () => {
    expect(blinkStarts(1)).toEqual([500, 563, 625, 688, 750, 813, 875, 938]);
  });
});
