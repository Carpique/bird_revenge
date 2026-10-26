/**
 * A level as the game sees it, whatever editor it came from (see `tiled.ts` for the Tiled loader).
 * All positions are in world pixels, y down.
 */

/** A one-way platform the bird can sit on (landing from above, flying up through it): its top edge, end to end. */
export interface Branch {
  from: [number, number];
  to: [number, number];
}

export type Material = 'wood' | 'stone' | 'rubber' | 'ice';

export type Shape =
  /** `x`, `y`: the centre; `angle` in radians, clockwise */
  | { kind: 'rect'; x: number; y: number; width: number; height: number; angle: number }
  | { kind: 'circle'; x: number; y: number; r: number }
  /** the outline, in order */
  | { kind: 'polygon'; points: [number, number][] };

interface BodyBase {
  /** the editor's object id; joints refer to bodies by it */
  id: number;
  name: string;
  shape: Shape;
}

/** Static scenery that never moves: walls, shelves, slopes. */
export interface TerrainDef extends BodyBase {
  kind: 'terrain';
  friction: number;
}

/** A movable thing: falls, rolls, can be pushed. */
export interface MovableDef extends BodyBase {
  kind: 'body';
  material: Material;
  /** overrides the material's density; 0 = the material's */
  density: number;
  /** starts at rest until something touches it (keeps stacks from jittering apart at the start) */
  sleeping: boolean;
}

export type BodyDef = TerrainDef | MovableDef;

/**
 * Holds `body` at the point (`x`, `y`), to the world or to the body `to`:
 * - rope: a rod from the body's centre to that point, swinging around it (pendulums, hanging things)
 * - hinge: the body is pinned at that point and turns around it (seesaws, trapdoors)
 */
export interface JointDef {
  kind: 'rope' | 'hinge';
  x: number;
  y: number;
  body: number;
  /** id of the other body, or null to hold it to the world */
  to: number | null;
  /** rope only: px, 0 = as drawn */
  length: number;
  /** 1 = rigid, lower = springy */
  stiffness: number;
}

export type FriendKind = 'bunny';

/** A little animal to save (the first kind of collectible): it sits still until the bird flies into it. */
export interface FriendDef {
  kind: FriendKind;
  /** where its feet are */
  x: number;
  y: number;
}

export interface LevelDef {
  name: string;
  width: number;
  height: number;
  /** where the bird starts (its centre), or null for the default spot */
  birdStart: { x: number; y: number } | null;
  /** villains walk along the ground; only `x` matters */
  villains: { x: number }[];
  /** saving all of them completes the level (a level without any never ends) */
  friends: FriendDef[];
  bodies: BodyDef[];
  branches: Branch[];
  joints: JointDef[];
}
