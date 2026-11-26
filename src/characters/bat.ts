import type { CharacterDef } from './types';

/**
 * A bat flying along its route, pooing straight down. Seen from the front, so it looks the same either way it flies.
 * The anchor is the image's centre: the bat's position, the centre of its hitbox.
 */
export const batDef = {
  id: 'bat',
  displayHeight: 64,
  anchor: { x: 0.5, y: 0.5 },
  facing: 'right',
  animations: {
    fly: {
      frames: ['assets/bat/fly_0.svg', 'assets/bat/fly_1.svg', 'assets/bat/fly_2.svg', 'assets/bat/fly_3.svg'],
      fps: 10,
      loop: true,
    },
    hit: { frames: ['assets/bat/hit.svg'], fps: 1 },
    /** knocked out by a falling body (a crate), not a poo: seeing stars, going round its head */
    hitCollision: { frames: Array.from({ length: 3 }, (_, i) => `assets/bat/hit-collision_${i}.svg`), fps: 12, loop: true },
  },
  defaultAnimation: 'fly',
  backing: true,
} satisfies CharacterDef<'fly' | 'hit' | 'hitCollision'>;

/** A homing bat (one without a route): the same bat in dark purple, so players can tell it will come for them. */
export const homingBatDef = {
  ...batDef,
  id: 'bat-homing',
  animations: {
    fly: { ...batDef.animations.fly, frames: batDef.animations.fly.frames.map((f) => f.replace('assets/bat/', 'assets/bat/homing/')) },
    hit: { ...batDef.animations.hit, frames: ['assets/bat/homing/hit.svg'] },
    hitCollision: { ...batDef.animations.hitCollision, frames: batDef.animations.hitCollision.frames.map((f) => f.replace('assets/bat/', 'assets/bat/homing/')) },
  },
} satisfies CharacterDef<'fly' | 'hit' | 'hitCollision'>;

/** Radius (px) of the bat's round body, for the bird bumping into it: the body and the inner wings, not the wing tips. */
export const batRadius = 22;

/** the sprite's width (px) on screen: its SVGs are 140×90 */
const batDisplayWidth = (batDef.displayHeight * 140) / 90;
/** Size (px) of the pill-shaped hitbox the bird's poo hits: 80% of the wingspan, so poo can't slip through the wings. */
export const batHitbox = { width: Math.round(batDisplayWidth * 0.8), height: 40 };

/**
 * Half-size (px) of the oval the whole bat fits in, wing tip to wing tip and wings up to wings down (its SVGs reach about
 * 27 px above its centre and 22 below): how far it reaches on screen. A homing bat finds its way and fits as every
 * hunter does, by `hunterOutline` (`config.homing`), not by this.
 */
export const batOutline = { halfWidth: Math.round(batDisplayWidth / 2), halfHeight: 28 };
