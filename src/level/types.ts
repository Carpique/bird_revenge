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

/** A coin to collect: it spins in the air, outside the physics world, until the bird flies into it. */
export interface CoinDef {
  /** its centre */
  x: number;
  y: number;
}

/** A villain walking along the ground. */
export interface VillainDef {
  /** where he starts */
  x: number;
  /** where his feet are: the ground, or the top of what he walks on */
  y: number;
  /** the stretch of ground he walks back and forth (his centre stays within `x0`..`x1`) */
  path: { x0: number; x1: number };
  /** average time between his throws (s); 0 = he never throws */
  throwDelay: number;
}

export type ButtonAction = 'open' | 'close';

/**
 * A button on a surface: the bird standing on it, or a poo landing on it, switches `target` (a Terrain: a door, a trapdoor)
 * while it's pressed and for `duration` after.
 */
export interface ButtonDef {
  id: number;
  /** its footprint; the bottom edge (`y1`) sits on the surface */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** id of the Terrain it switches */
  target: number;
  /** open: the target is there until the button is pressed; close: it's there only while the button is in effect */
  action: ButtonAction;
  /** s the target stays switched after the button is let go; 0 = for good */
  duration: number;
}

export interface LevelDef {
  name: string;
  width: number;
  height: number;
  /** where the bird starts (its centre), or null for the default spot */
  birdStart: { x: number; y: number } | null;
  villains: VillainDef[];
  /** saving all of them completes the level (a level without any never ends) */
  friends: FriendDef[];
  coins: CoinDef[];
  bodies: BodyDef[];
  branches: Branch[];
  joints: JointDef[];
  buttons: ButtonDef[];
}
