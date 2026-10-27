import type { TextStyleOptions } from 'pixi.js';

/** Hand-written font used for in-game text, hints and overlays. */
export const HAND_FONT = '"Patrick Hand", "Comic Sans MS", cursive';
/** 19th-century poster style (Didone "fat face") font for the game title and menu. */
export const TITLE_FONT = '"Abril Fatface", "Didot", "Bodoni 72", Georgia, serif';

/** Polish letters, so the fonts' Latin Extended subsets get loaded too. */
const SAMPLE = 'Aaąćęłńóśźż';

/** Wait for the web fonts (index.html) so PixiJS text is rasterised with the right glyphs. */
export async function loadFonts() {
  try {
    await Promise.all([document.fonts.load('40px "Patrick Hand"', SAMPLE), document.fonts.load('40px "Abril Fatface"', SAMPLE)]);
  } catch {
    /* fallback fonts */
  }
}

/** Ink and accent colours of the titles and menus. */
export const INK = '#2b2b2b';
export const ACCENT = '#c0392b';
/** Halo around text shown over the dimmed game. */
export const GLOW = '#fff6d8';

/** Big poster-style sign: the game title, "Pause", "Game Over". Outline and shadow scale with the size. */
export function titleStyle(fontSize: number): TextStyleOptions {
  return {
    fontFamily: TITLE_FONT,
    fontSize,
    fill: INK,
    align: 'center',
    stroke: { color: '#ffffff', width: fontSize / 15, join: 'round' },
    dropShadow: { color: ACCENT, alpha: 1, angle: Math.PI / 4, distance: fontSize / 18.75, blur: 0 },
    padding: Math.ceil(fontSize / 9.4),
  };
}
