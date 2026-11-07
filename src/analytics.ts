/** GoatCounter's `count.js` (a script tag in index.html), once loaded; absent if blocked, or not loaded yet */
declare global {
  interface Window {
    goatcounter?: { count(vars: { path: string; title?: string; event?: boolean }): void };
  }
}

/** A level started, counted as a GoatCounter event `level/<name>` (on localhost, or without the script: nothing). */
export function countLevelView(name: string) {
  window.goatcounter?.count({ path: `level/${name}`, title: name, event: true });
}
