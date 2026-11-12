import type { CharacterDef } from './types';

/** the dragon's frames are 170x110 (tools/generate-placeholder-art.mjs); its feet on the ground at y 106 */
const FRAME = { width: 170, height: 110, feetY: 106 };

const frames = (name: string, n: number) => Array.from({ length: n }, (_, i) => `assets/dragon/${name}_${i}.svg`);

/**
 * A dragon: sits still, side on, its head pointing the way it faces, and every so often opens its jaw and spits a
 * stream of fire straight ahead. About 2/3 of the villain's height, about two ghosts wide.
 * `idle` is still; `blink`, `tail` (a flick) and `smoke` (a puff from the nostril) are its fidgets while it waits.
 * `open` / `close`: the jaw; `spit`: the jaw wide, the body heaving, while the fire (`fireDef`) comes out.
 */
export const dragonDef = {
  id: 'dragon',
  displayHeight: 85,
  /** feet, in the middle */
  anchor: { x: 0.5, y: FRAME.feetY / FRAME.height },
  facing: 'right',
  animations: {
    idle: { frames: ['assets/dragon/idle.svg'], fps: 1 },
    blink: { frames: ['assets/dragon/blink.svg'], fps: 1 },
    tail: { frames: frames('tail', 4), fps: 9, loop: false },
    smoke: { frames: frames('smoke', 3), fps: 5, loop: false },
    open: { frames: frames('open', 3), fps: 18, loop: false },
    spit: { frames: frames('spit', 3), fps: 14, loop: true },
    close: { frames: frames('open', 3).reverse(), fps: 18, loop: false },
  },
  defaultAnimation: 'idle',
  backing: true,
} satisfies CharacterDef<DragonAnim>;

export type DragonAnim = 'idle' | 'blink' | 'tail' | 'smoke' | 'open' | 'spit' | 'close';

/** world px per pixel of the dragon's frames */
const k = dragonDef.displayHeight / FRAME.height;
/**
 * Where the fire starts, in world px from the dragon's feet, facing right: just inside the open jaws.
 * The generator prints it as DRAGON_MOUTH (in frame px) when the head changes.
 */
export const dragonMouth = { x: (142.7 - FRAME.width / 2) * k, y: (52.4 - FRAME.feetY) * k };

/**
 * One puff of the fire stream, in four layers the stream draws on top of each other (all the puffs' outlines, then all
 * their outer flames, ...), so the overlapping puffs make one stream with one outline. `displayHeight`: a puff at full size.
 */
export const fireDef = {
  id: 'fire',
  displayHeight: 34,
  anchor: { x: 0.5, y: 0.5 },
  facing: 'right',
  animations: {
    outline: { frames: Array.from({ length: 4 }, (_, i) => `assets/fire/outline_${i}.svg`), fps: 12 },
    outer: { frames: Array.from({ length: 4 }, (_, i) => `assets/fire/outer_${i}.svg`), fps: 12 },
    mid: { frames: Array.from({ length: 4 }, (_, i) => `assets/fire/mid_${i}.svg`), fps: 12 },
    core: { frames: Array.from({ length: 4 }, (_, i) => `assets/fire/core_${i}.svg`), fps: 12 },
  },
  defaultAnimation: 'outer',
} satisfies CharacterDef<FireLayer>;

export type FireLayer = 'outline' | 'outer' | 'mid' | 'core';
/** the layers, bottom to top */
export const fireLayers: FireLayer[] = ['outline', 'outer', 'mid', 'core'];

/**
 * The dragon's fidgets and its fire, for every dragon (where its fire goes, how often and how long: each level's own,
 * the Dragon class in Tiled). ms, world px, px/s.
 * `rollMs`: how long the fire takes to roll out to the end of its route, and to roll back into the mouth;
 * `flowSpeed`: how fast the puffs travel along it; `puffSpacing`: the distance between them.
 * `startScale` / `endScale`: a puff's size coming out of the mouth and at the far end, as a share of full size; it
 * reaches full size `growOver` px from the mouth and shrinks away over the last `taperOver` px.
 * `halfThickness`: how far from the route the fire burns (px): the bird touching that costs it a life.
 * `tailShare`: the thin tail of the stream: that share of its taper, at its tip.
 * `hitTrim` 0..1: how much shorter than the fire its burning part is: 0, it burns to its tip (and `halfThickness` past
 * it); 1, the burning part, its rounded end included, stops where the tail starts.
 */
export const dragonConfig = {
  /** the time between spits is random within ± this share of the dragon's `throwDelay` (the first: its `initialDelay`, exactly) */
  intervalSpread: 0.4,
  fidget: { minWaitMs: 900, maxWaitMs: 2600, blinkMs: 160, tailMs: 450, smokeMs: 600, tailChance: 0.3, smokeChance: 0.3 },
  /** the body shaking while it spits: up to this far (px) each way, a new offset every `shakeMs` */
  shake: { px: 1.2, ms: 45 },
  fire: {
    rollMs: 500,
    flowSpeed: 260,
    puffSpacing: 13,
    startScale: 0.25,
    endScale: 0.05,
    growOver: 45,
    taperOver: 40,
    /** the same where something blocks it: shorter, so the fire looks like it hits the wall instead of dying out before it */
    blockedTaperOver: 10,
    /** puffs grow by this share along the whole stream, so it fans out a little */
    spread: 0.5,
    /** the stream's wobble up and down (px) at its far end */
    wobble: 2.5,
    halfThickness: 12,
    tailShare: 0.5,
    hitTrim: 0.5,
  },
};
