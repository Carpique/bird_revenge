import { Container } from 'pixi.js';
import { batOutline } from '../characters/bat';
import { villainDef } from '../characters/villain';
import { WORLD } from '../config';
import { Bat } from '../game/Bat';
import { STEP_MS } from '../game/physics';
import { Villain } from '../game/Villain';
import type { VillainKind } from '../level/types';
import { view } from '../render/fitWorld';

type Kind = VillainKind | 'bat';
const KINDS: Kind[] = ['villain', 'ghost', 'bat'];

/** ms before the first one comes, and between one leaving the screen and the next coming */
const FIRST_MS = 15000, GAP_MS = 5000;
/** how far past the screen's edges (world px) one starts and leaves: out of sight there */
const OFFSCREEN = 100;
/** a bat flies between these heights (its centre): its wings above the ground, never higher than the villain's head */
const BAT_LOW = WORLD.groundY - batOutline.halfHeight;
const BAT_HIGH = WORLD.groundY - villainDef.displayHeight + batOutline.halfHeight;
/** a bat's route: a point about every this many px across, each at a random height; its speed (px per physics step) */
const BAT_LEG = 220, BAT_SPEED = 2;
/** a walk-out is of two (one from each side) this often; the second comes this many ms after the first */
const PAIR_CHANCE = 0.5, PAIR_MIN_MS = 1000, PAIR_MAX_MS = 4000;
/** two coming towards each other meet this close (centre to centre, world px): then they pass, or both turn back */
const MEET_DISTANCE = 110, TURN_BACK_CHANCE = 0.5;
/** longest frame step taken at once, so a backgrounded tab doesn't run a long walk in one go */
const MAX_DT_MS = 100;

