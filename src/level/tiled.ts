import type { Branch, ButtonAction, CoinDef, FriendKind, JointDef, LevelDef, Material, Shape } from './types';

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
 * | Villain   | polyline                       | a villain walking its x range, on what's under its first point, starting there |
 * | Friend    | point                          | a friend to save, standing on the point   |
 * | Coin      | point, or a tile from coin.tsj | a coin to collect, centred on the point / the tile's image |
 * | BirdStart | point                          | where the bird starts                     |
 * | Button    | rectangle (unrotated)          | a button on the surface under its bottom edge, switching the Terrain `target` |
 *
 * Objects without a class are ignored (handy for notes and guides); hidden layers and objects are skipped.
 * A tile (image) object takes its tile's class unless it has its own; only a Coin can be one.
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
  tiles?: { id: number; type?: string; class?: string }[];
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
}

/**
 * Each class's fields and their defaults. Tiled leaves a field out of the file while it has its default value,
 * so these must match the custom types in `src/levels/pooping-birds.tiled-project` (a test checks they do).
 * Object references are ids, 0 = none.
 */
export const CLASS_DEFAULTS = {
  Terrain: { friction: 0.2 },
  Body: { material: 'wood', density: 0, sleeping: false },
  Branch: {},
  Rope: { body: 0, to: 0, length: 0, stiffness: 1 },
  Hinge: { body: 0, to: 0, stiffness: 1 },
  Villain: { throwDelay: 4 },
  Friend: { kind: 'bunny' },
  BirdStart: {},
  Coin: {},
  Button: { target: 0, action: 'open', duration: 3 },
} as const;

type ClassName = keyof typeof CLASS_DEFAULTS;
const MATERIALS: readonly Material[] = ['wood', 'stone', 'rubber', 'ice'];
const FRIEND_KINDS: readonly FriendKind[] = ['bunny'];
const BUTTON_ACTIONS: readonly ButtonAction[] = ['open', 'close'];

export class LevelError extends Error {}

