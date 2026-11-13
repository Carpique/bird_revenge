import type { VillainKind } from '../level/types';
import type { CharacterDef } from './types';

/** The apple the villain throws at the bird. Spins around its centre while flying; `splat`: what's left of it on a surface it flew into. */
export const appleDef = {
  id: 'apple',
  displayHeight: 30,
  anchor: { x: 0.5, y: 0.6 },
  facing: 'right',
  animations: {
    apple: { frames: ['assets/apple/apple.svg'], fps: 1 },
    splat: { frames: ['assets/apple/splat.svg'], fps: 1 },
  },
  defaultAnimation: 'apple',
} satisfies CharacterDef<'apple' | 'splat'>;

/** The glowing green glue the ghost throws. Wobbles instead of spinning. */
export const glueDef = {
  id: 'glue',
  displayHeight: 30,
  anchor: { x: 0.5, y: 0.5 },
  facing: 'right',
  animations: {
    apple: { frames: ['assets/glue/glue.svg'], fps: 1 },
    splat: { frames: ['assets/glue/splat.svg'], fps: 1 },
  },
  defaultAnimation: 'apple',
} satisfies CharacterDef<'apple' | 'splat'>;

/** What each villain kind throws; `spins`: it spins while flying, else it wobbles. */
export const missiles: Record<VillainKind, { def: typeof appleDef; spins: boolean }> = {
  villain: { def: appleDef, spins: true },
  ghost: { def: glueDef, spins: false },
};
