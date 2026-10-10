import type { Application, Container } from 'pixi.js';
import { WORLD } from '../config';

/** Scale `root` so the 1280x720 world fits the window, centred (letterboxed). */
export function fitWorld(app: Application, root: Container) {
  const { width, height } = app.screen;
  const s = Math.min(width / WORLD.width, height / WORLD.height);
  root.scale.set(s);
  root.position.set((width - WORLD.width * s) / 2, (height - WORLD.height * s) / 2);
}
