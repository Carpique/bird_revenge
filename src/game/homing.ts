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
 * Can `a` see `b`: is the line between them clear of `bodies` (the level's: terrain, a closed door, crates)?
 * Actors and coins don't get in the way.
 */
export function inSight(bodies: MBody[], a: Point, b: Point): boolean {
  return Query.ray(bodies, a, b).length === 0;
}

/**
 * The way to the bird, for the bats without a route (homing bats): a grid over the level, each cell holding how far it is
 * from the bird going round the level's bodies (Dijkstra, keeping clear of them where it can). `update` redraws it — the
 * bodies may have moved, and the bird surely has — and `way` says which way a bat at a point should fly.
 */
export class HomingField {
  readonly cell: number;
  readonly cols: number;
  readonly rows: number;
  private kind: Uint8Array;
  private dist: Float64Array;
  private bird: Point | null = null;
  /** the Dijkstra's queue, kept from one `update` to the next */
  private heap = new MinHeap();
  /** half-size of the oval the one finding its way fits in (a bat: `batOutline`) */
  private outline: { halfWidth: number; halfHeight: number };
  /** how far (px) beyond its outline it keeps from things where it can */
  private clearance: number;

  /**
   * `width`: the level's. `opts`: for something other than a bat (a fly swarm): its outline, clearance and grid cell
   * size; the bat's (`batOutline`, `config.bat`) when not given.
   */
  constructor(
    private width = WORLD.width,
    opts: { outline?: { halfWidth: number; halfHeight: number }; clearance?: number; cell?: number } = {},
  ) {
    this.cell = opts.cell ?? config.bat.homingCell;
    this.outline = opts.outline ?? batOutline;
    this.clearance = opts.clearance ?? config.bat.homingClearance;
    this.rows = Math.ceil(WORLD.height / this.cell);
    this.cols = Math.ceil(width / this.cell);
    this.kind = new Uint8Array(this.cols * this.rows);
    this.dist = new Float64Array(this.cols * this.rows);
  }

  /** Redraws the field around `bodies` (the level's), towards `bird` (null: no bird to go for; or anything else to go to). */
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
    const { halfWidth: hw, halfHeight: hh } = this.outline;
    if (p.y >= WORLD.height) return 1;
    // the world's edges, as walls
    let worst = Math.max(0, 1 - (Math.max(0, p.x) / hw) ** 2, 1 - (Math.max(0, this.width - p.x) / hw) ** 2, 1 - (Math.max(0, p.y) / hh) ** 2);
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
    this.markBlocked();
    // the bat's clearance beyond its wings, round them and inside the world's edges
    const reach = Math.ceil(this.clearance / cell);
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

  /**
   * Marks BLOCKED the cells (not SOLID) a bat with its centre at theirs would be in something from (see `blocked`): the
   * same cells as `blocked(centre)` says, but worked out from the SOLID cells outwards rather than looking round every
   * cell, and only from those at the edge of something (next to one that isn't SOLID): any cell a SOLID one reaches, one
   * at its edge reaches too, nearer it, on the straight line between them.
   */
  private markBlocked() {
    const { cell, cols, rows, kind } = this;
    const { halfWidth: hw, halfHeight: hh } = this.outline;
    // the world's edges, as walls (as in `overlap`): a centre nearer one than the oval reaches
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (kind[i] === SOLID) continue;
        const x = (c + 0.5) * cell, y = (r + 0.5) * cell;
        if (x < hw || this.width - x < hw || y < hh) kind[i] = BLOCKED;
      }
    // which cells round a SOLID one it reaches: those whose centre's oval its square is in (its nearest point to the centre)
    const stencil = this.blockStencil();
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        if (kind[r * cols + c] !== SOLID || !this.atEdge(r, c)) continue;
        for (const [dc, dr] of stencil) {
          const rr = r + dr, cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
          const j = rr * cols + cc;
          if (kind[j] === OPEN) kind[j] = BLOCKED;
        }
      }
  }

  /** the offsets (cells) from a SOLID cell to the cells whose centre's oval takes in some of it */
  private blockStencil(): [number, number][] {
    const { cell } = this;
    const { halfWidth: hw, halfHeight: hh } = this.outline;
    const kc = Math.ceil(hw / cell) + 1, kr = Math.ceil(hh / cell) + 1;
    const out: [number, number][] = [];
    for (let dr = -kr; dr <= kr; dr++)
      for (let dc = -kc; dc <= kc; dc++) {
        // the SOLID cell's nearest point to the other cell's centre, as in `overlap`
        const dx = Math.max(0, (Math.abs(dc) - 0.5) * cell), dy = Math.max(0, (Math.abs(dr) - 0.5) * cell);
        if (1 - (dx / hw) ** 2 - (dy / hh) ** 2 > 0) out.push([dc, dr]);
      }
    return out;
  }

  /** Is the SOLID cell at (r, c) next to (8 ways) one that isn't? */
  private atEdge(r: number, c: number) {
    const { cols, rows, kind } = this;
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && cc >= 0 && rr < rows && cc < cols && kind[rr * cols + cc] !== SOLID) return true;
      }
    return false;
  }

  /** Dijkstra from the bird's cell (which counts as open, wherever the bird is), 8 ways, never into a SOLID cell. */
  private spread(from: number) {
    const { cols, rows, kind, dist } = this;
    const heap = this.heap;
    heap.clear();
    dist[from] = 0;
    heap.push(from, 0);
    while (heap.size) {
      const i = heap.pop(), d = heap.poppedKey;
      if (d > dist[i]) continue;
      const r = Math.floor(i / cols), c = i % cols;
      for (let k = 0; k < STEPS.length; k++) {
        const step = STEPS[k], dc = step[0], dr = step[1], len = step[2];
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

/** A binary min-heap of (item, key): typed arrays, grown as needed and kept, so a search allocates nothing. */
class MinHeap {
  private items = new Int32Array(1024);
  private keys = new Float64Array(1024);
  size = 0;
  /** the key of the item `pop` last took */
  poppedKey = 0;

  clear() {
    this.size = 0;
  }

  push(item: number, key: number) {
    if (this.size === this.items.length) {
      const items = new Int32Array(this.size * 2), keys = new Float64Array(this.size * 2);
      items.set(this.items);
      keys.set(this.keys);
      this.items = items;
      this.keys = keys;
    }
    const { items, keys } = this;
    let i = this.size++;
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

  /** Takes the item with the smallest key (its key: `poppedKey`). */
  pop(): number {
    const { items, keys } = this;
    const top = items[0];
    this.poppedKey = keys[0];
    const n = --this.size;
    const item = items[n], key = keys[n];
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
