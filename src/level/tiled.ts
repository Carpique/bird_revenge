import { batDef } from '../characters/bat';
import { birdDef } from '../characters/bird';
import { coinDef } from '../characters/coin';
import type { Branch, ButtonAction, FriendKind, JointDef, LevelDef, Material, Shape, TimeOfDay, VillainKind } from './types';

/**
 * Loads a map saved by the Tiled editor (JSON, `.tmj`) into a `LevelDef`.
 * Only object layers are read; what an object becomes is set by its class (Tiled's "Class" field):
 *
 * | class     | Tiled shape                    | becomes                                   |
 * |-----------|--------------------------------|-------------------------------------------|
 * | Terrain   | rectangle, ellipse, polygon    | static body                               |
 * | Body      | rectangle, ellipse, polygon    | movable body                              |
 * | Branch    | polyline                       | one-way platform, one per segment         |
 * | Rope      | point                          | rope from the point to `body`             |
 * | Hinge     | point                          | `body` pinned at the point                |
 * | Villain   | tile, `path` a polyline        | a villain walking the `path`'s x range, starting where the tile's feet are, on what's under them; `kind` his look (villain, ghost) |
 * |           | or a polyline                  | the same, the polyline being the path, starting on its first point |
 * | Bat       | tile, `path` a polyline or polygon | a bat flying along `path`: there and back (polyline), round and round (polygon), from its point nearest the tile's centre |
 * |           | or a polyline, polygon         | the same, from its first point            |
 * |           | tile or point, no `path`       | a homing bat: no route, it goes for the bird, from the tile's centre / the point |
 * | Dragon    | tile, `path` a polyline or none | a dragon sitting where the tile's feet are, spitting fire `initialDelay` s into the level, then `throwDelay` s or so after each spit, for `flameDuration` s: from its mouth along `path`, or without one straight ahead `fireLength` px; the tile flipped horizontally: it faces left |
 * | Friend    | point, or a tile               | a friend to save, standing on the point / where the tile's feet are |
 * | Coin      | point, or a tile               | a coin to collect, centred on the point / the tile's image |
 * | BirdStart | point, or a tile               | where the bird starts: its centre / where the tile shows it |
 * | Button    | rectangle (unrotated)          | a button on the surface under its bottom edge, switching the Terrain `target` |
 *
 * Objects without a class are ignored (handy for notes and guides, and the paths of tiles); hidden layers and objects are skipped
 * (but a `path` can be on any layer).
 * The map itself can have the class Level (Tiled: Map > Map Properties > Class), whose fields set the level's own things:
 * `timeOfDay` (morning, afternoon, evening, night) picks the background. A plain custom property of the same name on the map works too.
 *
 * The tiles are in `icons.tsj`: the game's sprites at their size in the game, so things show in Tiled as they will in the game. A tile (image) object takes its tile's class and properties unless it has its own.
 */

export interface TiledProperty {
  name: string;
  type: string;
  value: unknown;
  propertytype?: string;
}

export interface TiledObject {
  id: number;
  name: string;
  /** the object's class (Tiled writes `type` for objects, `class` in some versions) */
  type?: string;
  class?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  visible: boolean;
  point?: boolean;
  ellipse?: boolean;
  polygon?: { x: number; y: number }[];
  polyline?: { x: number; y: number }[];
  gid?: number;
  properties?: TiledProperty[];
}

export interface TiledLayer {
  type: 'objectgroup' | 'tilelayer' | 'imagelayer' | 'group';
  name: string;
  visible: boolean;
  offsetx?: number;
  offsety?: number;
  objects?: TiledObject[];
  layers?: TiledLayer[];
}

/** A tileset: kept in its own file (`.tsj`, `source` in the map), or embedded in the map. */
export interface TiledTileset {
  /** where a tile object's position is on its image; `unspecified` = bottom left (for orthogonal maps) */
  objectalignment?: string;
  /** only the tiles that have something set, like a class */
  tiles?: { id: number; type?: string; class?: string; properties?: TiledProperty[] }[];
}

