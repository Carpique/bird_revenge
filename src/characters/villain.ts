import type { VillainKind } from '../level/types';
import type { CharacterDef } from './types';

/**
 * Villain walking along the ground. Hitting him with a poo scores plus points.
 * Tiled shows `src/levels/tiles/villain.png`, `walk_0` at this size (`npm run tiled-icons`).
 */
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
  backing: true,
} satisfies CharacterDef<'walk' | 'hit'>;

/** Collision box (world px), centred horizontally on the feet, extending up. */
export const villainHitbox = { width: 56, height: 120 };

/**
 * The ghost: the villain's other look, a ball under a bed sheet floating a little above his feet; the same size,
 * so the same hitbox. Its `walk` is the sheet's hem waving, which goes on while it stands still.
 * Tiled shows `src/levels/tiles/ghost.png`.
 */
export const ghostDef = {
  ...villainDef,
  id: 'ghost',
  animations: {
    walk: {
      frames: Array.from({ length: 6 }, (_, i) => `assets/ghost/float_${i}.svg`),
      fps: 8,
      loop: true,
    },
    hit: { frames: ['assets/ghost/hit.svg'], fps: 1 },
  },
} satisfies CharacterDef<'walk' | 'hit'>;

/** Each villain kind's look; `floats`: it keeps moving (its `walk`) while it stands still, instead of standing mid-stride. */
export const villainLooks: Record<VillainKind, { def: typeof villainDef; floats: boolean }> = {
  villain: { def: villainDef, floats: false },
  ghost: { def: ghostDef, floats: true },
};
