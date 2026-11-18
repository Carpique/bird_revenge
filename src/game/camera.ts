import { WORLD } from '../config';

/**
 * The camera of a level wider than the world (a scrolling level): `scroll` is the level x at the world's left edge
 * (the 1280 px frame every level without scrolling fills), from 0 to the level's width less the world's.
 */

/** A level scrolls when it's wider than the world; the others stay as they are, whatever the screen. */
export const scrolls = (levelWidth: number) => levelWidth > WORLD.width;

const clamp = (scroll: number, levelWidth: number) => Math.max(0, Math.min(scroll, levelWidth - WORLD.width));

/** The scroll with `x` (the bird) in the middle of the screen, as far as the level's ends allow: where a level starts. */
export function centredOn(x: number, levelWidth: number): number {
  return clamp(x - WORLD.width / 2, levelWidth);
}

/**
 * The scroll following `x` (the bird): the screen is three zones side by side, a third of it each. In the middle one
 * the camera stays where it is; into the left or the right one it scrolls just enough to keep `x` at that zone's
 * edge, as far as the level's ends allow. `left`, `right`: the screen's edges in world px (`view`: wider than the
 * world on a screen wider than 16:9).
 */
export function follow(scroll: number, x: number, levelWidth: number, left = 0, right = WORLD.width): number {
  const third = (right - left) / 3;
  const lo = scroll + left + third, hi = scroll + right - third;
  if (x < lo) scroll -= lo - x;
  else if (x > hi) scroll += x - hi;
  return clamp(scroll, levelWidth);
}