export interface TiledTilesetRef extends TiledTileset {
  firstgid: number;
  /** the tileset's file, relative to the map's; absent when it's embedded */
  source?: string;
}

export interface TiledMap {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  orientation: string;
  infinite: boolean;
  layers: TiledLayer[];
  tilesets?: TiledTilesetRef[];
  /** the map's class (Level) and its custom properties */
  class?: string;
  properties?: TiledProperty[];
}

/**
 * Each class's fields and their defaults. Tiled leaves a field out of the file while it has its default value,
 * so these must match the custom types in `src/levels/bird-revenge.tiled-project` (a test checks they do).
 * Object references are ids, 0 = none.
 */
export const CLASS_DEFAULTS = {
  Terrain: { friction: 0.6 },
  Body: { material: 'wood', density: 0, sleeping: false },
  Branch: {},
  Rope: { body: 0, to: 0, length: 0, stiffness: 1 },
  Hinge: { body: 0, to: 0, stiffness: 1 },
  Villain: { kind: 'villain', path: 0, throwDelay: 4 },
  Bat: { path: 0, speed: 2, pooDelay: 3 },
  Dragon: { path: 0, fireLength: 240, initialDelay: 0, throwDelay: 4, flameDuration: 1 },
  Friend: { kind: 'bunny' },
  BirdStart: {},
  Coin: {},
  Button: { target: 0, action: 'open', duration: 3 },
} as const;

/** The map's class (Level): its fields and their defaults, matching `bird-revenge.tiled-project` like `CLASS_DEFAULTS`. */
export const MAP_DEFAULTS = {
  Level: { timeOfDay: 'afternoon' },
} as const;

type ClassName = keyof typeof CLASS_DEFAULTS;
const TIMES_OF_DAY: readonly TimeOfDay[] = ['morning', 'afternoon', 'evening', 'night'];
const MATERIALS: readonly Material[] = ['wood', 'stone', 'rubber', 'ice'];
const FRIEND_KINDS: readonly FriendKind[] = ['bunny'];
const VILLAIN_KINDS: readonly VillainKind[] = ['villain', 'ghost'];
const BUTTON_ACTIONS: readonly ButtonAction[] = ['open', 'close'];

/**
 * The classes a tile object can have, and the point of the tile's image (as a fraction of its size) that is where the thing is.
 * The ones placed by their feet have their images cut at the feet (`tools/tiled-icons.mjs`).
 */
const TILE_POSITIONS: Partial<Record<ClassName, { x: number; y: number }>> = {
  Coin: coinDef.anchor,
  Villain: { x: 0.5, y: 1 },
  Bat: batDef.anchor,
  Dragon: { x: 0.5, y: 1 },
  Friend: { x: 0.5, y: 1 },
  BirdStart: birdDef.anchor,
};

/** the flag Tiled sets on a tile object's gid when it's flipped horizontally */
const FLIPPED_HORIZONTALLY = 0x80000000;

export class LevelError extends Error {}

