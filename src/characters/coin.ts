import type { CharacterDef } from './types';

/**
 * A coin to collect for the coin counter: spins in place until the bird flies into it.
 * The anchor is the image's centre; levels place a coin by its centre.
 * Tiled shows `src/levels/tiles/coin.png`, `spin_0` at 40 px; keep it this size.
 */
export const coinDef: CharacterDef<CoinAnim> = {
  id: 'coin',
  displayHeight: 40,
  anchor: { x: 0.5, y: 0.5 },
  facing: 'right',
  animations: {
    spin: { frames: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `assets/coin/spin_${i}.png`), fps: 12 },
  },
  defaultAnimation: 'spin',
};

export type CoinAnim = 'spin';

/** Distance (px) from a coin's centre within which the bird's body collects it. */
export const coinRadius = 18;
