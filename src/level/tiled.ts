import type { Branch, JointDef, LevelDef, Material, Shape } from './types';

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
 * | Villain   | point                          | a villain starting at that x              |
 * | BirdStart | point                          | where the bird starts                     |
 *
 * Objects without a class are ignored (handy for notes and guides); hidden layers and objects are skipped.
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

export interface TiledMap {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  orientation: string;
  infinite: boolean;
  layers: TiledLayer[];
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
  Villain: {},
  BirdStart: {},
} as const;

type ClassName = keyof typeof CLASS_DEFAULTS;
const MATERIALS: readonly Material[] = ['wood', 'stone', 'rubber', 'ice'];

export class LevelError extends Error {}

export function parseTiledMap(name: string, map: TiledMap): LevelDef {
  const problems: string[] = [];
  if (map.orientation !== 'orthogonal') problems.push(`orientation is "${map.orientation}"; use Orthogonal`);
  if (map.infinite) problems.push('the map is infinite; use a fixed-size map');

  const level: LevelDef = {
    name,
    width: map.width * map.tilewidth,
    height: map.height * map.tileheight,
    birdStart: null,
    villains: [],
    bodies: [],
    branches: [],
    joints: [],
  };

  const visit = (layers: TiledLayer[], ox: number, oy: number) => {
    for (const layer of layers) {
      if (!layer.visible) continue;
      const lx = ox + (layer.offsetx ?? 0), ly = oy + (layer.offsety ?? 0);
      if (layer.type === 'group') visit(layer.layers ?? [], lx, ly);
      if (layer.type !== 'objectgroup') continue;
      for (const o of layer.objects ?? []) {
        if (!o.visible) continue;
        try {
          addObject(level, { ...o, x: o.x + lx, y: o.y + ly });
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

  if (problems.length) throw new LevelError(`Level "${name}":\n- ${problems.join('\n- ')}`);
  return level;
}

function addObject(level: LevelDef, o: TiledObject) {
  const cls = o.type || o.class;
  if (!cls) return;
  if (!(cls in CLASS_DEFAULTS)) throw new Error(`unknown class "${cls}"`);
  if (o.gid !== undefined) throw new Error('tile (image) objects are not supported yet; draw a shape');
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
    case 'Villain':
      requirePoint(o);
      level.villains.push({ x: o.x });
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

function branchesOf(o: TiledObject): Branch[] {
  const a = ((o.rotation ?? 0) * Math.PI) / 180;
  const pts = o.polyline!.map((v) => add(o, rotate(v.x, v.y, a)));
  const out: Branch[] = [];
  for (let i = 1; i < pts.length; i++) {
    if (pts[i][0] === pts[i - 1][0]) throw new Error('a Branch segment can\'t be vertical');
    out.push({ from: pts[i - 1], to: pts[i] });
  }
  return out;
}

function requirePoint(o: TiledObject) {
  if (!o.point) throw new Error('must be a point');
}

const add = (o: TiledObject, [x, y]: [number, number]): [number, number] => [o.x + x, o.y + y];

const describe = (o: TiledObject) => `object ${o.id}${o.name ? ` "${o.name}"` : ''}${o.type || o.class ? ` (${o.type || o.class})` : ''}`;
