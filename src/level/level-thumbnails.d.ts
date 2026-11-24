/** The levels' thumbnails made at build time, by set and level name (`main/001`): their URLs; null on the dev server (see tools/level-thumbnails.ts). */
declare module 'virtual:level-thumbnails' {
  const thumbnails: Record<string, string> | null;
  export default thumbnails;
}
