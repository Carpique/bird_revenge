import type { TextStyleOptions } from 'pixi.js';

/** Chunky Wild West slab-serif font for all regular text: menus, hints, overlays, the score. */
export const TEXT_FONT = '"Peralta", system-ui, sans-serif';
/** Bouncy cartoon capitals, like classic animation titles, for big text: the game title and the big signs. */
export const BIG_FONT = '"Luckiest Guy", "Abril Fatface", "Didot", "Bodoni 72", Georgia, serif';

/** Polish letters, so the fonts' Latin Extended subsets get loaded too. */
const SAMPLE = 'Aaąćęłńóśźż';

/** Wait for the web fonts (index.html) so PixiJS text is rasterised with the right glyphs. */
export async function loadFonts() {
  try {
    await Promise.all([
      document.fonts.load('40px "Peralta"', SAMPLE),
      document.fonts.load('40px "Abril Fatface"', SAMPLE),
      document.fonts.load('40px "Luckiest Guy"', SAMPLE),
    ]);
  } catch {
    /* fallback fonts */
  }
}

/** Ink and accent colours of the titles and menus. */
export const INK = '#2b2b2b';
export const ACCENT = '#c0392b';
/** Big text: yellow letters with a red outline and a black offset shadow. */
export const BIG_FILL = '#ffd23f';
export const BIG_OUTLINE = ACCENT;
export const BIG_SHADOW = INK;
/** Halo around text shown over the dimmed game. */
export const GLOW = '#fff6d8';

/**
 * Big poster-style text: the game title, "What now?", "Game Over". Outline and shadow scale with the size.
 * Also the selected menu item, in `TEXT_FONT` with the fill and outline colours swapped.
 */
export function bigTextStyle(fontSize: number, fontFamily = BIG_FONT, fill = BIG_FILL, outline = BIG_OUTLINE): TextStyleOptions {
  return {
    fontFamily,
    fontSize,
    fill,
    align: 'center',
    stroke: { color: outline, width: fontSize / 15, join: 'round' },
    dropShadow: { color: BIG_SHADOW, alpha: 1, angle: Math.PI / 4, distance: fontSize / 18.75, blur: 0 },
    padding: Math.ceil(fontSize / 9.4),
  };
}
