import type { CharacterDef } from './types';

/** The apple the villain throws at the bird. Spins around its centre while flying. */
export const appleDef = {
  id: 'apple',
  displayHeight: 30,
  anchor: { x: 0.5, y: 0.6 },
  facing: 'right',
  animations: {
    apple: { frames: ['assets/apple/apple.svg'], fps: 1 },
  },
  defaultAnimation: 'apple',
} satisfies CharacterDef<'apple'>;
