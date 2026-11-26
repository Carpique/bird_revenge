import Matter from 'matter-js';
import { config, WORLD } from '../config';
import { Bodies, Body, Query, type MBody } from './physics';

const { Bounds, Collision } = Matter;

/**
 * what a grid cell is to a hunter (its centre there): open sky, near something (passable, but avoided), too near
 * something (its oval would be in it), or inside something
 */
const OPEN = 0, NEAR = 1, BLOCKED = 2, SOLID = 3;
/** how much more a step through a NEAR cell costs than one through open sky */
const NEAR_COST = 6;
/**
 * ...and through a BLOCKED one: a hunter can't go there, but the way may have to go through some, to a bird by a wall
 * or on the ground; it gets as near as its oval lets it
 */
const BLOCKED_COST = 40;
/** how far (px) inside a cell a body must reach for the cell to count as in it: one only touching its edge doesn't */
const EDGE = 0.5;
/** how many cells ahead along its way a hunter looks for one it can go straight to */
const LOOKAHEAD = 8;
/** a target's field nobody has asked for in this long (ms) is dropped */
const FORGET_MS = 2000;
/** how many sides the polygon has that stands in for the hunters' oval in the exact fit check */
const PROBE_SIDES = 16;

type Point = { x: number; y: number };

/** Something a hunter goes for: `id` names it (one field per id, shared by every hunter going for it), `at` is where it is now. */
export interface Target {
  id: object;
  at: Point;
}

/** The bird as a target: every hunter after the bird shares its field. */
export const BIRD: object = { name: 'bird' };

/** The oval every hunter (a homing bat, a fly swarm squeezed as far as it goes) finds its way and fits by: half its size each way (px). */
export const hunterOutline = () => ({ halfWidth: config.homing.width / 2, halfHeight: config.homing.height / 2 });

/** How deep an oval at a point is in things (px, 0: clear) and the way out of them (not a unit vector; zero: none). */
export interface Overlap {
  depth: number;
  ex: number;
  ey: number;
}

/**
 * Can `a` see `b`: is the line between them clear of `bodies` (the level's: terrain, a closed door, crates)?
 * Actors and coins don't get in the way.
 */
export function inSight(bodies: MBody[], a: Point, b: Point): boolean {
  return Query.ray(bodies, a, b).length === 0;
}

/**
 * How the hunters (homing bats and fly swarms) find their way round the level, all by the same rules: each is the same
 * oval (`config.homing`, `hunterOutline`).
 *
 * The way: a grid over the level (`config.homing.cell`) marking where the level's bodies are, and round them where the
 * oval won't fit and where it would come nearer them than `clearance`; and for each target a field over that grid, each
 * cell holding how far it is from the target going round them (Dijkstra, keeping clear of them where it can). `way` says
 * which way a hunter at a point should go. The grid is worked out again every `replanMs`, and so is each target's field,
 * when asked for: hunters going for the same target (the bird) share one.
 *
 * Moving: `mayMove` and `overlap` test the oval against the level's bodies as they are now (not the grid, which is up
 * to `replanMs` behind a moving crate): a hunter never goes into anything, and one already in something (a body moved
 * onto it) only out of it.
 *
 * `step` it every physics step, before the hunters, with the level's bodies.
 */
export class Navigation {
  readonly cell: number;
  readonly cols: number;
  readonly rows: number;
  private kind: Uint8Array;
  private outline: { halfWidth: number; halfHeight: number };
  private bodies: MBody[] = [];
  /** its clock (ms), and when the grid was last worked out */
  private now = 0;
  private gridAt = -Infinity;
  private fields = new Map<object, { dist: Float64Array; at: number; used: number }>();
  /** the Dijkstra's queue, kept from one search to the next */
  private heap = new MinHeap();
  /** the oval as a polygon round it, moved about to test where it fits */
  private probe: MBody;
  /** a cell's square (less `EDGE` all round), moved about to test which cells a body is in */
  private cellProbe: MBody;

  /** `width`: the level's. The oval and the cell size are read now: changing them takes a new level. */
  constructor(private width = WORLD.width) {
    this.cell = config.homing.cell;
    this.outline = hunterOutline();
    this.rows = Math.ceil(WORLD.height / this.cell);
    this.cols = Math.ceil(width / this.cell);
    this.kind = new Uint8Array(this.cols * this.rows);
    // a polygon round the oval (its sides touch it), so the oval is never in anything the polygon isn't
    const k = 1 / Math.cos(Math.PI / PROBE_SIDES), { halfWidth: hw, halfHeight: hh } = this.outline;
    const vertices = Array.from({ length: PROBE_SIDES }, (_, i) => {
      const a = ((i + 0.5) / PROBE_SIDES) * 2 * Math.PI;
      return { x: Math.cos(a) * hw * k, y: Math.sin(a) * hh * k };
    });
    this.probe = Bodies.fromVertices(0, 0, [vertices]);
    this.cellProbe = Bodies.rectangle(0, 0, this.cell - 2 * EDGE, this.cell - 2 * EDGE);
  }

