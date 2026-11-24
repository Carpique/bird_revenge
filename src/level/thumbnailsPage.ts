import { Application } from 'pixi.js';
import { levelSets, listedLevels, setLevels } from '../levels';
import { loadAllAssets } from '../render/assets';
import { loadFonts } from '../ui/fonts';
import { thumbnailKey, ThumbnailRenderer } from './thumbnails';

declare global {
  interface Window {
    /** every listed level's thumbnail (the demo's too) as a WebP data URL, by `thumbnailKey` (set and level name); an error message if drawing failed */
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
  for (const set of levelSets) for (const level of listedLevels(setLevels(set))) {
    const texture = renderer.render(level);
    out[thumbnailKey(set, level.name)] = await app.renderer.extract.base64({ target: texture, format: 'webp', quality: 0.9 });
    texture.destroy(true);
  }
  window.thumbnails = out;
}

run().catch((e) => {
  window.thumbnails = e instanceof Error ? (e.stack ?? e.message) : String(e);
});
