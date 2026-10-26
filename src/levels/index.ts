import { LevelError, parseTiledMap, type TiledMap } from '../level/tiled';
import type { LevelDef } from '../level/types';

/** Tiled maps in this folder; a level's name is its file name without `.tmj`. */
const files = import.meta.glob<string>('./*.tmj', { query: '?raw', import: 'default', eager: true });

/** the level played unless the URL asks for another (`?level=<name>`) */
const DEFAULT_LEVEL = 'shelf';

function parseAll(): Map<string, LevelDef> {
  const out = new Map<string, LevelDef>();
  for (const [path, text] of Object.entries(files)) {
    const name = path.replace(/^\.\/|\.tmj$/g, '');
    try {
      out.set(name, parseTiledMap(name, JSON.parse(text) as TiledMap));
    } catch (e) {
      // a broken map is left out; the message says what to fix
      console.error(e instanceof LevelError || e instanceof SyntaxError ? `${e.message}` : e);
    }
  }
  return out;
}

export const levels = parseAll();

export function levelName(): string {
  return new URLSearchParams(location.search).get('level') ?? DEFAULT_LEVEL;
}

/** An empty screen, played when no level loads. */
const EMPTY: LevelDef = { name: 'empty', width: 1280, height: 720, birdStart: null, villains: [], bodies: [], branches: [], joints: [] };

/** The level to play; when it's missing or doesn't load (the console says why), the default one, or an empty screen. */
export function currentLevel(): LevelDef {
  const name = levelName();
  const level = levels.get(name);
  if (level) return level;
  if (!(`./${name}.tmj` in files)) console.error(`No level "${name}"; there are: ${[...levels.keys()].join(', ')}`);
  return levels.get(DEFAULT_LEVEL) ?? EMPTY;
}

type Listener = (level: LevelDef) => void;
/** kept across hot updates of this module, so the game's listener survives them */
const listeners: Listener[] = import.meta.hot?.data.listeners ?? [];

/** Calls `fn` with the new version of the current level whenever its map is saved (dev server only). */
export function onLevelEdited(fn: Listener) {
  listeners.push(fn);
}

if (import.meta.hot) {
  import.meta.hot.data.listeners = listeners;
  // saving a map in Tiled re-runs this module; hand the new level to the running game instead of reloading the page
  // (a map saved broken is left out: the game keeps the version it has)
  import.meta.hot.accept((mod) => {
    const level = (mod as typeof import('./index') | undefined)?.levels.get(levelName());
    if (level) for (const fn of listeners) fn(level);
  });
}
