import { describe, expect, it, vi } from 'vitest';
import { WORLD } from '../src/config';
import { Bat } from '../src/game/Bat';
import { STEP_MS } from '../src/game/physics';
import { Villain, type HitCause } from '../src/game/Villain';

// no textures in tests: a sprite that draws nothing, remembering the animation it was last told to play
vi.mock('../src/render/CharacterSprite', () => ({
  CharacterSprite: class {
    playing = '';
    position = { set() {} };
    scale = { set() {} };
    anim = { stop() {} };
    play(name: string) {
      this.playing = name;
    }
    showPhase(name: string) {
      this.playing = name;
    }
    setFacing() {}
  },
}));

const playing = (c: Villain | Bat) => (c.view as unknown as { playing: string }).playing;

const villain = (kind: 'villain' | 'ghost') => new Villain({ kind, x: 600, y: WORLD.groundY, path: { x0: 300, x1: 900 }, throwDelay: 0 });
const bat = (route: [number, number][]) => new Bat({ route, start: route[0] ?? [300, 300], target: route.length > 1 ? 1 : 0, loop: false, speed: 2, pooDelay: 0 });

describe('the pose of a character knocked off', () => {
  const cases: [string, () => Villain | Bat][] = [
    ['villain', () => villain('villain')],
    ['ghost', () => villain('ghost')],
    ['bat', () => bat([[200, 200], [400, 200]])],
    ['homing bat', () => bat([])],
  ];
  const expected: Record<HitCause, string> = { poo: 'hit', collision: 'hitCollision' };
  for (const [name, make] of cases) {
    for (const cause of ['poo', 'collision'] as const) {
      it(`${name}, by ${cause === 'poo' ? 'a poo' : 'a falling body'}: ${expected[cause]}`, () => {
        const c = make();
        expect(c.hit(cause)).toBe(true);
        c.sync();
        expect(playing(c)).toBe(expected[cause]);
        // a hit on one already knocked off doesn't change its pose
        expect(c.hit(cause === 'poo' ? 'collision' : 'poo')).toBe(false);
        if (c instanceof Bat) c.step(STEP_MS);
        else c.step(STEP_MS, { bird: null, obstacles: [] });
        c.sync();
        expect(playing(c)).toBe(expected[cause]);
      });
    }
  }
});
