import { LevelError, parseTiledMap, type TiledMap, type TiledTileset } from '../level/tiled';
import type { LevelDef } from '../level/types';

/**
 * Tiled maps in this folder; a level's name is its file name without `.tmj`.
 * The numbered ones (`001.tmj`, `002.tmj`, …) are the game, played in number order (2 comes before 10 even unpadded),
 * back to the first after the last. The others (`training.tmj`) are played on their own, over and over.
 */
const files = import.meta.glob<string>('./*.tmj', { query: '?raw', import: 'default', eager: true });
/** the tilesets the maps use (`coin.tsj`), by file name; editing one reloads the levels too */
const tilesetFiles = import.meta.glob<string>('./*.tsj', { query: '?raw', import: 'default', eager: true });

function parseAll(): Map<string, LevelDef> {
  const out = new Map<string, LevelDef>();
  const tilesets: Record<string, TiledTileset> = {};
  for (const [path, text] of Object.entries(tilesetFiles)) {
    try {
      tilesets[path.replace(/^\.\//, '')] = JSON.parse(text) as TiledTileset;
    } catch (e) {
      console.error(`Tileset "${path}": ${(e as Error).message}`);
    }
  }
  const paths = Object.keys(files).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  for (const path of paths) {
    const name = path.replace(/^\.\/|\.tmj$/g, '');
    try {
      out.set(name, parseTiledMap(name, JSON.parse(files[path]) as TiledMap, tilesets));
    } catch (e) {
      // a broken map is left out; the message says what to fix
      console.error(e instanceof LevelError || e instanceof SyntaxError ? `${e.message}` : e);
    }
  }
  return out;
}

/** in play order */
export const levels = parseAll();

/** The training level's name, played from the title screen's "Training". */
export const TRAINING = 'training';

/** Whether `name` is one of the game's numbered levels, rather than one played on its own like training. */
const isNumbered = (name: string) => /^\d+$/.test(name);

/** An empty screen, played when no level loads. */
const EMPTY: LevelDef = { name: 'empty', width: 1280, height: 720, birdStart: null, villains: [], friends: [], coins: [], bodies: [], branches: [], joints: [], buttons: [] };

/** The level the URL asks for (`?level=<name>`), for testing it: the game skips the menu and plays just this level. */
export const testLevelName = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('level');

/** The level to start with: the one the URL asks for, else the first numbered one; an empty screen when none loads (the console says why). */
export function firstLevel(): LevelDef {
  const name = testLevelName;
  const level = name ? levels.get(name) : undefined;
  if (name && !level && !(`./${name}.tmj` in files)) console.error(`No level "${name}"; there are: ${[...levels.keys()].join(', ')}`);
  return level ?? [...levels.values()].find((l) => isNumbered(l.name)) ?? EMPTY;
}

/**
 * The level after `name` in `all` (`levels`, or a newer version from `onLevelEdited`): the next numbered one, back to the
 * first after the last; a level that isn't numbered (training) comes after itself.
 */
export function nextLevel(all: Map<string, LevelDef>, name: string): LevelDef {
  const again = isNumbered(name) ? undefined : all.get(name);
  if (again) return again;
  const order = [...all.values()].filter((l) => isNumbered(l.name));
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
