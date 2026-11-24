import { LevelError, parseTiledMap, type TiledMap, type TiledTileset } from '../level/tiled';
import type { LevelDef } from '../level/types';
import { LETTERS, letterLevels } from '../level/letters';
import { TUTORIAL_LEVEL } from '../tutorial/recording';

/**
 * Tiled maps; a level's name is its file name without `.tmj`.
 * Levels come in sets, each a folder in `sets/` (`sets/main/`, …): the game plays one set, `main` unless the URL asks for another
 * (`?levelset=<name>`). The maps right in this folder are in every set.
 * A set's numbered maps (`001.tmj`, `002.tmj`, …) are the game, played in number order (2 comes before 10 even unpadded),
 * back to the first after the last. The others are played on their own, over and over, except `training.tmj`: it is the base
 * of the training levels, `training-A` to `training-Z`, each spelling its letter in coins (see `letters.ts`), played A to Z and round.
 * The level select also lists the instructions' map (`control-tutorial.tmj`) first, as "Demo" (so the numbers stay as
 * they are): not a level to play, picking it opens the instructions page.
 * Maps in a set refer to the shared tileset as `../../icons.tsj`.
 */
/** the map the training levels are made from */
const TRAINING_BASE = 'training';
/** the level select's first card, before 1: the instructions page */
export const DEMO = TUTORIAL_LEVEL;

/** every map, by path from this folder (`./control-tutorial.tmj`, `./sets/main/001.tmj`) */
const files = import.meta.glob<string>(['./*.tmj', './sets/*/*.tmj'], { query: '?raw', import: 'default', eager: true });
/** the tilesets the maps use (`icons.tsj`), by path; editing one reloads the levels too */
const tilesetFiles = import.meta.glob<string>(['./*.tsj', './sets/*/*.tsj'], { query: '?raw', import: 'default', eager: true });

