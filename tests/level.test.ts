import { describe, expect, it } from 'vitest';
import { Constraint, Engine, Composite } from '../src/game/physics';
import { buildLevel } from '../src/level/build';
import { nextLevel } from '../src/levels';
import { CLASS_DEFAULTS, LevelError, parseTiledMap, type TiledMap, type TiledObject } from '../src/level/tiled';
import projectText from '../src/levels/pooping-birds.tiled-project?raw';
import shelfText from '../src/levels/shelf.tmj?raw';

/** A map with one object layer holding `objects`. */
function mapOf(objects: Partial<TiledObject>[], layerVisible = true): TiledMap {
  return {
    width: 80,
    height: 45,
    tilewidth: 16,
    tileheight: 16,
    orientation: 'orthogonal',
    infinite: false,
    layers: [
      {
        type: 'objectgroup',
        name: 'test',
        visible: layerVisible,
        objects: objects.map((o, i) => ({ id: i + 1, name: '', x: 0, y: 0, width: 0, height: 0, rotation: 0, visible: true, ...o })),
      },
    ],
  };
}

const prop = (name: string, type: string, value: unknown) => ({ name, type, value });

describe('Tiled levels', () => {
  it('loads the shelf level', () => {
    const level = parseTiledMap('shelf', JSON.parse(shelfText));
    expect(level.width).toBe(1280);
    expect(level.height).toBe(720);
    expect(level.villains).toEqual([
      // under the shelf (480..800), reaching 20% of its width beyond each of its ends
      { x: 416, y: 640, path: { x0: 416, x1: 864 }, throwDelay: 4 },
      // on it
      { x: 480, y: 380, path: { x0: 480, x1: 800 }, throwDelay: 4 },
    ]);
    expect(level.friends).toEqual([{ kind: 'bunny', x: 640, y: 640 }]);
    expect(level.birdStart).toEqual({ x: 1100, y: 606 });
    expect(level.bodies).toHaveLength(1);
    expect(level.bodies[0]).toMatchObject({ kind: 'terrain', name: 'shelf', friction: 0.2, shape: { kind: 'rect', x: 640, y: 392, width: 320, height: 24 } });
  });

  it('has the same class defaults as the Tiled project', () => {
    const project = JSON.parse(projectText);
    const classes = Object.fromEntries(
      project.propertyTypes
        .filter((t: { type: string }) => t.type === 'class')
        .map((t: { name: string; members: { name: string; value: unknown }[] }) => [t.name, Object.fromEntries(t.members.map((m) => [m.name, m.value]))]),
    );
    expect(classes).toEqual(CLASS_DEFAULTS);
  });

  it('turns Tiled shapes into centred, rotated world shapes', () => {
    const level = parseTiledMap(
      't',
      mapOf([
        // rotated 90° clockwise around its top-left corner: now hangs down-left of it
        { type: 'Terrain', x: 100, y: 100, width: 40, height: 20, rotation: 90 },
        { type: 'Body', x: 200, y: 200, width: 30, height: 30, ellipse: true, properties: [prop('material', 'string', 'stone')] },
        { type: 'Terrain', x: 10, y: 20, polygon: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 0, y: 40 }] },
        { type: 'Branch', x: 300, y: 300, polyline: [{ x: 0, y: 0 }, { x: 100, y: -10 }, { x: 150, y: 0 }] },
        { name: 'a note', x: 5, y: 5, width: 10, height: 10 },
      ]),
    );
    const [rect, circle, poly] = level.bodies;
    expect(rect.shape).toMatchObject({ kind: 'rect', width: 40, height: 20, angle: Math.PI / 2 });
    if (rect.shape.kind !== 'rect') throw new Error();
    expect(rect.shape.x).toBeCloseTo(90);
    expect(rect.shape.y).toBeCloseTo(120);
    expect(circle).toMatchObject({ kind: 'body', material: 'stone', density: 0, sleeping: false, shape: { kind: 'circle', x: 215, y: 215, r: 15 } });
    expect(poly.shape).toEqual({ kind: 'polygon', points: [[10, 20], [60, 20], [10, 60]] });
    expect(level.branches).toEqual([
      { from: [300, 300], to: [400, 290] },
      { from: [400, 290], to: [450, 300] },
    ]);
  });

  it('reads friends, bunnies by default', () => {
    const level = parseTiledMap('t', mapOf([{ type: 'Friend', x: 10, y: 20, point: true }, { type: 'Friend', x: 30, y: 40, point: true, properties: [prop('kind', 'string', 'bunny')] }]));
    expect(level.friends).toEqual([
      { kind: 'bunny', x: 10, y: 20 },
      { kind: 'bunny', x: 30, y: 40 },
    ]);
    expect(() => parseTiledMap('t', mapOf([{ type: 'Friend', point: true, properties: [prop('kind', 'string', 'dragon')] }]))).toThrow('unknown friend kind "dragon"');
    expect(() => parseTiledMap('t', mapOf([{ type: 'Friend', width: 10, height: 10 }]))).toThrow('must be a point');
  });

  it('reads each villain\'s throw delay, 0 for one who never throws', () => {
    const level = parseTiledMap(
      't',
      mapOf([
        { type: 'Villain', x: 100, polyline: [{ x: 0, y: 0 }, { x: 50, y: 0 }] },
        { type: 'Villain', x: 300, polyline: [{ x: 0, y: 0 }, { x: 50, y: 0 }], properties: [prop('throwDelay', 'float', 0)] },
      ]),
    );
    expect(level.villains).toEqual([
      { x: 100, y: 0, path: { x0: 100, x1: 150 }, throwDelay: 4 },
      { x: 300, y: 0, path: { x0: 300, x1: 350 }, throwDelay: 0 },
    ]);
    expect(() => parseTiledMap('t', mapOf([{ type: 'Villain', polyline: [{ x: 0, y: 0 }, { x: 50, y: 0 }], properties: [prop('throwDelay', 'float', -1)] }]))).toThrow(
      "can't be negative",
    );
  });

  it('takes a Villain polyline\'s x range as his path, starting at its first point', () => {
    const level = parseTiledMap('t', mapOf([{ type: 'Villain', x: 500, y: 640, polyline: [{ x: 0, y: 0 }, { x: -300, y: 0 }, { x: 100, y: 0 }] }]));
    expect(level.villains).toEqual([{ x: 500, y: 640, path: { x0: 200, x1: 600 }, throwDelay: 4 }]);
    expect(() => parseTiledMap('t', mapOf([{ type: 'Villain', polyline: [{ x: 0, y: 0 }, { x: 0, y: 50 }] }]))).toThrow('needs some width');
    expect(() => parseTiledMap('t', mapOf([{ type: 'Villain', point: true }]))).toThrow('must be a polyline');
  });

  it('skips hidden layers', () => {
    expect(parseTiledMap('t', mapOf([{ type: 'Terrain', width: 10, height: 10 }], false)).bodies).toEqual([]);
  });

  it('reports every problem at once', () => {
    const map = mapOf([
      { type: 'Crate', width: 10, height: 10 },
      { type: 'Terrain', point: true },
      { type: 'Rope', point: true, properties: [prop('body', 'object', 99)] },
    ]);
    expect(() => parseTiledMap('t', map)).toThrow(LevelError);
    try {
      parseTiledMap('t', map);
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('unknown class "Crate"');
      expect(msg).toContain('needs a rectangle, ellipse or polygon');
      expect(msg).toContain('has no "body"');
    }
  });
});