/** `items` in a random order (Fisher–Yates). */
function shuffled<T>(items: readonly T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

interface Walker {
  /** its look and moves (a villain, a ghost or a bat), and where it is */
  readonly view: Container;
  step(): void;
  sync(): void;
  /** x of its centre */
  readonly x: number;
  /** the way it's going */
  readonly dir: 1 | -1;
  /** turns round, to leave the way it came */
  turnBack(): void;
  /** past the screen's edge, on its way out: out of sight */
  readonly gone: boolean;
}

/**
 * The title screen's passers-by: the game's characters crossing the screen, from a random side, as they move in the game:
 * a villain or a ghost walking along the ground (with his usual stops, never throwing), a bat flying low over it, no higher
 * than the villain's head (never pooing). The walk-outs come in a random order, every kind once before any comes again,
 * and never the same one twice in a row. Half the time (`PAIR_CHANCE`) a walk-out is of two: 1–4 s after the first, a
 * second one, of any kind, comes from the other side; when they meet, a coin decides whether they pass each other or
 * both turn back. Once all are gone, the next walk-out comes `GAP_MS` later.
 */
export class Passersby extends Container {
  private queue: Kind[] = [];
  private last: Kind | null = null;
  private walkers: Walker[] = [];
  /** ms till the next walk-out, while there's none */
  private waitMs = FIRST_MS;
  /** a walk-out of two: ms till the second comes, and from which side; null when none is to come */
  private second: { inMs: number; rightwards: boolean } | null = null;
  /** the two have met, and the coin has decided */
  private met = false;
  /** ms not yet stepped (the characters move in fixed physics steps, as in the game) */
  private acc = 0;

  update(dtMs: number) {
    this.acc += Math.min(dtMs, MAX_DT_MS);
    while (this.acc >= STEP_MS) {
      this.acc -= STEP_MS;
      this.step();
    }
    for (const w of this.walkers) w.sync();
  }

  private step() {
    if (!this.walkers.length && !this.second) {
      if ((this.waitMs -= STEP_MS) <= 0) this.walkOut();
      return;
    }
    if (this.second && (this.second.inMs -= STEP_MS) <= 0) {
      this.walkers.push(this.spawn(KINDS[Math.floor(Math.random() * KINDS.length)], this.second.rightwards));
      this.second = null;
    }
    for (const w of this.walkers) w.step();
    this.meet();
    for (const w of this.walkers.filter((w) => w.gone)) {
      this.removeChild(w.view);
      w.view.destroy({ children: true });
    }
    this.walkers = this.walkers.filter((w) => !w.gone);
    if (!this.walkers.length && !this.second) this.waitMs = GAP_MS;
  }

  /** The next kind, from a random side; half the time with a second one to come from the other. */
  private walkOut() {
    const rightwards = Math.random() < 0.5;
    this.walkers.push(this.spawn(this.next(), rightwards));
    this.met = false;
    if (Math.random() < PAIR_CHANCE) this.second = { inMs: PAIR_MIN_MS + Math.random() * (PAIR_MAX_MS - PAIR_MIN_MS), rightwards: !rightwards };
  }

  /** Two coming towards each other, close: a coin decides, once, whether they pass or both turn back. */
  private meet() {
    if (this.met || this.walkers.length < 2) return;
    const [a, b] = this.walkers;
    const towards = (b.x - a.x) * a.dir > 0 && (a.x - b.x) * b.dir > 0;
    if (!towards || Math.abs(a.x - b.x) > MEET_DISTANCE) return;
    this.met = true;
    if (Math.random() < TURN_BACK_CHANCE) {
      a.turnBack();
      b.turnBack();
    }
  }

  /** The next kind from the shuffled round; a new round never starts with the one just gone. */
  private next(): Kind {
    if (!this.queue.length) {
      this.queue = shuffled(KINDS);
      if (this.queue[0] === this.last) this.queue.push(this.queue.shift()!);
    }
    this.last = this.queue.shift()!;
    return this.last;
  }

  /** One of `kind` coming in past the screen's left edge (`rightwards`) or right edge. */
  private spawn(kind: Kind, rightwards: boolean): Walker {
    const left = view.left - OFFSCREEN, right = view.right + OFFSCREEN;
    const [from, to] = rightwards ? [left, right] : [right, left];
    const walker = kind === 'bat' ? this.bat(from, to) : this.villain(kind, from, to);
    this.addChild(walker.view);
    return walker;
  }

  private villain(kind: VillainKind, from: number, to: number): Walker {
    const path = from < to ? { x0: from, x1: to } : { x0: to, x1: from };
    const villain = new Villain({ kind, x: from, y: WORLD.groundY, path, throwDelay: 0 }, false);
    // he'd turn back at the ends of his path; at the one he's heading for, he's gone instead (both, once he's turned back)
    let exit = to;
    return {
      view: villain.view,
      step: () => villain.step(STEP_MS, { bird: null, obstacles: [] }),
      sync: () => villain.sync(),
      get x() {
        return villain.centreX;
      },
      get dir() {
        return villain.facing;
      },
      turnBack: () => {
        villain.turn();
        exit = from;
      },
      get gone() {
        return villain.centreX === exit;
      },
    };
  }

  private bat(from: number, to: number): Walker {
    const dir = to > from ? 1 : -1;
    const legs = Math.max(1, Math.round(Math.abs(to - from) / BAT_LEG));
    const height = () => BAT_HIGH + Math.random() * (BAT_LOW - BAT_HIGH);
    const route = Array.from({ length: legs + 1 }, (_, i): [number, number] => [from + ((to - from) * i) / legs, height()]);
    // its route runs on past both ends: at an end it would turn back (in the same step), so it's gone once past one instead
    route.push([to + dir * OFFSCREEN, route[legs][1]]);
    route.unshift([from - dir * OFFSCREEN, route[0][1]]);
    const bat = new Bat({ route, loop: false, start: route[1], target: 2, speed: BAT_SPEED, pooDelay: 0 });
    let going: 1 | -1 = dir;
    return {
      view: bat.view,
      step: () => bat.step(STEP_MS),
      sync: () => bat.sync(),
      get x() {
        return bat.position.x;
      },
      get dir() {
        return going;
      },
      turnBack: () => {
        bat.turnBack();
        going = going > 0 ? -1 : 1;
      },
      get gone() {
        const x = bat.position.x;
        return x < Math.min(from, to) || x > Math.max(from, to);
      },
    };
  }
}
