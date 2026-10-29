import { WORLD } from '../config';
import type { CoinDef, LevelDef } from './types';

/**
 * Training levels spelling the alphabet in coins: the base map (`training.tmj`, no coins of its own) once per letter,
 * its coins drawn as the letter, one coin per pixel of a fat 7×7 arcade-style bitmap font.
 */

/** A coin's size (px), as in `coin.tsj`; coins are a coin apart, so one every 2 sizes. */
const COIN = 40;
const PITCH = 2 * COIN;
/** the free space between the HUD counters (14 px from the top, 40 tall) and the ground */
const TOP = 14 + 40;
const BOTTOM = WORLD.groundY;

/** Capitals, 7 rows each; `#` = a coin. Strokes are 2 wide where they run up and down. */
const FONT: Record<string, string[]> = {
  A: ['..###..', '.##.##.', '##...##', '##...##', '#######', '##...##', '##...##'],
  B: ['######.', '##...##', '##...##', '######.', '##...##', '##...##', '######.'],
  C: ['..####.', '.##..##', '##.....', '##.....', '##.....', '.##..##', '..####.'],
  D: ['#####..', '##..##.', '##...##', '##...##', '##...##', '##..##.', '#####..'],
  E: ['#######', '##.....', '##.....', '######.', '##.....', '##.....', '#######'],
  F: ['#######', '##.....', '##.....', '######.', '##.....', '##.....', '##.....'],
  G: ['..#####', '.##....', '##.....', '##..###', '##...##', '.##..##', '..#####'],
  H: ['##...##', '##...##', '##...##', '#######', '##...##', '##...##', '##...##'],
  I: ['######', '..##..', '..##..', '..##..', '..##..', '..##..', '######'],
  J: ['....###', '.....##', '.....##', '.....##', '##...##', '##...##', '.#####.'],
  K: ['##...##', '##..##.', '##.##..', '####...', '#####..', '##.###.', '##..###'],
  L: ['##.....', '##.....', '##.....', '##.....', '##.....', '##.....', '#######'],
  M: ['##...##', '###.###', '#######', '#######', '##.#.##', '##...##', '##...##'],
  N: ['##...##', '###..##', '####.##', '##.####', '##..###', '##...##', '##...##'],
  O: ['.#####.', '##...##', '##...##', '##...##', '##...##', '##...##', '.#####.'],
  P: ['######.', '##...##', '##...##', '##...##', '######.', '##.....', '##.....'],
  Q: ['.#####.', '##...##', '##...##', '##...##', '##.####', '##..##.', '.###.##'],
  R: ['######.', '##...##', '##...##', '##..###', '#####..', '##.###.', '##..###'],
  S: ['.####..', '##..##.', '##.....', '.#####.', '.....##', '##...##', '.#####.'],
  T: ['######', '..##..', '..##..', '..##..', '..##..', '..##..', '..##..'],
  U: ['##...##', '##...##', '##...##', '##...##', '##...##', '##...##', '.#####.'],
  V: ['##...##', '##...##', '##...##', '###.###', '.#####.', '..###..', '...#...'],
  W: ['##...##', '##...##', '##.#.##', '#######', '#######', '###.###', '##...##'],
  X: ['##...##', '###.###', '.#####.', '..###..', '.#####.', '###.###', '##...##'],
  Y: ['##..##', '##..##', '##..##', '.####.', '..##..', '..##..', '..##..'],
  Z: ['#######', '....###', '...###.', '..###..', '.###...', '###....', '#######'],
};

export const LETTERS = Object.keys(FONT);

/** `letter`'s coins: centred across the world, centred between the HUD and the ground (7 rows fill that height). */
export function letterCoins(letter: string): CoinDef[] {
  const rows = FONT[letter];
  const width = Math.max(...rows.map((r) => r.length));
  const x0 = WORLD.width / 2 - ((width - 1) * PITCH) / 2;
  const y0 = (TOP + BOTTOM) / 2 - ((rows.length - 1) * PITCH) / 2;
  const out: CoinDef[] = [];
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) if (row[c] === '#') out.push({ x: x0 + c * PITCH, y: y0 + r * PITCH });
  });
  return out;
}

/** The base level once per letter, named `<base>-A`, `<base>-B`, …; collecting all the coins completes each. */
export function letterLevels(base: LevelDef): LevelDef[] {
  return LETTERS.map((letter) => ({ ...base, name: `${base.name}-${letter}`, coins: [...base.coins, ...letterCoins(letter)], goal: 'coins' }));
}
