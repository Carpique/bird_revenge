import type { MBody } from './physics';

type Point = { x: number; y: number };

/** Where something moving in a straight line first meets a body: the point, and the surface's normal there (unit, pointing back out at it). */
export interface SurfaceHit {
  body: MBody;
  x: number;
  y: number;
  normal: Point;
}

/** The first of the `bodies`' edges the way from `from` to `to` crosses, or null when it crosses none. */
export function surfaceHit(bodies: readonly MBody[], from: Point, to: Point): SurfaceHit | null {
  const dx = to.x - from.x, dy = to.y - from.y;
  let best: SurfaceHit | null = null;
  let bestT = Infinity;
  for (const body of bodies) {
    // a compound body's own vertices are its hull: its parts have the real edges
    for (const part of body.parts.length > 1 ? body.parts.slice(1) : [body]) {
      const vs = part.vertices;
      for (let i = 0; i < vs.length; i++) {
        const a = vs[i], b = vs[(i + 1) % vs.length];
        const ex = b.x - a.x, ey = b.y - a.y;
        const cross = dx * ey - dy * ex;
        if (cross === 0) continue;
        const t = ((a.x - from.x) * ey - (a.y - from.y) * ex) / cross;
        const u = ((a.x - from.x) * dy - (a.y - from.y) * dx) / cross;
        if (t < 0 || t > 1 || u < 0 || u > 1 || t >= bestT) continue;
        // the edge's normal, on the side it came from
        const len = Math.hypot(ex, ey), side = cross > 0 ? -1 : 1;
        bestT = t;
        best = { body, x: from.x + dx * t, y: from.y + dy * t, normal: { x: (side * ey) / len, y: (-side * ex) / len } };
      }
    }
  }
  return best;
}