/** `tilesets`: the tileset files the map's `tilesets` refer to, by their `source` as written in the map. */
export function parseTiledMap(name: string, map: TiledMap, tilesets: Record<string, TiledTileset> = {}): LevelDef {
  const problems: string[] = [];
  if (map.orientation !== 'orthogonal') problems.push(`orientation is "${map.orientation}"; use Orthogonal`);
  if (map.infinite) problems.push('the map is infinite; use a fixed-size map');
  if (map.class && !(map.class in MAP_DEFAULTS)) problems.push(`the map's class is "${map.class}"; use Level, or none`);
  const mapProps: Record<string, unknown> = { ...MAP_DEFAULTS.Level };
  for (const prop of map.properties ?? []) mapProps[prop.name] = prop.value;
  const timeOfDay = String(mapProps.timeOfDay) as TimeOfDay;
  if (!TIMES_OF_DAY.includes(timeOfDay)) problems.push(`unknown timeOfDay "${timeOfDay}"; use ${TIMES_OF_DAY.join(', ')}`);

  const level: LevelDef = {
    name,
    width: map.width * map.tilewidth,
    height: map.height * map.tileheight,
    birdStart: null,
    villains: [],
    bats: [],
    dragons: [],
    friends: [],
    coins: [],
    bodies: [],
    branches: [],
    joints: [],
    buttons: [],
    timeOfDay,
  };

  const tiles = tileLookup(map, tilesets);
  const objects = allObjects(map.layers);
  const visit = (layers: TiledLayer[], ox: number, oy: number) => {
    for (const layer of layers) {
      if (!layer.visible) continue;
      const lx = ox + (layer.offsetx ?? 0), ly = oy + (layer.offsety ?? 0);
      if (layer.type === 'group') visit(layer.layers ?? [], lx, ly);
      if (layer.type !== 'objectgroup') continue;
      for (const o of layer.objects ?? []) {
        if (!o.visible) continue;
        try {
          addObject(level, { ...o, x: o.x + lx, y: o.y + ly }, tiles, objects);
        } catch (e) {
          problems.push(`${describe(o)} on layer "${layer.name}": ${(e as Error).message}`);
        }
      }
    }
  };
  visit(map.layers, 0, 0);

  const ids = new Set(level.bodies.map((b) => b.id));
  for (const j of level.joints) {
    if (!ids.has(j.body)) problems.push(`a ${j.kind} at (${j.x}, ${j.y}) has no "body", or it isn't a Body or Terrain`);
    if (j.to !== null && !ids.has(j.to)) problems.push(`a ${j.kind} at (${j.x}, ${j.y}): its "to" isn't a Body or Terrain`);
  }
  const terrain = new Set(level.bodies.filter((b) => b.kind === 'terrain').map((b) => b.id));
  const actions = new Map<number, ButtonAction>();
  for (const b of level.buttons) {
    if (!terrain.has(b.target)) problems.push(`button ${b.id}: its "target" isn't a Terrain`);
    else if ((actions.get(b.target) ?? b.action) !== b.action) problems.push(`button ${b.id}: another button does the opposite to its target`);
    actions.set(b.target, b.action);
  }

  if (problems.length) throw new LevelError(`Level "${name}":\n- ${problems.join('\n- ')}`);
  return level;
}

