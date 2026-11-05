import { batOutline } from '../characters/bat';
import { config, WORLD } from '../config';
import { Query, type MBody } from './physics';

/**
 * what a grid cell is to a homing bat (its centre there): open sky, near something (passable, but avoided), too near
 * something (its wings would be in it), or inside something
 */
const OPEN = 0, NEAR = 1, BLOCKED = 2, SOLID = 3;
/** how much more a step through a NEAR cell costs than one through open sky */
const NEAR_COST = 6;
/**
 * ...and through a BLOCKED one: a bat can't fly there, but the way may have to go through some, to a bird by a wall
 * or on the ground; it gets as near as its wings let it
 */
const BLOCKED_COST = 40;
/** how far (px) inside a cell its corners are looked at */
const EDGE = 0.5;
/** how many cells ahead along its way a bat looks for one it can fly straight to */
const LOOKAHEAD = 8;

type Point = { x: number; y: number };

/**
 * Can `a` see `b`: is the line between them clear of the static ones of `bodies` (terrain, a closed door)?
 * Movable bodies, actors and coins don't get in the way.
 */
export function inSight(bodies: MBody[], a: Point, b: Point): boolean {
  return Query.ray(bodies.filter((body) => body.isStatic), a, b).length === 0;
}

/**
 * The way to the bird, for the bats without a route (homing bats): a grid over the world, each cell holding how far it is
 * from the bird going round the level's bodies (Dijkstra, keeping clear of them where it can). `update` redraws it — the
 * bodies may have moved, and the bird surely has — and `way` says which way a bat at a point should fly.
 */
export class HomingField {
  readonly cell = config.bat.homingCell;
  readonly cols = Math.ceil(WORLD.width / this.cell);
  readonly rows = Math.ceil(WORLD.height / this.cell);
  private kind = new Uint8Array(this.cols * this.rows);
  private dist = new Float64Array(this.cols * this.rows);
  private bird: Point | null = null;

  /** Redraws the field around `bodies` (the level's), towards `bird` (null: no bird to go for). */
  update(bodies: MBody[], bird: Point | null) {
    this.bird = bird;
    this.markObstacles(bodies);
    this.dist.fill(Infinity);
    if (bird) this.spread(this.index(bird.x, bird.y));
  }

  /**
   * Which way (a unit vector) a bat at `p` should fly to get to the bird: straight at it when nothing's in between,
   * else to the furthest cell along its way it can see; null when there's no bird or no way to it.
   */
  way(p: Point): Point | null {
    const bird = this.bird;
    if (!bird) return null;
    if (this.clear(p, bird, false)) return unit(bird.x - p.x, bird.y - p.y);
    let at = this.index(p.x, p.y);
    if (!Number.isFinite(this.dist[at])) return unit(bird.x - p.x, bird.y - p.y);
    // out in the open, it keeps out of the NEAR cells on its shortcuts; already near something, it just has to get out
    const strict = this.kind[at] === OPEN;
    let aim: Point | null = null;
    for (let i = 0; i < LOOKAHEAD; i++) {
      const next = this.downhill(at);
      if (next === at) break;
      const c = this.centre(next);
      if (aim && !this.clear(p, c, strict)) break;
      aim = c;
      at = next;
    }
    return aim ? unit(aim.x - p.x, aim.y - p.y) : null;
  }

  /**
   * Would a bat at `p` be (wings and all, see `batOutline`) in one of the bodies, under the ground, or off the world?
   */
  blocked(p: Point) {
    return this.overlap(p) > 0;
  }

