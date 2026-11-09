import type { Application, Container } from 'pixi.js';
import { WORLD } from '../config';

/**
 * The part of the world on screen, in world px, kept up to date by `fitWorld`: the 1280x720 game and, around it
 * when the screen isn't 16:9, the scenery filling the rest (sky, ground, the sides).
 */
export const view = { left: 0, top: 0, right: WORLD.width, bottom: WORLD.height };

/**
 * How the world fits a `width` x `height` screen: as large as it goes keeping its proportions, centred across and
 * standing on the screen's bottom (a screen taller than 16:9 shows more sky above it, not more ground below).
 * `groundAt`: instead, as wide as the screen, its ground at that fraction of the screen's height (the title screen
 * held upright). `scale`, and `x`, `y` where the world's 0,0 lands; `left`, `top`, `right`, `bottom`: the screen's
 * edges in world px.
 */
export function worldFit(width: number, height: number, groundAt?: number) {
  const scale = groundAt === undefined ? Math.min(width / WORLD.width, height / WORLD.height) : width / WORLD.width;
  const x = (width - WORLD.width * scale) / 2;
  const y = groundAt === undefined ? height - WORLD.height * scale : height * groundAt - WORLD.groundY * scale;
  return { scale, x, y, left: -x / scale, top: -y / scale, right: (width - x) / scale, bottom: (height - y) / scale };
}

/** Scale `root` so the 1280x720 world fits the screen (see `worldFit`), and update `view`. */
export function fitWorld(app: Application, root: Container, groundAt?: number) {
  const { width, height } = app.screen;
  const { scale, x, y, left, top, right, bottom } = worldFit(width, height, groundAt);
  root.scale.set(scale);
  root.position.set(x, y);
  Object.assign(view, { left, top, right, bottom });
}

/** The screen is held upright (taller than wide). */
export const isPortrait = (width: number, height: number) => height > width;