function addObject(level: LevelDef, o: TiledObject, tiles: TileLookup, objects: Map<number, TiledObject>) {
  const tile = o.gid !== undefined ? tiles(o.gid) : null;
  const cls = o.type || o.class || tile?.cls;
  if (!cls) return;
  if (!(cls in CLASS_DEFAULTS)) throw new Error(`unknown class "${cls}"`);
  const at = TILE_POSITIONS[cls as ClassName];
  if (tile && !at) throw new Error(`only a ${Object.keys(TILE_POSITIONS).join(', ')} can be a tile (image) object; draw a shape`);
  const p = props(cls as ClassName, o, tile?.properties);
  /** where the thing is, for a tile object */
  const tilePos = () => tilePoint(o, tile!.alignment, at!);

  switch (cls as ClassName) {
    case 'Terrain':
      level.bodies.push({ kind: 'terrain', id: o.id, name: o.name, shape: shapeOf(o), friction: num(p.friction) });
      break;
    case 'Body': {
      const material = String(p.material) as Material;
      if (!MATERIALS.includes(material)) throw new Error(`unknown material "${material}"`);
      level.bodies.push({ kind: 'body', id: o.id, name: o.name, shape: shapeOf(o), material, density: num(p.density), sleeping: Boolean(p.sleeping) });
      break;
    }
    case 'Branch':
      if (!o.polyline) throw new Error('a Branch must be a polyline');
      level.branches.push(...branchesOf(o));
      break;
    case 'Rope':
    case 'Hinge': {
      requirePoint(o);
      const joint: JointDef = {
        kind: cls === 'Rope' ? 'rope' : 'hinge',
        x: o.x,
        y: o.y,
        body: num(p.body),
        to: num(p.to) || null,
        length: cls === 'Rope' ? num(p.length) : 0,
        stiffness: num(p.stiffness),
      };
      level.joints.push(joint);
      break;
    }
    case 'Villain': {
      const kind = String(p.kind) as VillainKind;
      if (!VILLAIN_KINDS.includes(kind)) throw new Error(`unknown villain kind "${kind}"`);
      const throwDelay = num(p.throwDelay);
      if (throwDelay < 0) throw new Error('"throwDelay" can\'t be negative (0 = never throws)');
      const pts = tile ? pathOf(objects, p.path, false).points : o.polyline && pointsOf(o, o.polyline);
      if (!pts) throw new Error('a Villain must be a polyline (his path), or a tile with a "path"');
      const xs = pts.map(([x]) => x);
      const x0 = Math.min(...xs), x1 = Math.max(...xs);
      if (x0 === x1) throw new Error('a Villain path needs some width');
      const [x, y] = tile ? tilePos() : pts[0];
      level.villains.push({ kind, x, y, path: { x0, x1 }, throwDelay });
      break;
    }
    case 'Bat': {
      const speed = num(p.speed), pooDelay = num(p.pooDelay);
      if (speed <= 0) throw new Error('"speed" must be more than 0');
      if (pooDelay < 0) throw new Error('"pooDelay" can\'t be negative (0 = never poos)');
      // a tile or point without a path: a homing bat
      if ((tile || o.point) && !num(p.path)) {
        const start = tile ? tilePos() : ([o.x, o.y] as [number, number]);
        level.bats.push({ route: [], loop: false, start, target: 0, speed, pooDelay });
        break;
      }
      const own = o.polyline ?? o.polygon;
      const path = tile ? pathOf(objects, p.path, true) : own && { points: pointsOf(o, own), loop: !o.polyline };
      if (!path || path.points.length < 2) throw new Error('a Bat must be a polyline or polygon (its route), a tile with or without a "path", or a point');
      const route = path.points;
      if (route.every(([x, y]) => x === route[0][0] && y === route[0][1])) throw new Error('a Bat route needs some length');
      const { start, target } = tile ? nearestOnRoute(route, path.loop, tilePos()) : { start: route[0], target: 1 };
      level.bats.push({ route, loop: path.loop, start, target, speed, pooDelay });
      break;
    }
    case 'Dragon': {
      if (!tile) throw new Error('a Dragon must be a tile');
      const fireLength = num(p.fireLength), initialDelay = num(p.initialDelay), throwDelay = num(p.throwDelay), flameDuration = num(p.flameDuration);
      const path = num(p.path) ? pathOf(objects, p.path, false).points : null;
      if (!path && fireLength <= 0) throw new Error('"fireLength" must be more than 0 (or give it a "path")');
      if (throwDelay < 0) throw new Error('"throwDelay" can\'t be negative (0 = never spits)');
      if (flameDuration < 0) throw new Error('"flameDuration" can\'t be negative');
      if (initialDelay < 0) throw new Error('"initialDelay" can\'t be negative');
      const [x, y] = tilePos();
      // Tiled's horizontal flip (X) turns it round
      const facing = o.gid! & FLIPPED_HORIZONTALLY ? 'left' : 'right';
      level.dragons.push({ x, y, facing, path, fireLength, initialDelay, throwDelay, flameDuration });
      break;
    }
    case 'Friend': {
      if (!tile) requirePoint(o);
      const kind = String(p.kind) as FriendKind;
      if (!FRIEND_KINDS.includes(kind)) throw new Error(`unknown friend kind "${kind}"`);
      const [x, y] = tile ? tilePos() : [o.x, o.y];
      level.friends.push({ kind, x, y });
      break;
    }
    case 'Button': {
      if (o.point || o.ellipse || o.polygon || o.polyline) throw new Error('a Button must be a rectangle');
      if (o.rotation) throw new Error("a Button can't be rotated");
      if (o.width <= 0 || o.height <= 0) throw new Error('has no size');
      const action = String(p.action) as ButtonAction;
      if (!BUTTON_ACTIONS.includes(action)) throw new Error(`unknown action "${action}"`);
      const duration = num(p.duration);
      if (duration < 0) throw new Error('"duration" can\'t be negative (0 = for good)');
      level.buttons.push({ id: o.id, x0: o.x, x1: o.x + o.width, y0: o.y, y1: o.y + o.height, target: num(p.target), action, duration });
      break;
    }
    case 'Coin':
      if (tile) {
        const [x, y] = tilePos();
        level.coins.push({ x, y });
      } else {
        requirePoint(o);
        level.coins.push({ x: o.x, y: o.y });
      }
      break;
    case 'BirdStart': {
      if (!tile) requirePoint(o);
      if (level.birdStart) throw new Error('there is more than one BirdStart');
      const [x, y] = tile ? tilePos() : [o.x, o.y];
      level.birdStart = { x, y };
      break;
    }
  }
}

