/** Hand-written font used for in-game text, hints and overlays. */
export const HAND_FONT = '"Patrick Hand", "Comic Sans MS", cursive';
/** 19th-century poster style (Didone "fat face") font for the game title and menu. */
export const TITLE_FONT = '"Abril Fatface", "Didot", "Bodoni 72", Georgia, serif';

/** Wait for the web fonts (index.html) so PixiJS text is rasterised with the right glyphs. */
export async function loadFonts() {
  try {
    await Promise.all([document.fonts.load('40px "Patrick Hand"'), document.fonts.load('40px "Abril Fatface"')]);
  } catch {
    /* fallback fonts */
  }
}
