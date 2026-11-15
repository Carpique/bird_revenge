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

/**
 * Collision shape (world px): the ellipse inscribed in a `width` × `height` box, centred horizontally on the feet,
 * its bottom `lift` above them. The box is about the drawing's bounds.
 * Tiled shows it as the tile's collision shape in `src/levels/icons.tsj`: change it there too (a test checks they match).
 */
export interface VillainHitbox {
  width: number;
  height: number;
  lift: number;
}

/**
 * The ghost: the villain's other look, a ball under a bed sheet floating a little above his feet; the same size,
 * but wider and shorter, so its own hitbox. Its `walk` is the sheet's hem waving, which goes on while it stands still.
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

/**
 * Each villain kind's look; `floats`: it keeps moving (its `walk`) while it stands still, instead of standing mid-stride;
 * `alpha`: how opaque it's drawn (the ghost is see-through); `hitbox`: what a poo or the bird hits.
 */
export const villainLooks: Record<VillainKind, { def: typeof villainDef; floats: boolean; alpha: number; hitbox: VillainHitbox }> = {
  villain: { def: villainDef, floats: false, alpha: 1, hitbox: { width: 52, height: 124, lift: 0 } },
  ghost: { def: ghostDef, floats: true, alpha: 0.7, hitbox: { width: 68, height: 102, lift: 15 } },
};