/** The class's defaults overridden by its tile's properties (a tile object), then by the object's own. */
function props(cls: ClassName, o: TiledObject, tileProps: TiledProperty[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = { ...CLASS_DEFAULTS[cls] };
  for (const prop of [...tileProps, ...(o.properties ?? [])]) out[prop.name] = prop.value;
  return out;
}

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);

/** Rotate (x, y) by `a` radians, clockwise on screen (y down). */
const rotate = (x: number, y: number, a: number): [number, number] => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];

/**
 * Tiled positions a rectangle or ellipse by its top-left corner and a polygon by its first point's origin,
 * and rotates all of them (degrees, clockwise) around that corner / origin.
 */
function shapeOf(o: TiledObject): Shape {
  const a = ((o.rotation ?? 0) * Math.PI) / 180;
  if (o.polygon) {
    if (o.polygon.length < 3) throw new Error('a polygon needs at least 3 points');
    return { kind: 'polygon', points: o.polygon.map((v) => add(o, rotate(v.x, v.y, a))) };
  }
  if (o.point || o.polyline) throw new Error('needs a rectangle, ellipse or polygon');
  if (o.width <= 0 || o.height <= 0) throw new Error('has no size');
  const [cx, cy] = add(o, rotate(o.width / 2, o.height / 2, a));
  if (o.ellipse) {
    if (Math.abs(o.width - o.height) > 1) throw new Error('ellipses must be circles (same width and height)');
    return { kind: 'circle', x: cx, y: cy, r: (o.width + o.height) / 4 };
  }
  return { kind: 'rect', x: cx, y: cy, width: o.width, height: o.height, angle: a };
}

/** A polyline's or polygon's points in world coordinates. */
function pointsOf(o: TiledObject, pts: { x: number; y: number }[]): [number, number][] {
  const a = ((o.rotation ?? 0) * Math.PI) / 180;
  return pts.map((v) => add(o, rotate(v.x, v.y, a)));
}

/** Every object on the map, hidden or not, by id, in world coordinates: what object properties refer to. */
function allObjects(layers: TiledLayer[], ox = 0, oy = 0, out = new Map<number, TiledObject>()): Map<number, TiledObject> {
  for (const layer of layers) {
    const lx = ox + (layer.offsetx ?? 0), ly = oy + (layer.offsety ?? 0);
    if (layer.type === 'group') allObjects(layer.layers ?? [], lx, ly, out);
    for (const o of layer.objects ?? []) out.set(o.id, { ...o, x: o.x + lx, y: o.y + ly });
  }
  return out;
}