  /** Each physics step, before the hunters move: the level's bodies now (terrain, crates, closed doors). */
  step(stepMs: number, bodies: MBody[]) {
    this.now += stepMs;
    this.bodies = bodies;
    for (const [id, f] of this.fields) if (this.now - f.used > FORGET_MS) this.fields.delete(id);
  }

  /**
   * Which way (a unit vector) a hunter at `p` should go to get to `target`: straight at it when nothing's in between,
   * else to the furthest cell along its way it can see; null when there's no target or no way to it.
   */
  way(p: Point, target: Target | null): Point | null {
    if (!target) return null;
    const to = target.at;
    const dist = this.field(target);
    if (this.clear(p, to, false)) return unit(to.x - p.x, to.y - p.y);
    let at = this.index(p.x, p.y);
    if (!Number.isFinite(dist[at])) return unit(to.x - p.x, to.y - p.y);
    // out in the open, it keeps out of the NEAR cells on its shortcuts; already near something, it just has to get out
    const strict = this.kind[at] === OPEN;
    let aim: Point | null = null;
    for (let i = 0; i < LOOKAHEAD; i++) {
      const next = this.downhill(dist, at);
      if (next === at) break;
      const c = this.centre(next);
      if (aim && !this.clear(p, c, strict)) break;
      aim = c;
      at = next;
    }
    return aim ? unit(aim.x - p.x, aim.y - p.y) : null;
  }

  /**
   * How deep the oval at (x, y) is in the level's bodies (but for `ignore`), the ground, or beyond the level's edges
   * and top, as they are now, and the way out.
   */
  overlap(x: number, y: number, ignore: readonly MBody[] = []): Overlap {
    const { halfWidth: hw, halfHeight: hh } = this.outline;
    let depth = 0, ex = 0, ey = 0;
    const add = (d: number, nx: number, ny: number) => {
      if (d <= 0) return;
      depth += d;
      ex += nx * d;
      ey += ny * d;
    };
    add(hw - x, 1, 0);
    add(x + hw - this.width, -1, 0);
    add(hh - y, 0, 1);
    add(y + hh - WORLD.groundY, 0, -1);
    const probe = this.probe;
    Body.setPosition(probe, { x, y });
    for (const b of this.bodies) {
      if (!Bounds.overlaps(b.bounds, probe.bounds) || ignore.includes(b)) continue;
      for (let i = b.parts.length === 1 ? 0 : 1; i < b.parts.length; i++) {
        const part = b.parts[i];
        if (!Bounds.overlaps(part.bounds, probe.bounds)) continue;
        const hit = Collision.collides(part, probe);
        if (!hit) continue;
        // the way out: along the collision's normal, away from the part
        const { x: nx, y: ny } = hit.normal;
        const s = nx * (x - part.position.x) + ny * (y - part.position.y) >= 0 ? 1 : -1;
        add(hit.depth, nx * s, ny * s);
      }
    }
    return { depth, ex, ey };
  }

  /** Is the oval at (x, y) clear of everything (but for `ignore`)? */
  fits(x: number, y: number, ignore: readonly MBody[] = []) {
    return this.overlap(x, y, ignore).depth === 0;
  }

  /**
   * May a hunter go from `from` to `to`? Clear where it is: only where it's clear too. Already in something (a crate
   * moved onto it, a beam swung into it): only out of it, never deeper, nor on through it.
   */
  mayMove(from: Point, to: Point, ignore: readonly MBody[] = []) {
    const now = this.overlap(from.x, from.y, ignore);
    if (now.depth === 0) return this.fits(to.x, to.y, ignore);
    if ((to.x - from.x) * now.ex + (to.y - from.y) * now.ey < 0) return false;
    return this.overlap(to.x, to.y, ignore).depth <= now.depth;
  }