/** the set the game plays when the URL names none */
export const MAIN_SET = 'main';
/** The level sets there are (the folders in `sets/` with maps), by name. */
export const levelSets = [...new Set(Object.keys(files).flatMap((path) => path.match(/^\.\/sets\/([^/]+)\//)?.[1] ?? []))].sort();

/** The set the URL asks for (`?levelset=<name>`), else `main`; an unknown set: `main` (the console says so). */
function chosenSet(): string {
  const asked = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('levelset');
  if (!asked || asked === MAIN_SET) return MAIN_SET;
  if (levelSets.includes(asked)) return asked;
  console.error(`No level set "${asked}"; there are: ${levelSets.join(', ')}`);
  return MAIN_SET;
}

/** The set the game plays. */
export const levelSet = chosenSet();

/** `path` (from this folder) made plain: `./sets/main/../../icons.tsj` → `./icons.tsj`. */
function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '..') out.pop();
    else if (part !== '.' && part !== '') out.push(part);
  }
  return `./${out.join('/')}`;
}

function parseTilesets(): Record<string, TiledTileset> {
  const out: Record<string, TiledTileset> = {};
  for (const [path, text] of Object.entries(tilesetFiles)) {
    try {
      out[path] = JSON.parse(text) as TiledTileset;
    } catch (e) {
      console.error(`Tileset "${path}": ${(e as Error).message}`);
    }
  }
  return out;
}

/** The tilesets the map at `path` refers to, by their `source` as written in it (relative to the map). */
function tilesetsFor(path: string, map: TiledMap, all: Record<string, TiledTileset>): Record<string, TiledTileset> {
  const dir = path.slice(0, path.lastIndexOf('/') + 1);
  const out: Record<string, TiledTileset> = {};
  for (const ref of map.tilesets ?? []) {
    const set = ref.source === undefined ? undefined : all[normalize(dir + ref.source)];
    if (set) out[ref.source!] = set;
  }
  return out;
}

/** The levels of set `set` (with the shared ones), in play order. */
export function setLevels(set: string): Map<string, LevelDef> {
  const out = new Map<string, LevelDef>();
  const tilesets = parseTilesets();
  const inSet = (path: string) => /^\.\/[^/]+\.tmj$/.test(path) || path.startsWith(`./sets/${set}/`);
  const paths = Object.keys(files)
    .filter(inSet)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  for (const path of paths) {
    const name = path.replace(/^.*\/|\.tmj$/g, '');
    try {
      const map = JSON.parse(files[path]) as TiledMap;
      const level = parseTiledMap(name, map, tilesetsFor(path, map, tilesets));
      if (name === TRAINING_BASE) for (const l of letterLevels(level)) out.set(l.name, l);
      else out.set(name, level);
    } catch (e) {
      // a broken map is left out; the message says what to fix
      console.error(e instanceof LevelError || e instanceof SyntaxError ? `${e.message}` : e);
    }
  }
  return out;
}

/** the set's levels, in play order */
export const levels = setLevels(levelSet);

/** The first training level's name, played from the title screen's "Training". */
export const TRAINING = `${TRAINING_BASE}-${LETTERS[0]}`;

/** Whether `name` is one of the game's numbered levels, rather than one played on its own like training. */
const isNumbered = (name: string) => /^\d+$/.test(name);

/** The game's numbered levels in `all` (`levels`, or a newer version from `onLevelEdited`), in play order. */
export const gameLevels = (all: Map<string, LevelDef>): LevelDef[] => [...all.values()].filter((l) => isNumbered(l.name));

/** The level select's list (and the levels pictured for it): the demo, then the game's levels. */
export const listedLevels = (all: Map<string, LevelDef>): LevelDef[] => {
  const demo = all.get(DEMO);
  return [...(demo ? [demo] : []), ...gameLevels(all)];
};

/** An empty screen, played when no level loads. */
const EMPTY: LevelDef = { name: 'empty', width: 1280, height: 720, birdStart: null, villains: [], bats: [], dragons: [], friends: [], coins: [], bodies: [], branches: [], joints: [], buttons: [] };

/** The level the URL asks for (`?level=<name>`), for testing it: the game skips the menu and plays just this level. */
export const testLevelName = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('level');

/** The level to start with: the one the URL asks for, else the first numbered one; an empty screen when none loads (the console says why). */
export function firstLevel(): LevelDef {
  const name = testLevelName;
  const level = name ? levels.get(name) : undefined;
  if (name && !level && !(`./${name}.tmj` in files) && !(`./sets/${levelSet}/${name}.tmj` in files)) console.error(`No level "${name}"; there are: ${[...levels.keys()].join(', ')}`);
  return level ?? gameLevels(levels)[0] ?? EMPTY;
}

/**
 * The level after `name` in `all` (`levels`, or a newer version from `onLevelEdited`): the next numbered one, back to the
 * first after the last; a training letter: the next letter, back to A after Z; another level that isn't numbered comes after itself.
 */
export function nextLevel(all: Map<string, LevelDef>, name: string): LevelDef {
  const letter = name.match(/^(.*)-([A-Z])$/);
  const nextLetter = letter && all.get(`${letter[1]}-${LETTERS[(LETTERS.indexOf(letter[2]) + 1) % LETTERS.length]}`);
  if (nextLetter) return nextLetter;
  const again = isNumbered(name) ? undefined : all.get(name);
  if (again) return again;
  const order = gameLevels(all);
  if (!order.length) return EMPTY;
  // a level that's gone (renamed while playing): the first
  return order[(order.findIndex((l) => l.name === name) + 1) % order.length];
}

type Listener = (levels: Map<string, LevelDef>) => void;
/** kept across hot updates of this module, so the game's listener survives them */
const listeners: Listener[] = import.meta.hot?.data.listeners ?? [];

/** Calls `fn` with all the levels whenever a map is saved (dev server only). */
export function onLevelEdited(fn: Listener) {
  listeners.push(fn);
}

if (import.meta.hot) {
  import.meta.hot.data.listeners = listeners;
  // saving a map in Tiled re-runs this module; hand the new levels to the running game instead of reloading the page
  import.meta.hot.accept((mod) => {
    const next = (mod as typeof import('./index') | undefined)?.levels;
    if (next) for (const fn of listeners) fn(next);
  });
}
