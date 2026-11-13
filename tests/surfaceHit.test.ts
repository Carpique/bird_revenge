import { describe, expect, it } from 'vitest';
import { Bodies } from '../src/game/physics';
import { surfaceHit } from '../src/game/surfaceHit';

describe('surfaceHit', () => {
  // a shelf from x 0 to 200, y 100 to 116
  const shelf = Bodies.rectangle(100, 108, 200, 16, { isStatic: true });

  it('finds the underside of a shelf hit from below, with the normal pointing down', () => {
    const hit = surfaceHit([shelf], { x: 50, y: 120 }, { x: 52, y: 114 });
    expect(hit?.body).toBe(shelf);
    expect(hit?.y).toBeCloseTo(116);
    expect(hit?.x).toBeCloseTo(50 + (2 * 4) / 6);
    expect(hit?.normal.x).toBeCloseTo(0);
    expect(hit?.normal.y).toBeCloseTo(1);
  });

  it('finds the top of a shelf hit from above, with the normal pointing up', () => {
    const hit = surfaceHit([shelf], { x: 50, y: 97 }, { x: 50, y: 102 });
    expect(hit?.y).toBeCloseTo(100);
    expect(hit?.normal.y).toBeCloseTo(-1);
  });

  it('finds the side it came in by when the step cuts a corner', () => {
    const hit = surfaceHit([shelf], { x: -2, y: 113 }, { x: 2, y: 118 });
    expect(hit?.x).toBeCloseTo(0);
    expect(hit?.normal.x).toBeCloseTo(-1);
  });

  it('is null when nothing is in the way', () => {
    expect(surfaceHit([shelf], { x: 50, y: 130 }, { x: 52, y: 124 })).toBeNull();
  });
});
