import { Assets, type Application, type Texture } from 'pixi.js';
import prebuilt from 'virtual:level-thumbnails';
import { Game } from '../game/Game';
import type { LevelDef } from './types';

/** thumbnails' width in px (16:9, like the world) */
export const THUMBNAIL_WIDTH = 640;

/** Draws levels as they start, with an off-screen game. */
export class ThumbnailRenderer {
  private game: Game | null = null;

  constructor(private app: Application) {}

  render(level: LevelDef): Texture {
    this.game ??= new Game(this.app, level, false);
    return this.game.snapshot(level, THUMBNAIL_WIDTH);
  }
}

/**
 * The level select's pictures. A built game loads the ones made at build time; on the dev server (or for a level
 * the build didn't picture) they're drawn here, and drawn again when the level is saved in Tiled.
 */
export class Thumbnails {
  private renderer: ThumbnailRenderer;
  private cache = new Map<string, { level: LevelDef; texture: Promise<Texture> }>();

  constructor(app: Application) {
    this.renderer = new ThumbnailRenderer(app);
  }

  get(level: LevelDef): Promise<Texture> {
    const hit = this.cache.get(level.name);
    if (hit?.level === level) return hit.texture;
    const url = prebuilt?.[level.name];
    const texture = url ? Assets.load<Texture>(url).catch(() => this.renderer.render(level)) : Promise.resolve(this.renderer.render(level));
    this.cache.set(level.name, { level, texture });
    return texture;
  }
}