  /** The distances to `target`, worked out again (and the grid with them) once they're `replanMs` old. */
  private field(target: Target): Float64Array {
    const every = config.homing.replanMs;
    if (this.now - this.gridAt >= every) {
      this.markObstacles();
      this.gridAt = this.now;
    }
    let f = this.fields.get(target.id);
    if (!f) this.fields.set(target.id, (f = { dist: new Float64Array(this.kind.length), at: -Infinity, used: this.now }));
    f.used = this.now;
    if (this.now - f.at >= every) {
      f.at = this.now;
      f.dist.fill(Infinity);
      this.spread(f.dist, this.index(target.at.x, target.at.y));
    }
    return f.dist;
  }

  /**
   * Would the oval at `p` be in one of the SOLID cells, under the ground, or off the world: the grid's view, for the
   * way (`way`), not for moving (`overlap`)?
   */
  private blocked(p: Point) {
    const { halfWidth: hw, halfHeight: hh } = this.outline;
    if (p.y >= WORLD.height || p.x < hw || this.width - p.x < hw || p.y < hh) return true;
    const { cell, cols, rows, kind } = this;
    const c0 = Math.max(0, Math.floor((p.x - hw) / cell)), c1 = Math.min(cols - 1, Math.floor((p.x + hw) / cell));
    const r0 = Math.max(0, Math.floor((p.y - hh) / cell)), r1 = Math.min(rows - 1, Math.floor((p.y + hh) / cell));
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        if (kind[r * cols + c] !== SOLID) continue;
        // the cell's nearest point to `p`, inside the oval?
        const dx = Math.max(c * cell - p.x, 0, p.x - (c + 1) * cell), dy = Math.max(r * cell - p.y, 0, p.y - (r + 1) * cell);
        if ((dx / hw) ** 2 + (dy / hh) ** 2 < 1) return true;
      }
    return false;
  }

  private markObstacles() {
    const { cell, cols, rows, kind } = this;
    kind.fill(OPEN);
    const groundRow = Math.floor(WORLD.groundY / cell);
    for (let r = groundRow; r < rows; r++) kind.fill(SOLID, r * cols, (r + 1) * cols);
    // a cell is SOLID when a body reaches into its square at all (not only its centre or corners: a thin beam can miss those)
    const probe = this.cellProbe;
    for (const b of this.bodies)
      for (let i = b.parts.length === 1 ? 0 : 1; i < b.parts.length; i++) {
        const part = b.parts[i];
        const c0 = Math.max(0, Math.floor(part.bounds.min.x / cell)), c1 = Math.min(cols - 1, Math.floor(part.bounds.max.x / cell));
        const r0 = Math.max(0, Math.floor(part.bounds.min.y / cell)), r1 = Math.min(rows - 1, Math.floor(part.bounds.max.y / cell));
        for (let r = r0; r <= r1; r++)
          for (let c = c0; c <= c1; c++) {
            const j = r * cols + c;
            if (kind[j] === SOLID) continue;
            Body.setPosition(probe, { x: (c + 0.5) * cell, y: (r + 0.5) * cell });
            if (Collision.collides(part, probe)) kind[j] = SOLID;
          }
      }
    this.markBlocked();
    // the clearance beyond the oval, round the bodies and inside the world's edges
    const reach = Math.ceil(config.homing.clearance / cell);
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
   * Marks BLOCKED the cells (not SOLID) the oval with its centre at theirs would be in something from (see `blocked`):
   * worked out from the SOLID cells outwards rather than looking round every cell, and only from those at the edge of
   * something (next to one that isn't SOLID): any cell a SOLID one reaches, one at its edge reaches too, nearer it, on the
   * straight line between them.
   */
  private markBlocked() {
    const { cell, cols, rows, kind } = this;
    const { halfWidth: hw, halfHeight: hh } = this.outline;
    // the world's edges, as walls (as in `blocked`): a centre nearer one than the oval reaches
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
        // the SOLID cell's nearest point to the other cell's centre, as in `blocked`
        const dx = Math.max(0, (Math.abs(dc) - 0.5) * cell), dy = Math.max(0, (Math.abs(dr) - 0.5) * cell);
        if ((dx / hw) ** 2 + (dy / hh) ** 2 < 1) out.push([dc, dr]);
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

  /** Dijkstra into `dist` from the target's cell (which counts as open, wherever the target is), 8 ways, never into a SOLID cell. */
  private spread(dist: Float64Array, from: number) {
    const { cols, rows, kind } = this;
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

  /** The neighbouring cell nearest the target (`i` itself when none is nearer). */
  private downhill(dist: Float64Array, i: number): number {
    const { cols, rows } = this;
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

  /** Can the oval go straight from `a` to `b` without going into anything (nor its centre into a NEAR cell, if `strict`), as the grid has it? */
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
