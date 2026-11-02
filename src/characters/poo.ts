import type { CharacterDef } from './types';

export const pooDef = {
  id: 'poo',
  displayHeight: 30,
  anchor: { x: 0.5, y: 0.6 },
  facing: 'right',
  animations: {
    falling: { frames: ['assets/poo/falling.svg'], fps: 1 },
    splat: { frames: ['assets/poo/splat.svg'], fps: 1 },
  },
  defaultAnimation: 'falling',
} satisfies CharacterDef<'falling' | 'splat'>;

/** The bat's poo: the same drawings, smaller. */
export const batPooDef = { ...pooDef, id: 'bat-poo', displayHeight: 15 } satisfies CharacterDef<'falling' | 'splat'>;

/** how long a splat stays (on the ground or a branch), fading out over the last third */
export const splatLifetimeMs = 4500;
/** half the width of a splat on the ground (px); the villain won't step into it */
export const splatHalfWidth = 30;