/** The points of the polyline (or polygon, if `polygonToo`) that `ref` (a `path` property) refers to; `loop`: it's a polygon. */
function pathOf(objects: Map<number, TiledObject>, ref: unknown, polygonToo: boolean) {
  const path = objects.get(num(ref));
  const line = path && (path.polyline ?? (polygonToo ? path.polygon : undefined));
  if (!path || !line) throw new Error(`its "path" must be a polyline${polygonToo ? ' or polygon' : ''}`);
  return { points: pointsOf(path, line), loop: !path.polyline };
}

/** The point of a route nearest to `p`, and the index of the route point after it: where a bat there flies first. */
function nearestOnRoute(route: [number, number][], loop: boolean, [px, py]: [number, number]) {
  const n = route.length;
  let best = { start: route[0], target: 1, d: Infinity };
  for (let i = 0; i < (loop ? n : n - 1); i++) {
    const [ax, ay] = route[i], [bx, by] = route[(i + 1) % n];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    const q: [number, number] = [ax + t * dx, ay + t * dy];
    const d = (q[0] - px) ** 2 + (q[1] - py) ** 2;
    if (d < best.d) best = { start: q, target: (i + 1) % n, d };
  }
  return { start: best.start, target: best.target };
}

function branchesOf(o: TiledObject): Branch[] {
  const pts = pointsOf(o, o.polyline!);
  const out: Branch[] = [];
  for (let i = 1; i < pts.length; i++) {
    if (pts[i][0] === pts[i - 1][0]) throw new Error('a Branch segment can\'t be vertical');
    out.push({ from: pts[i - 1], to: pts[i] });
  }
  return out;
}

type TileLookup = (gid: number) => { cls: string | undefined; properties: TiledProperty[] | undefined; alignment: string };

/** Finds a tile object's tile: its class and properties, and its tileset's object alignment. */
function tileLookup(map: TiledMap, tilesets: Record<string, TiledTileset>): TileLookup {
  const refs = [...(map.tilesets ?? [])].sort((a, b) => b.firstgid - a.firstgid);
  return (gid) => {
    const id = gid & 0x0fffffff; // without the flip flags
    const ref = refs.find((r) => r.firstgid <= id);
    if (!ref) throw new Error(`its tile ${id} is in no tileset`);
    const set = ref.source === undefined ? ref : tilesets[ref.source];
    if (!set) throw new Error(`its tileset "${ref.source}" isn't loaded; keep tilesets next to the maps, as .tsj`);
    const tile = set.tiles?.find((t) => t.id === id - ref.firstgid);
    return { cls: tile?.type || tile?.class, properties: tile?.properties, alignment: set.objectalignment ?? 'unspecified' };
  };
}

/** The point of a tile's image (as a fraction of its size) that its object's position is at. */
const ALIGNMENTS: Record<string, [number, number]> = {
  topleft: [0, 0], top: [0.5, 0], topright: [1, 0],
  left: [0, 0.5], center: [0.5, 0.5], right: [1, 0.5],
  bottomleft: [0, 1], bottom: [0.5, 1], bottomright: [1, 1],
};

/** The point `at` (a fraction of its size) of a tile object's image; it's rotated around the object's position. */
function tilePoint(o: TiledObject, alignment: string, at: { x: number; y: number }): [number, number] {
  const [ax, ay] = ALIGNMENTS[alignment] ?? ALIGNMENTS.bottomleft;
  const a = ((o.rotation ?? 0) * Math.PI) / 180;
  return add(o, rotate(o.width * (at.x - ax), o.height * (at.y - ay), a));
}

function requirePoint(o: TiledObject) {
  if (!o.point) throw new Error('must be a point');
}

const add = (o: TiledObject, [x, y]: [number, number]): [number, number] => [o.x + x, o.y + y];

const describe = (o: TiledObject) => `object ${o.id}${o.name ? ` "${o.name}"` : ''}${o.type || o.class ? ` (${o.type || o.class})` : ''}`;
