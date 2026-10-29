import { Application } from 'pixi.js';
import { gameLevels, levels } from '../levels';
import { loadAllAssets } from '../render/assets';
import { loadFonts } from '../ui/fonts';
import { ThumbnailRenderer } from './thumbnails';

declare global {
  interface Window {
    /** every numbered level's thumbnail as a WebP data URL, by level name; an error message if drawing failed */
    thumbnails?: Record<string, string> | string;
  }
}

/** The page tools/thumbnails.html runs at build time: draws the thumbnails with the game's own code and hands them back. */
async function run() {
  await loadFonts();
  await loadAllAssets();
  const app = new Application();
  await app.init({ width: 16, height: 9, antialias: true, preference: 'webgl' });
  const renderer = new ThumbnailRenderer(app);
  const out: Record<string, string> = {};
  for (const level of gameLevels(levels)) {
    const texture = renderer.render(level);
    out[level.name] = await app.renderer.extract.base64({ target: texture, format: 'webp', quality: 0.9 });
    texture.destroy(true);
  }
  window.thumbnails = out;
}

run().catch((e) => {
  window.thumbnails = e instanceof Error ? (e.stack ?? e.message) : String(e);
});
