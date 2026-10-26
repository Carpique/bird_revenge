import type { Branch } from '../level/types';

/**
 * A stretch of ground sheltered from above (world px, `x0` < `x1`): something overhead catches the poos
 * falling on it. Covers are a snapshot: a level with moving obstacles recomputes them every step.
 */
export interface Cover {
  x0: number;
  x1: number;
}

/** The ground under the branches, overlapping spans merged into one cover (add other spans with `mergeCovers`). */
export function coversUnder(branches: readonly Branch[]): Cover[] {
  return mergeCovers(branches.map((br) => ({ x0: Math.min(br.from[0], br.to[0]), x1: Math.max(br.from[0], br.to[0]) })));
}

/** Sorted by `x0`, overlapping or touching spans merged. */
export function mergeCovers(spans: readonly Cover[]): Cover[] {
  const merged: Cover[] = [];
  for (const s of [...spans].sort((a, b) => a.x0 - b.x0)) {
    const last = merged[merged.length - 1];
    if (last && s.x0 <= last.x1) last.x1 = Math.max(last.x1, s.x1);
    else merged.push({ ...s });
  }
  return merged;
}
