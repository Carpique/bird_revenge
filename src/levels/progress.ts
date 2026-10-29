/** The numbered levels finished so far, by name, remembered in the browser. */
const STORAGE_KEY = 'bird-revenge.completed';

function load(): Set<string> {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    if (Array.isArray(saved)) return new Set(saved.filter((n) => typeof n === 'string'));
  } catch {
    /* no storage, or something else saved there */
  }
  return new Set();
}

const completed = load();

/** Remember that level `name` was finished. */
export function markCompleted(name: string) {
  if (completed.has(name)) return;
  completed.add(name);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...completed]));
  } catch {
    /* no storage: forgotten on reload */
  }
}

/**
 * Of `names` (in play order), the ones that can be picked: every finished one, and the first one not finished yet
 * (so the first level the first time). A level added between finished ones is open, but doesn't lock the ones after it.
 */
export function unlockedLevels(names: string[], done: ReadonlySet<string> = completed): Set<string> {
  const open = new Set(names.filter((n) => done.has(n)));
  const next = names.find((n) => !done.has(n));
  if (next) open.add(next);
  return open;
}