/** `tilesets`: the tileset files the map's `tilesets` refer to, by their `source` as written in the map. */
export function parseTiledMap(name: string, map: TiledMap, tilesets: Record<string, TiledTileset> = {}): LevelDef {
  const problems: string[] = [];
  if (map.orientation !== 'orthogonal') problems.push(`orientation is "${map.orientation}"; use Orthogonal`);
  if (map.infinite) problems.push('the map is infinite; use a fixed-size map');

  const level: LevelDef = {
    name,
    width: map.width * map.tilewidth,
    height: map.height * map.tileheight,
    birdStart: null,
    villains: [],
    friends: [],
    coins: [],
    bodies: [],
    branches: [],
    joints: [],
    buttons: [],
  };

  const tiles = tileLookup(map, tilesets);
  const visit = (layers: TiledLayer[], ox: number, oy: number) => {
    for (const layer of layers) {
      if (!layer.visible) continue;
      const lx = ox + (layer.offsetx ?? 0), ly = oy + (layer.offsety ?? 0);
      if (layer.type === 'group') visit(layer.layers ?? [], lx, ly);
      if (layer.type !== 'objectgroup') continue;
      for (const o of layer.objects ?? []) {
        if (!o.visible) continue;
        try {
          addObject(level, { ...o, x: o.x + lx, y: o.y + ly }, tiles);
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

function addObject(level: LevelDef, o: TiledObject, tiles: TileLookup) {
  const tile = o.gid !== undefined ? tiles(o.gid) : null;
  const cls = o.type || o.class || tile?.cls;
  if (!cls) return;
  if (!(cls in CLASS_DEFAULTS)) throw new Error(`unknown class "${cls}"`);
  if (tile && cls !== 'Coin') throw new Error('only a Coin can be a tile (image) object; draw a shape');
  const p = props(cls as ClassName, o);

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
      const throwDelay = num(p.throwDelay);
      if (throwDelay < 0) throw new Error('"throwDelay" can\'t be negative (0 = never throws)');
      if (!o.polyline) throw new Error('a Villain must be a polyline: his path');
      const pts = pointsOf(o, o.polyline);
      const xs = pts.map(([x]) => x);
      const x0 = Math.min(...xs), x1 = Math.max(...xs);
      if (x0 === x1) throw new Error('a Villain path needs some width');
      level.villains.push({ x: pts[0][0], y: pts[0][1], path: { x0, x1 }, throwDelay });
      break;
    }
    case 'Friend': {
      requirePoint(o);
      const kind = String(p.kind) as FriendKind;
      if (!FRIEND_KINDS.includes(kind)) throw new Error(`unknown friend kind "${kind}"`);
      level.friends.push({ kind, x: o.x, y: o.y });
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
      if (tile) level.coins.push(tileCentre(o, tile.alignment));
      else {
        requirePoint(o);
        level.coins.push({ x: o.x, y: o.y });
      }
      break;
    case 'BirdStart':
      requirePoint(o);
      if (level.birdStart) throw new Error('there is more than one BirdStart');
      level.birdStart = { x: o.x, y: o.y };
      break;
  }
}

/** The class's defaults overridden by the object's own properties. */
function props(cls: ClassName, o: TiledObject): Record<string, unknown> {
  const out: Record<string, unknown> = { ...CLASS_DEFAULTS[cls] };
  for (const prop of o.properties ?? []) out[prop.name] = prop.value;
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

function branchesOf(o: TiledObject): Branch[] {
  const pts = pointsOf(o, o.polyline!);
  const out: Branch[] = [];
  for (let i = 1; i < pts.length; i++) {
    if (pts[i][0] === pts[i - 1][0]) throw new Error('a Branch segment can\'t be vertical');
    out.push({ from: pts[i - 1], to: pts[i] });
  }
  return out;
}

type TileLookup = (gid: number) => { cls: string | undefined; alignment: string };

/** Finds a tile object's tile: its class, and its tileset's object alignment. */
function tileLookup(map: TiledMap, tilesets: Record<string, TiledTileset>): TileLookup {
  const refs = [...(map.tilesets ?? [])].sort((a, b) => b.firstgid - a.firstgid);
  return (gid) => {
    const id = gid & 0x0fffffff; // without the flip flags
    const ref = refs.find((r) => r.firstgid <= id);
    if (!ref) throw new Error(`its tile ${id} is in no tileset`);
    const set = ref.source === undefined ? ref : tilesets[ref.source];
    if (!set) throw new Error(`its tileset "${ref.source}" isn't loaded; keep tilesets next to the maps, as .tsj`);
    const tile = set.tiles?.find((t) => t.id === id - ref.firstgid);
    return { cls: tile?.type || tile?.class, alignment: set.objectalignment ?? 'unspecified' };
  };
}

/** The point of a tile's image (as a fraction of its size) that its object's position is at. */
const ALIGNMENTS: Record<string, [number, number]> = {
  topleft: [0, 0], top: [0.5, 0], topright: [1, 0],
  left: [0, 0.5], center: [0.5, 0.5], right: [1, 0.5],
  bottomleft: [0, 1], bottom: [0.5, 1], bottomright: [1, 1],
};

/** The centre of a tile object's image; it's rotated around the object's position. */
function tileCentre(o: TiledObject, alignment: string): CoinDef {
  const [ax, ay] = ALIGNMENTS[alignment] ?? ALIGNMENTS.bottomleft;
  const a = ((o.rotation ?? 0) * Math.PI) / 180;
  const [x, y] = add(o, rotate(o.width * (0.5 - ax), o.height * (0.5 - ay), a));
  return { x, y };
}

function requirePoint(o: TiledObject) {
  if (!o.point) throw new Error('must be a point');
}

const add = (o: TiledObject, [x, y]: [number, number]): [number, number] => [o.x + x, o.y + y];

const describe = (o: TiledObject) => `object ${o.id}${o.name ? ` "${o.name}"` : ''}${o.type || o.class ? ` (${o.type || o.class})` : ''}`;
