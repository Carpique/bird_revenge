// Draws the actors' icons for Tiled (`src/levels/tiles/*.png`, the tiles of `src/levels/icons.tsj`): each actor's first
// frame at its size in the game, so it shows in Tiled as it will in the game. Run `npm run tiled-icons` after changing
// an actor's art or `displayHeight` (src/characters/), then fix the image sizes in icons.tsj if they changed.
// Uses headless Chrome (puppeteer), as the level thumbnails do.
import { readFile, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer';

/**
 * `height`: the character's `displayHeight`. `feet`: the share of that height down to its feet, for the actors placed
 * by their feet (villain: his `anchor.y`; a friend: its bottom); the image is cut there, so its bottom edge is the feet.
 */
const ICONS = [
  { out: 'villain', svg: 'villain/walk_0', height: 130, feet: 0.98 },
  { out: 'bat', svg: 'bat/fly_0', height: 64 },
  { out: 'bunny', svg: 'friend/bunny/idle', height: 64, feet: 1 },
  { out: 'bird', svg: 'bird/idle', height: 90 },
];

const browser = await puppeteer.launch({ headless: 'shell' });
try {
  const page = await browser.newPage();
  for (const icon of ICONS) {
    const svg = await readFile(new URL(`../public/assets/${icon.svg}.svg`, import.meta.url), 'utf8');
    const dataUrl = await page.evaluate(
      async (svg, height, feet) => {
        const img = new Image();
        img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
        await img.decode();
        const w = Math.round((img.naturalWidth * height) / img.naturalHeight);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = Math.round(height * feet);
        canvas.getContext('2d').drawImage(img, 0, 0, w, height);
        return canvas.toDataURL('image/png');
      },
      svg,
      icon.height,
      icon.feet ?? 1,
    );
    const out = new URL(`../src/levels/tiles/${icon.out}.png`, import.meta.url);
    await writeFile(out, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
    console.log(`${icon.out}.png`);
  }
} finally {
  await browser.close();
}
