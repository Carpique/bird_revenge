import { describe, expect, it } from 'vitest';
import { unlockedLevels } from '../src/levels/progress';

const names = ['001', '002', '003', '004'];
const open = (done: string[]) => [...unlockedLevels(names, new Set(done))].sort();

describe('level select unlocking', () => {
  it('opens just the first level the first time', () => expect(open([])).toEqual(['001']));
  it('opens the finished ones and the next', () => expect(open(['001', '002'])).toEqual(['001', '002', '003']));
  it('opens all once all are finished', () => expect(open(names)).toEqual(names));
  it("a level added among finished ones doesn't lock those after it", () => expect(open(['001', '003'])).toEqual(['001', '002', '003']));
  it('ignores finished levels that are gone', () => expect(open(['old', '001'])).toEqual(['001', '002']));
});
