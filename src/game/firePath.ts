import { dragonMouth } from '../characters/dragon';
import type { DragonDef } from '../level/types';

/** A polyline the dragon's fire runs along, from its mouth: the points at distances along it, and how near a point is to it. */
export class FirePath {
  readonly points: [number, number][];
  readonly length: number;
  /** the distance along the path at each point */
  private readonly dist: number[] = [];

  constructor(points: [number, number][]) {
    // repeated points would make segments with no direction
    this.points = points.filter((p, i) => i === 0 || p[0] !== points[i - 1][0] || p[1] !== points[i - 1][1]);
    let d = 0;
    this.points.forEach((p, i) => {
      if (i) d += Math.hypot(p[0] - this.points[i - 1][0], p[1] - this.points[i - 1][1]);
      this.dist.push(d);
    });
    this.length = d;
  }

  /** The point `d` px along the path (kept on it), and the path's direction there (radians, y down). */
  pointAt(d: number): { x: number; y: number; angle: number } {
    const pts = this.points;
    if (pts.length < 2) return { x: pts[0][0], y: pts[0][1], angle: 0 };
    let i = 1;
    while (i < pts.length - 1 && this.dist[i] < d) i++;
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const t = Math.max(0, Math.min(1, (d - this.dist[i - 1]) / (this.dist[i] - this.dist[i - 1])));
    return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, angle: Math.atan2(by - ay, bx - ax) };
  }

  /** How far (x, y) is from the path's first `reach` px. */
  distanceTo(x: number, y: number, reach: number): number {
    let best = Infinity;
    for (let i = 1; i < this.points.length && this.dist[i - 1] < reach; i++) {
      const [ax, ay] = this.points[i - 1];
      // the segment, cut short where the reach ends
      const end = this.dist[i] <= reach ? this.points[i] : [this.pointAt(reach).x, this.pointAt(reach).y];
      const dx = end[0] - ax, dy = end[1] - ay, len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
      best = Math.min(best, Math.hypot(x - (ax + dx * t), y - (ay + dy * t)));
    }
    return best;
  }
}

/** Where a dragon's fire comes out (world px): just inside its jaws, which depend on the way it faces. */
export function mouthOf(def: DragonDef): [number, number] {
  return [def.x + (def.facing === 'right' ? 1 : -1) * dragonMouth.x, def.y + dragonMouth.y];
}

/**
 * The route of a dragon's fire: from its mouth, on to its `path` (from the path's end nearer the mouth), or without
 * one straight ahead `fireLength` px.
 */
export function fireRoute(def: DragonDef): FirePath {
  const mouth = mouthOf(def);
  if (!def.path) return new FirePath([mouth, [mouth[0] + (def.facing === 'right' ? 1 : -1) * def.fireLength, mouth[1]]]);
  const near = (p: [number, number]) => Math.hypot(p[0] - mouth[0], p[1] - mouth[1]);
  const path = near(def.path[0]) <= near(def.path[def.path.length - 1]) ? def.path : [...def.path].reverse();
  return new FirePath([mouth, ...path]);
}
