import type { CharacterDef } from './types';

/** Villain walking along the ground. Hitting him with a poo scores plus points. */
export const villainDef = {
  id: 'villain',
  displayHeight: 130,
  /** feet */
  anchor: { x: 0.5, y: 0.98 },
  facing: 'right',
  animations: {
    walk: {
      frames: ['assets/villain/walk_0.svg', 'assets/villain/walk_1.svg', 'assets/villain/walk_2.svg', 'assets/villain/walk_3.svg'],
      fps: 8,
      loop: true,
    },
    hit: { frames: ['assets/villain/hit.svg'], fps: 1 },
  },
  defaultAnimation: 'walk',
} satisfies CharacterDef<'walk' | 'hit'>;

/** Collision box (world px), centred horizontally on the feet, extending up. */
export const villainHitbox = { width: 56, height: 120 };