describe('building a level', () => {
  const level = parseTiledMap(
    't',
    mapOf([
      { type: 'Body', x: 100, y: 100, width: 40, height: 40, properties: [prop('material', 'string', 'stone')] },
      // an L shape: concave, split into convex parts
      { type: 'Terrain', x: 300, y: 300, polygon: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 20 }, { x: 20, y: 20 }, { x: 20, y: 100 }, { x: 0, y: 100 }] },
      { type: 'Hinge', x: 100, y: 100, point: true, properties: [prop('body', 'object', 1)] },
      { type: 'Rope', x: 120, y: 20, point: true, properties: [prop('body', 'object', 1), prop('to', 'object', 2)] },
    ]),
  );
  const built = buildLevel(level);

  it('makes bodies where Tiled drew them', () => {
    const [crate, ell] = built.bodies;
    expect(crate.body.position).toEqual({ x: 120, y: 120 });
    expect(crate.body.isStatic).toBe(false);
    expect(crate.body.density).toBe(0.006);
    expect(ell.body.isStatic).toBe(true);
    expect(ell.body.parts.length).toBeGreaterThan(2);
    // its outline, put back around the body's centre, is the polygon as drawn
    expect(ell.outline.map(([x, y]) => [Math.round(x + ell.body.position.x), Math.round(y + ell.body.position.y)])).toEqual([
      [300, 300], [400, 300], [400, 320], [320, 320], [320, 400], [300, 400],
    ]);
    expect(ell.body.bounds.min.x).toBeCloseTo(300);
    expect(ell.body.bounds.max.y).toBeCloseTo(400);
  });

  it('joins bodies with hinges and ropes', () => {
    const [hinge, rope] = built.joints;
    expect(Constraint.pointAWorld(hinge.constraint)).toEqual({ x: 100, y: 100 });
    expect(Constraint.pointBWorld(hinge.constraint)).toEqual({ x: 100, y: 100 });
    expect(hinge.constraint.length).toBe(0);
    expect(rope.constraint.bodyB).toBe(built.bodies[1].body);
    expect(Constraint.pointBWorld(rope.constraint)).toEqual({ x: 120, y: 20 });
    expect(rope.constraint.length).toBeCloseTo(100);
  });

  it('swings a body pinned at its corner', () => {
    const engine = Engine.create();
    Composite.add(engine.world, [built.bodies[0].body, built.joints[0].constraint]);
    for (let i = 0; i < 120; i++) Engine.update(engine, 1000 / 60);
    const p = Constraint.pointAWorld(built.joints[0].constraint);
    // still held at the hinge, but it has turned
    expect(p.x).toBeCloseTo(100, 0);
    expect(p.y).toBeCloseTo(100, 0);
    expect(Math.abs(built.bodies[0].body.angle)).toBeGreaterThan(0.3);
  });
});

describe('level order', () => {
  const a = parseTiledMap('a', mapOf([]));
  const b = parseTiledMap('b', mapOf([]));
  const all = new Map([['a', a], ['b', b]]);

  it('goes round in order', () => {
    expect(nextLevel(all, 'a')).toBe(b);
    expect(nextLevel(all, 'b')).toBe(a);
    // a level that's gone (renamed while playing): the first
    expect(nextLevel(all, 'gone')).toBe(a);
  });
});