  /**
   * How far a bat at `p` is in one of the bodies, under the ground, or off the world: 0 not at all, up to 1 (and past it,
   * off the world) its centre in it. A bat already in something can tell which way gets it out.
   */
  overlap(p: Point): number {
    const { halfWidth: hw, halfHeight: hh } = batOutline;
    if (p.y >= WORLD.height) return 1;
    // the world's edges, as walls
    let worst = Math.max(0, 1 - (Math.max(0, p.x) / hw) ** 2, 1 - (Math.max(0, WORLD.width - p.x) / hw) ** 2, 1 - (Math.max(0, p.y) / hh) ** 2);
    const { cell, cols, rows, kind } = this;
    const c0 = Math.max(0, Math.floor((p.x - hw) / cell)), c1 = Math.min(cols - 1, Math.floor((p.x + hw) / cell));
    const r0 = Math.max(0, Math.floor((p.y - hh) / cell)), r1 = Math.min(rows - 1, Math.floor((p.y + hh) / cell));
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        if (kind[r * cols + c] !== SOLID) continue;
        // the cell's nearest point to `p`, inside the oval?
        const dx = Math.max(c * cell - p.x, 0, p.x - (c + 1) * cell), dy = Math.max(r * cell - p.y, 0, p.y - (r + 1) * cell);
        worst = Math.max(worst, 1 - (dx / hw) ** 2 - (dy / hh) ** 2);
      }
    return worst;
  }

  private markObstacles(bodies: MBody[]) {
    const { cell, cols, rows, kind } = this;
    kind.fill(OPEN);
    const groundRow = Math.floor(WORLD.groundY / cell);
    for (let r = groundRow; r < rows; r++) kind.fill(SOLID, r * cols, (r + 1) * cols);
    for (const b of bodies) {
      const c0 = Math.max(0, Math.floor(b.bounds.min.x / cell)), c1 = Math.min(cols - 1, Math.floor(b.bounds.max.x / cell));
      const r0 = Math.max(0, Math.floor(b.bounds.min.y / cell)), r1 = Math.min(rows - 1, Math.floor(b.bounds.max.y / cell));
      for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++) {
          // a thin wall can miss every cell's centre, so a cell's corners count too: just inside it, or a body only
          // touching the cell's edge would count, and every wall would be a cell thicker
          const x = c * cell + EDGE, y = r * cell + EDGE, far = cell - 2 * EDGE;
          const corners = [{ x: c * cell + cell / 2, y: r * cell + cell / 2 }, { x, y }, { x: x + far, y }, { x, y: y + far }, { x: x + far, y: y + far }];
          if (corners.some((pt) => Query.point([b], pt).length)) kind[r * cols + c] = SOLID;
        }
    }
    // where its wings won't fit, its centre at the cell's
    for (let i = 0; i < kind.length; i++) if (kind[i] !== SOLID && this.blocked(this.centre(i))) kind[i] = BLOCKED;
    // the bat's clearance beyond its wings, round them and inside the world's edges
    const reach = Math.ceil(config.bat.homingClearance / cell);
    const blocked = kind.slice();
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (blocked[i] !== OPEN) continue;
        search: for (let dr = -reach; dr <= reach; dr++)
          for (let dc = -reach; dc <= reach; dc++) {
            const rr = r + dr, cc = c + dc;
            if (dr * dr + dc * dc > reach * reach || rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
            if (blocked[rr * cols + cc] >= BLOCKED) {
              kind[i] = NEAR;
              break search;
            }
          }
      }
  }

  /** Dijkstra from the bird's cell (which counts as open, wherever the bird is), 8 ways, never into a SOLID cell. */
  private spread(from: number) {
    const { cols, rows, kind, dist } = this;
    const heap = new MinHeap();
    dist[from] = 0;
    heap.push(from, 0);
    while (heap.size) {
      const [i, d] = heap.pop();
      if (d > dist[i]) continue;
      const r = Math.floor(i / cols), c = i % cols;
      for (const [dc, dr, len] of STEPS) {
        const cc = c + dc, rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
        const j = rr * cols + cc;
        if (kind[j] === SOLID) continue;
        // no cutting a solid corner diagonally
        if (dc && dr && (kind[r * cols + cc] === SOLID || kind[rr * cols + c] === SOLID)) continue;
        const nd = d + len * (kind[j] === BLOCKED ? BLOCKED_COST : kind[j] === NEAR ? NEAR_COST : 1);
        if (nd < dist[j]) {
          dist[j] = nd;
          heap.push(j, nd);
        }
      }
    }
  }

  /** The neighbouring cell nearest the bird (`i` itself when none is nearer). */
  private downhill(i: number): number {
    const { cols, rows, dist } = this;
    const r = Math.floor(i / cols), c = i % cols;
    let best = i;
    for (const [dc, dr] of STEPS) {
      const cc = c + dc, rr = r + dr;
      if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
      const j = rr * cols + cc;
      if (dist[j] < dist[best]) best = j;
    }
    return best;
  }

  /** Can a bat fly straight from `a` to `b` without its wings going into anything (nor its centre into a NEAR cell, if `strict`)? */
  private clear(a: Point, b: Point, strict: boolean) {
    const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (this.cell / 2));
    for (let k = 1; k < n; k++) {
      const x = a.x + ((b.x - a.x) * k) / n, y = a.y + ((b.y - a.y) * k) / n;
      if (this.blocked({ x, y })) return false;
      if (strict && this.kind[this.index(x, y)] === NEAR) return false;
    }
    return true;
  }

  private index(x: number, y: number) {
    const c = Math.min(this.cols - 1, Math.max(0, Math.floor(x / this.cell)));
    const r = Math.min(this.rows - 1, Math.max(0, Math.floor(y / this.cell)));
    return r * this.cols + c;
  }

  private centre(i: number): Point {
    return { x: ((i % this.cols) + 0.5) * this.cell, y: (Math.floor(i / this.cols) + 0.5) * this.cell };
  }
}

/** the 8 ways out of a cell: [dx, dy, length] */
const STEPS: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

const unit = (x: number, y: number): Point | null => {
  const len = Math.hypot(x, y);
  return len > 1e-6 ? { x: x / len, y: y / len } : null;
};

/** A binary min-heap of (item, key). */
class MinHeap {
  private items: number[] = [];
  private keys: number[] = [];

  get size() {
    return this.items.length;
  }

  push(item: number, key: number) {
    const { items, keys } = this;
    let i = items.length;
    items.push(item);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      items[i] = items[p];
      keys[i] = keys[p];
      i = p;
    }
    items[i] = item;
    keys[i] = key;
  }

  pop(): [number, number] {
    const { items, keys } = this;
    const top: [number, number] = [items[0], keys[0]];
    const item = items.pop()!, key = keys.pop()!;
    const n = items.length;
    if (n) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i, mk = key;
        if (l < n && keys[l] < mk) (m = l), (mk = keys[l]);
        if (r < n && keys[r] < mk) (m = r), (mk = keys[r]);
        if (m === i) break;
        items[i] = items[m];
        keys[i] = keys[m];
        i = m;
      }
      items[i] = item;
      keys[i] = key;
    }
    return top;
  }
}
