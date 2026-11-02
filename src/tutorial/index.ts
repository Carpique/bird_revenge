import type { PoseRecording } from './recording';

/**
 * The recorded pose streams in this folder (`<level>.json`, saved by the dev-only recorder), loaded only when the
 * instructions page opens. Not imported by the recorder: saving a recording would reload it.
 */
const files = import.meta.glob<PoseRecording>('./*.json', { import: 'default' });

/** The recording named `name`, or null when there's none. */
export async function loadRecording(name: string): Promise<PoseRecording | null> {
  const load = files[`./${name}.json`];
  if (!load) return null;
  try {
    return await load();
  } catch (e) {
    console.error(`Recording "${name}": ${(e as Error).message}`);
    return null;
  }
}
