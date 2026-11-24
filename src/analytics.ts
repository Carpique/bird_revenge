import { levelSet, MAIN_SET } from './levels';

/** GoatCounter's `count.js` (a script tag in index.html), once loaded; absent if blocked, or not loaded yet */
declare global {
  interface Window {
    goatcounter?: { count(vars: { path: string; title?: string; event?: boolean }): void };
  }
}

/** A level started, counted as a GoatCounter event `level/<name>` (`level/<set>/<name>` outside the main set) (on localhost, or without the script: nothing). */
export function countLevelView(name: string) {
  // the main set's levels keep the paths they had before level sets
  const path = levelSet === MAIN_SET ? name : `${levelSet}/${name}`;
  window.goatcounter?.count({ path: `level/${path}`, title: path, event: true });
}
