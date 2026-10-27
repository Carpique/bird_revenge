import { LevelError, parseTiledMap, type TiledMap } from '../level/tiled';
import type { LevelDef } from '../level/types';

/**
 * Tiled maps in this folder; a level's name is its file name without `.tmj`.
 * They're played in file name order (numbers compared as numbers: level-2 before level-10), back to the first after the last.
 */
const files = import.meta.glob<string>('./*.tmj', { query: '?raw', import: 'default', eager: true });

function parseAll(): Map<string, LevelDef> {
  const out = new Map<string, LevelDef>();
  const paths = Object.keys(files).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  for (const path of paths) {
    const name = path.replace(/^\.\/|\.tmj$/g, '');
    try {
      out.set(name, parseTiledMap(name, JSON.parse(files[path]) as TiledMap));
    } catch (e) {
      // a broken map is left out; the message says what to fix
      console.error(e instanceof LevelError || e instanceof SyntaxError ? `${e.message}` : e);
    }
  }
  return out;
}

/** in play order */
export const levels = parseAll();

/** An empty screen, played when no level loads. */
const EMPTY: LevelDef = { name: 'empty', width: 1280, height: 720, birdStart: null, villains: [], friends: [], bodies: [], branches: [], joints: [] };

/** The level the URL asks for (`?level=<name>`), for testing it: the game skips the menu and plays just this level. */
export const testLevelName = new URLSearchParams(location.search).get('level');

/** The level to start with: the one the URL asks for, else the first; an empty screen when none loads (the console says why). */
export function firstLevel(): LevelDef {
  const name = testLevelName;
  const level = name ? levels.get(name) : undefined;
  if (name && !level && !(`./${name}.tmj` in files)) console.error(`No level "${name}"; there are: ${[...levels.keys()].join(', ')}`);
  return level ?? levels.values().next().value ?? EMPTY;
}

/** The level after `name` in `all` (`levels`, or a newer version from `onLevelEdited`), back to the first after the last. */
export function nextLevel(all: Map<string, LevelDef>, name: string): LevelDef {
  const order = [...all.values()];
  if (!order.length) return EMPTY;
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
