import Matter from 'matter-js';

export const { Engine, Bodies, Body, Common, Composite, Constraint, Events, Query, Sleeping, Vertices } = Matter;
export type MBody = Matter.Body;
export type MConstraint = Matter.Constraint;
export type MEngine = Matter.Engine;
export type MPair = Matter.Pair;

/** Fixed physics step (ms). */
export const STEP_MS = 1000 / 60;

/** Matter.js forces are in mass·px/ms²; convert from an acceleration in px/s². */
export const forceFor = (body: MBody, accelPxPerS2: number) => (body.mass * accelPxPerS2) / 1e6;

/** Bodies in this group never collide with each other (bird and its poo). */
export const BIRD_GROUP = -1;

/**
 * Collision categories. Everything is in Matter's default one (1) but the level's movable bodies (crates) and the poos.
 * The characters are solid only to what their mask names: crates bounce off a villain (not a ghost), bat or dragon and the poos that
 * splat on it hit it, while the bird, terrain and (for villains and bats) a bat's poo go through.
 */
export const CRATE = 0x0002, BIRD_POO = 0x0004, BAT_POO = 0x0008;

/**
 * Makes the static `body` a character's: crates bounce off it (by `bounce`, a restitution) and `hitBy` (categories) hits it.
 * One that isn't `solid` (a ghost) crates go through too. The restitution is set here, not as an option: Matter zeroes
 * a static body's as it's made.
 */
export function characterBody(body: MBody, bounce: number, hitBy: number, solid = true): MBody {
  body.restitution = bounce;
  body.collisionFilter.mask = (solid ? CRATE : 0) | hitBy;
  return body;
}

type Point = { x: number; y: number };

/** Squared distance from (px, py) to the segment a–b. */
const distSqToSegment = (px: number, py: number, a: Point, b: Point) => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / (dx * dx + dy * dy)));
  return (px - a.x - t * dx) ** 2 + (py - a.y - t * dy) ** 2;
};

/** Whether a circle at (cx, cy) with radius `r` overlaps the convex polygon `vs`. */
export const circleTouches = (vs: Point[], cx: number, cy: number, r: number) =>
  Vertices.contains(vs as Matter.Vector[], { x: cx, y: cy }) || vs.some((v, i) => distSqToSegment(cx, cy, v, vs[(i + 1) % vs.length]) < r * r);
