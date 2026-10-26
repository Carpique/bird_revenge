import decomp from 'poly-decomp';
import { Bodies, Common, Constraint, Vertices, type MBody, type MConstraint } from '../game/physics';
import type { BodyDef, JointDef, LevelDef, Material } from './types';

// lets Matter split concave polygons into convex parts
Common.setDecomp(decomp);

/** Physics of each material; a Body's `density` overrides the material's. */
export const MATERIALS: Record<Material, { density: number; friction: number; frictionStatic: number; restitution: number }> = {
  wood: { density: 0.002, friction: 0.5, frictionStatic: 0.6, restitution: 0.05 },
  stone: { density: 0.006, friction: 0.7, frictionStatic: 0.8, restitution: 0 },
  rubber: { density: 0.0015, friction: 0.9, frictionStatic: 1, restitution: 0.7 },
  ice: { density: 0.002, friction: 0.01, frictionStatic: 0.02, restitution: 0.1 },
};

export interface LevelBody {
  def: BodyDef;
  body: MBody;
  /** the outline to draw, around `body.position` with the body unrotated (rect: corners, circle: none) */
  outline: [number, number][];
}

export interface LevelJoint {
  def: JointDef;
  constraint: MConstraint;
}

export interface BuiltLevel {
  bodies: LevelBody[];
  joints: LevelJoint[];
}

/** Matter.js bodies and constraints for a level (not yet added to a world). */
export function buildLevel(level: LevelDef): BuiltLevel {
  const bodies = level.bodies.map(buildBody);
  const byId = new Map(bodies.map((b) => [b.def.id, b.body]));
  const joints = level.joints.map((def) => ({ def, constraint: buildJoint(def, byId) }));
  return { bodies, joints };
}

function buildBody(def: BodyDef): LevelBody {
  const opts =
    def.kind === 'terrain'
      ? // like the ground: no bounce, a bit of friction
        { isStatic: true, friction: def.friction, frictionStatic: 0.5, restitution: 0, label: 'terrain' }
      : { ...MATERIALS[def.material], ...(def.density > 0 ? { density: def.density } : {}), isSleeping: def.sleeping, label: 'body' };
  const s = def.shape;
  switch (s.kind) {
    case 'rect': {
      const body = Bodies.rectangle(s.x, s.y, s.width, s.height, { ...opts, angle: s.angle });
      const w = s.width / 2, h = s.height / 2;
      return { def, body, outline: [[-w, -h], [w, -h], [w, h], [-w, h]] };
    }
    case 'circle':
      return { def, body: Bodies.circle(s.x, s.y, s.r, opts), outline: [] };
    case 'polygon': {
      const pts = s.points.map(([x, y]) => ({ x, y }));
      // fromVertices puts the shape's centre of mass at the given point, so give it the outline's own
      const c = Vertices.centre(pts);
      const body = Bodies.fromVertices(c.x, c.y, [pts], opts);
      return { def, body, outline: s.points.map(([x, y]) => [x - body.position.x, y - body.position.y]) };
    }
  }
}

function buildJoint(def: JointDef, byId: Map<number, MBody>): MConstraint {
  const body = byId.get(def.body)!;
  const to = def.to !== null ? byId.get(def.to)! : null;
  const at = { x: def.x, y: def.y };
  // the joint point, on `to` (relative to its centre) or in the world
  const other = to ? { bodyB: to, pointB: { x: at.x - to.position.x, y: at.y - to.position.y } } : { pointB: at };
  if (def.kind === 'hinge') {
    return Constraint.create({ bodyA: body, pointA: { x: at.x - body.position.x, y: at.y - body.position.y }, ...other, length: 0, stiffness: def.stiffness, label: 'hinge' });
  }
  // a rope from the body's centre; Matter measures the length as drawn when it's left out
  return Constraint.create({ bodyA: body, ...other, ...(def.length > 0 ? { length: def.length } : {}), stiffness: def.stiffness, label: 'rope' });
}
