import type { Application, Container } from 'pixi.js';
import { WORLD } from '../config';

/**
 * The part of the world on screen, in world px, kept up to date by `fitWorld`: the 1280x720 game and, around it
 * when the screen isn't 16:9, the scenery filling the rest (sky, ground, the sides).
 */
export const view = { left: 0, top: 0, right: WORLD.width, bottom: WORLD.height };

/**
 * How the world fits a `width` x `height` screen: as large as it goes keeping its proportions, centred. `scale`, and
 * `x`, `y` where the world's 0,0 lands; `left`, `top`, `right`, `bottom`: the screen's edges in world px.
 */
export function worldFit(width: number, height: number) {
  const scale = Math.min(width / WORLD.width, height / WORLD.height);
  const x = (width - WORLD.width * scale) / 2, y = (height - WORLD.height * scale) / 2;
  return { scale, x, y, left: -x / scale, top: -y / scale, right: (width - x) / scale, bottom: (height - y) / scale };
}

/** Scale `root` so the 1280x720 world fits the window, centred (see `worldFit`), and update `view`. */
export function fitWorld(app: Application, root: Container) {
  const { width, height } = app.screen;
  const { scale, x, y, left, top, right, bottom } = worldFit(width, height);
  root.scale.set(scale);
  root.position.set(x, y);
  Object.assign(view, { left, top, right, bottom });
}
