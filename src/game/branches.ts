import type { Branch } from '../scenery/scenery';

/** y of the branch's top edge at `x`, or null when `x` is past either end */
export function branchTopAt(br: Branch, x: number): number | null {
  const [x0, y0] = br.from, [x1, y1] = br.to;
  if (x < Math.min(x0, x1) || x > Math.max(x0, x1)) return null;
  return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
}

/**
 * The branch a falling circle lands on this step: its bottom went from above a branch's top edge
 * (`prevY`, last step) to on or below it. One-way: callers skip anything moving up, so it passes through.
 */
export function landingBranch(branches: readonly Branch[], x: number, prevY: number, y: number, r: number): { branch: Branch; top: number } | null {
  for (const branch of branches) {
    const top = branchTopAt(branch, x);
    if (top === null || prevY + r > top + 1 || y + r < top) continue;
    return { branch, top };
  }
  return null;
}
