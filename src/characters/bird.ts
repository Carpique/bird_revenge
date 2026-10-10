import type { CharacterDef } from './types';

/**
 * The player's bird.
 * - `flap` frames must be ordered from wings DOWN to wings UP: with pose control the shown
 *   frame follows your arms' height, so the bird mirrors your movement.
 * - The physics body is a circle (config.physics.birdRadius); `anchor` places the circle's
 *   centre on the image so the feet touch the ground.
 */
export const birdDef = {
  id: 'bird',
  displayHeight: 90,
  anchor: { x: 0.5, y: 0.55 },
  facing: 'right',
  animations: {
    idle: { frames: ['assets/bird/idle.svg'], fps: 1 },
    flap: {
      frames: ['assets/bird/flap_0.svg', 'assets/bird/flap_1.svg', 'assets/bird/flap_2.svg', 'assets/bird/flap_3.svg'],
      fps: 12,
      loop: true,
    },
  },
  defaultAnimation: 'idle',
} satisfies CharacterDef<'idle' | 'flap'>;

/** "Squat" before a poo: squash the bird, then drop the poo when the squash is at its deepest. */
export const birdSquash = {
  scaleX: 1.22,
  scaleY: 0.72,
  /** ms to squash down, hold, and spring back */
  downMs: 160,
  holdMs: 70,
  upMs: 180,
};
