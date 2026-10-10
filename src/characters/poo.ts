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

/** how long a splat stays on the ground before fading out */
export const splatLifetimeMs = 1500;
