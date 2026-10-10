import { Assets, type Texture } from 'pixi.js';
import { allCharacters } from '../characters';
import { sceneryImages } from '../scenery/scenery';

/** Loads every image referenced by the character and scenery definitions. Alias = path in the def. */
export async function loadAllAssets(): Promise<void> {
  const paths = new Set<string>(sceneryImages());
  for (const def of allCharacters) for (const a of Object.values(def.animations)) a.frames.forEach((f) => paths.add(f));
  await Assets.load(
    [...paths].map((p) => ({
      alias: p,
      src: import.meta.env.BASE_URL + p,
      // rasterise SVGs at 2x so they stay crisp when the stage is scaled up
      data: { resolution: 2 },
    })),
  );
}

export function tex(path: string): Texture {
  const t = Assets.get<Texture>(path);
  if (!t) throw new Error(`Asset not loaded: ${path}`);
  return t;
}
