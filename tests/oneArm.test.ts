import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { bothArms, classifyArms, continuousArms, oneArmWeight, pointingStep, type PointingIntent, type PointingMode } from '../src/game/pointing';
import { STEP_MS } from '../src/game/physics';
import { PointingDetector, type PointingOutput } from '../src/gestures/PointingDetector';
import { synthPose } from './synthetic';

/**
 * One arm steering (`pointing.oneArm`): one arm hanging and the other pointing flies the bird where it points, a
 * little slower than both arms; arms raised or lowered one after the other don't fly by it; the speed eases between
 * both arms' and one arm's. The discrete map, the detector, the physics, and continuous steering.
 */

/** direction on screen (y up) at `deg` (0 = right, 90 = up) */
const dir = (deg: number) => ({ x: Math.cos((deg * Math.PI) / 180), y: Math.sin((deg * Math.PI) / 180) });
/** the arm on the screen's left / right, `out` deg from straight down towards its own side (90: level, 180: up) */
const leftArm = (out: number) => dir(-90 - out);
const rightArm = (out: number) => dir(-90 + out);
const cfg = config.pointing;

const saved = { ...config.pointing };
afterEach(() => {
  Object.assign(config.pointing, saved);
});

describe('classifyArms: one arm pointing while the other hangs', () => {
  it('flies where the pointing arm points, at the one-arm speed', () => {
    // the right arm level, up, and across the body; the left hanging
    for (const [out, deg] of [[90, 0], [180, 90], [150, 60], [70, -20], [-110, 160]] as const) {
      const p = classifyArms(leftArm(5), rightArm(out))!;
      expect(p, `${out}`).toMatchObject({ mode: 'fly', oneArm: true, speed: cfg.oneArmSpeed });
      expect(p.dx).toBeCloseTo(dir(deg).x, 6);
      expect(p.dy).toBeCloseTo(dir(deg).y, 6);
    }
    // and the other way round
    const q = classifyArms(leftArm(90), rightArm(10))!;
    expect(q).toMatchObject({ mode: 'fly', oneArm: true, dx: -1 });
  });

  it('the pointing arm has to be clearly out: below oneArmMinOut it matches nothing', () => {
    expect(classifyArms(leftArm(0), rightArm(cfg.oneArmMinOut + 2))?.oneArm).toBe(true);
    expect(classifyArms(leftArm(0), rightArm(cfg.oneArmMinOut - 2))).toBeNull();
    // both in the cone: the rest, whatever else
    expect(classifyArms(leftArm(0), rightArm(cfg.restCone - 2))?.mode).toBe('rest');
  });

  it('the other arm has to hang: out of the rest cone it is no one-arm pose', () => {
    expect(classifyArms(leftArm(cfg.restCone - 2), rightArm(180))?.oneArm).toBe(true);
    expect(classifyArms(leftArm(cfg.restCone + 3), rightArm(180))).toBeNull();
  });

  it('what read something before still reads the same: a tilted T with its lower arm in the cone, arms pointing down together', () => {
    // the lower arm 30° from straight down (60° below level), the other level: a tilted T, towards the lower hand
    expect(classifyArms(leftArm(30), rightArm(90))).toEqual({ mode: 'drift', dx: -1, dy: 0 });
    // both pointing down and to the right, the right one in the cone: both arms' flight, at the full speed
    const p = classifyArms(leftArm(-50), rightArm(25))!;
    expect(p.mode).toBe('fly');
    expect(p.oneArm).toBeUndefined();
    expect(p.speed).toBeUndefined();
    // every pose on a grid: wherever the map read something without one arm steering, it reads the same with it
    const modes: (PointingMode | null)[] = [null, 'rest', 'hover', 'drift', 'fly'];
    let filled = 0;
    for (let a = -180; a < 180; a += 5)
      for (let b = -178.5; b < 180; b += 5)
        for (const current of modes) {
          cfg.oneArm = false;
          const off = classifyArms(dir(a), dir(b), current);
          cfg.oneArm = true;
          const on = classifyArms(dir(a), dir(b), current);
          if (off) expect(on, `${a} ${b} ${current}`).toEqual(off);
          else if (on) {
            expect(on.oneArm, `${a} ${b} ${current}`).toBe(true);
            filled++;
          }
        }
    expect(filled).toBeGreaterThan(200);
  });

  it('hysteresis: once flying by one arm, both limits are more lenient, and it comes before the T', () => {
    const h = cfg.oneArmHysteresis;
    // the hanging arm a little out of the cone
    expect(classifyArms(leftArm(cfg.restCone + h - 1), rightArm(180), 'fly', true)?.oneArm).toBe(true);
    expect(classifyArms(leftArm(cfg.restCone + h - 1), rightArm(180), 'fly', false)).toBeNull();
    expect(classifyArms(leftArm(cfg.restCone + h + 1), rightArm(180), 'fly', true)).toBeNull();
    // the pointing arm a little lower
    expect(classifyArms(leftArm(0), rightArm(cfg.oneArmMinOut - h + 1), 'fly', true)?.oneArm).toBe(true);
    expect(classifyArms(leftArm(0), rightArm(cfg.oneArmMinOut - h - 1), 'fly', true)).toBeNull();
    // a hanging arm swinging out to 30° while the other points level: still one arm (from nothing, a tilted T)
    expect(classifyArms(leftArm(30), rightArm(90), 'fly', true)).toMatchObject({ oneArm: true, dx: 1 });
    expect(classifyArms(leftArm(30), rightArm(90), 'fly', false)?.mode).toBe('drift');
  });

  it('off: it matches nothing, as before', () => {
    cfg.oneArm = false;
    expect(classifyArms(leftArm(5), rightArm(90))).toBeNull();
    expect(classifyArms(leftArm(5), rightArm(180), 'fly', true)).toBeNull();
  });
});

describe('pointing physics: the one-arm speed', () => {
  const settle = (p: PointingIntent) => {
    let v = { x: 0, y: 0 };
    for (let i = 0; i < 120; i++) v = pointingStep(v, p, STEP_MS);
    return v;
  };

  it('flies at oneArmSpeed of the cruising speed where it points; both arms at all of it', () => {
    const one = settle({ mode: 'fly', dx: 1, dy: 0, speed: cfg.oneArmSpeed, oneArm: true });
    expect(one.x).toBeCloseTo(cfg.oneArmSpeed * cfg.cruiseSpeed, 6);
    expect(one.y).toBeCloseTo(0, 6);
    expect(settle({ mode: 'fly', dx: 1, dy: 0 }).x).toBeCloseTo(cfg.cruiseSpeed, 6);
    const up = settle({ mode: 'fly', dx: 0, dy: 1, speed: cfg.oneArmSpeed, oneArm: true });
    expect(up.y).toBeCloseTo(-cfg.oneArmSpeed * cfg.cruiseSpeed, 6);
    // slower than both arms, faster than a drift, and gravity is held as in any flight
    expect(one.x).toBeLessThan(cfg.cruiseSpeed);
    expect(one.x).toBeGreaterThan(2 * cfg.driftSpeed);
    expect(pointingStep({ x: 0, y: 0 }, { mode: 'fly', dx: 1, dy: 0, speed: cfg.oneArmSpeed }, STEP_MS).gravity).toBe(0);
  });
});

/** a stretch of arm movement: `ms` long, each arm from one angle to another (deg from straight down, as `SynthPose`), linearly */
interface Move {
  ms: number;
  left: number | [number, number];
  right: number | [number, number];
}
const FRAME_MS = 1000 / 30;

/** plays `moves` through a detector at 30 fps; the player's left arm shows on the screen's left (mirrored view) */
function play(d: PointingDetector, moves: Move[], t0 = 0): (PointingOutput & { t: number })[] {
  const out: (PointingOutput & { t: number })[] = [];
  let t = t0;
  for (const m of moves) {
    const n = Math.max(1, Math.round(m.ms / FRAME_MS));
    for (let i = 0; i < n; i++) {
      const u = n > 1 ? i / (n - 1) : 1;
      const at = (a: number | [number, number]) => (typeof a === 'number' ? a : a[0] + (a[1] - a[0]) * u);
      out.push({ t, ...d.update(synthPose({ t, armLeft: at(m.left), armRight: at(m.right) }), true, true) });
      t += FRAME_MS;
    }
  }
  return out;
}
const DOWN = 8;

describe('PointingDetector: flying by one arm', () => {
  it('from the rest: flies where the arm points after oneArmEnterMs, not before, at the one-arm speed', () => {
    const d = new PointingDetector();
    play(d, [{ ms: 500, left: DOWN, right: DOWN }]);
    const out = play(d, [{ ms: 1500, left: DOWN, right: 90 }], 500);
    const first = out.find((o) => o.intent?.mode === 'fly')!;
    expect(first).toBeDefined();
    expect(first.t - 500).toBeGreaterThanOrEqual(cfg.oneArmEnterMs);
    expect(first.t - 500).toBeLessThan(cfg.oneArmEnterMs + 150);
    // until then the bird rests on: the pose is read, not followed
    for (const o of out.filter((x) => x.t < first.t)) {
      expect(o.intent?.mode).toBe('rest');
    }
    expect(out.at(-1)!.candidate?.oneArm).toBe(true);
    expect(out.at(-1)!.intent).toMatchObject({ mode: 'fly', oneArm: true, speed: cfg.oneArmSpeed });
    expect(out.at(-1)!.intent!.dx).toBeGreaterThan(0.98);
    // a flight just begun starts at its own speed: nothing to ease from
    expect(first.intent!.speed).toBe(cfg.oneArmSpeed);
  });

  it('follows the arm at once while flying by it: up, level, across the body', () => {
    const d = new PointingDetector();
    play(d, [{ ms: 800, left: DOWN, right: 90 }]);
    const up = play(d, [{ ms: 400, left: DOWN, right: [90, 175] }, { ms: 300, left: DOWN, right: 175 }], 800).at(-1)!;
    expect(up.intent).toMatchObject({ mode: 'fly', oneArm: true });
    expect(up.intent!.dy).toBeGreaterThan(0.95);
    // the other arm: the screen's left one pointing left
    const e = new PointingDetector();
    const left = play(e, [{ ms: 800, left: 90, right: DOWN }]).at(-1)!;
    expect(left.intent).toMatchObject({ mode: 'fly', oneArm: true });
    expect(left.intent!.dx).toBeLessThan(-0.98);
  });

  it('held only for a moment (under oneArmEnterMs): nothing happens', () => {
    const d = new PointingDetector();
    play(d, [{ ms: 500, left: DOWN, right: DOWN }]);
    const out = play(d, [{ ms: cfg.oneArmEnterMs - 70, left: DOWN, right: 90 }, { ms: 500, left: DOWN, right: DOWN }], 500);
    expect(out.every((o) => o.intent?.mode === 'rest')).toBe(true);
  });

  it('a detector told to leave one arm alone (a recording made before it) does, whatever the config says; and the other way round', () => {
    const d = new PointingDetector();
    d.oneArm = false;
    play(d, [{ ms: 500, left: DOWN, right: DOWN }]);
    const out = play(d, [{ ms: 1500, left: DOWN, right: 90 }], 500);
    expect(out.every((o) => o.candidate === null && o.intent?.mode === 'rest')).toBe(true);
    cfg.oneArm = false;
    const e = new PointingDetector();
    e.oneArm = true;
    expect(play(e, [{ ms: 1500, left: DOWN, right: 90 }]).at(-1)!.intent).toMatchObject({ mode: 'fly', oneArm: true });
    // continuous steering too
    cfg.oneArm = true;
    cfg.continuous = true;
    const c = new PointingDetector();
    c.oneArm = false;
    expect(play(c, [{ ms: 1500, left: DOWN, right: 180 }]).some((o) => o.intent?.oneArm)).toBe(false);
  });

  it('off: the pose matches nothing, and after ambiguousMs the bird rests (as before)', () => {
    cfg.oneArm = false;
    const d = new PointingDetector();
    play(d, [{ ms: 500, left: 90, right: 90 }]);
    const out = play(d, [{ ms: 150, left: [90, DOWN], right: 90 }, { ms: 1500, left: DOWN, right: 90 }], 500);
    expect(out.at(-1)!.candidate).toBeNull();
    expect(out.at(-1)!.intent?.mode).toBe('rest');
    expect(out.some((o) => o.intent?.mode === 'fly')).toBe(false);
  });
});

describe('PointingDetector: arms lowered or raised one after the other', () => {
  /** both arms from `from` to hanging, the right one `gap` ms after the left, each taking `sweep` ms */
  const lowering = (from: [number, number], gap: number, sweep = 200): Move[] => [
    { ms: 600, left: from[0], right: from[1] },
    { ms: sweep, left: [from[0], DOWN], right: from[1] },
    ...(gap > 0 ? [{ ms: gap, left: DOWN, right: from[1] }] : []),
    { ms: sweep, left: DOWN, right: [from[1], DOWN] },
    { ms: 600, left: DOWN, right: DOWN },
  ];
  const starts = (out: PointingOutput[], is: (p: PointingIntent) => boolean) => out.filter((o, i) => o.intent && is(o.intent) && !(i > 0 && out[i - 1].intent && is(out[i - 1].intent!))).length;

  // the one-arm pose is read from the first arm entering the rest cone until the second leaves `oneArmMinOut`: the
  // gap plus about two thirds of a sweep (on the recordings of play those passes lasted 34-305 ms)
  it('from a T to the rest: no flight on the way, whichever arm comes down first', () => {
    for (const gap of [0, 70, 130]) {
      for (const flip of [false, true]) {
        const moves = lowering([90, 90], gap).map((m) => (flip ? { ...m, left: m.right, right: m.left } : m));
        const out = play(new PointingDetector(), moves);
        expect(out.some((o) => o.intent?.mode === 'fly'), `gap ${gap}`).toBe(false);
        expect(out.at(-1)!.intent?.mode).toBe('rest');
        // the pose was read on the way (the right arm still level, the left one down): it just was not followed
        if (gap >= 70) expect(out.some((o) => o.candidate?.oneArm), `gap ${gap}`).toBe(true);
      }
    }
  });

  it('...and the bird is told exactly what it was told without one arm steering', () => {
    for (const from of [[90, 90], [150, 150], [90, 120]] as [number, number][])
      for (const gap of [0, 70, 130]) {
        cfg.oneArm = true;
        const on = play(new PointingDetector(), lowering(from, gap)).map((o) => o.intent);
        cfg.oneArm = false;
        const off = play(new PointingDetector(), lowering(from, gap)).map((o) => o.intent);
        expect(on, `${from} gap ${gap}`).toEqual(off);
      }
  });

  it('from a flight by both arms (a V) to the rest: it never flies by one arm, nor turns towards the arm still up', () => {
    for (const gap of [0, 70, 130]) {
      const out = play(new PointingDetector(), lowering([150, 150], gap));
      expect(out.some((o) => o.intent?.oneArm), `gap ${gap}`).toBe(false);
      // the right arm (the one still up) sweeps down through level: the bird is never told to fly to the right
      for (const o of out) if (o.intent?.mode === 'fly') expect(o.intent.dx, `gap ${gap}`).toBeLessThan(0.3);
      expect(out.at(-1)!.intent?.mode).toBe('rest');
    }
  });

  it('from the rest to a T, one arm after the other: no flight on the way', () => {
    for (const gap of [0, 70, 130]) {
      const out = play(new PointingDetector(), [
        { ms: 500, left: DOWN, right: DOWN },
        { ms: 200, left: [DOWN, 90], right: DOWN },
        ...(gap > 0 ? [{ ms: gap, left: 90, right: DOWN }] : []),
        { ms: 200, left: 90, right: [DOWN, 90] },
        { ms: 600, left: 90, right: 90 },
      ]);
      expect(out.some((o) => o.intent?.mode === 'fly'), `gap ${gap}`).toBe(false);
      expect(out.at(-1)!.intent?.mode).toBe('hover');
    }
  });

  it('held long enough it does fly: one flight, started once', () => {
    const out = play(new PointingDetector(), lowering([90, 90], 900));
    expect(starts(out, (p) => p.mode === 'fly')).toBe(1);
    const flying = out.filter((o) => o.intent?.mode === 'fly');
    expect(flying.every((o) => o.intent!.oneArm && o.intent!.dx > 0.9)).toBe(true);
    expect(flying.length * FRAME_MS).toBeGreaterThan(900 - cfg.oneArmEnterMs - 100);
  });
});

describe('PointingDetector: between both arms and one arm the speed eases', () => {
  /** the speed asked for at each frame, of the cruising speed */
  const speeds = (out: PointingOutput[]) => out.map((o) => (o.intent?.mode === 'fly' ? (o.intent.speed ?? 1) : NaN));
  // both arms up; then the left one comes down and stays down; then it goes up again
  const moves: Move[] = [
    { ms: 600, left: 170, right: 170 },
    { ms: 130, left: [170, DOWN], right: 170 },
    { ms: 1500, left: DOWN, right: 170 },
    { ms: 130, left: [DOWN, 170], right: 170 },
    { ms: 1200, left: 170, right: 170 },
  ];

  it('both arms -> one arm -> both arms: the bird flies on throughout, the speed 1 -> oneArmSpeed -> 1 without a step', () => {
    const out = play(new PointingDetector(), moves);
    const flying = out.filter((o) => o.t >= 300);
    expect(flying.every((o) => o.intent?.mode === 'fly')).toBe(true);
    const s = speeds(flying);
    expect(Math.min(...s)).toBeCloseTo(cfg.oneArmSpeed, 6);
    expect(Math.max(...s)).toBe(1);
    // per frame at most the EMA's share of the whole change (33 ms of a 150 ms time constant: a fifth)
    const step = (1 - cfg.oneArmSpeed) * (1 - Math.exp(-FRAME_MS / cfg.oneArmBlendMs)) + 1e-9;
    for (let i = 1; i < s.length; i++) expect(Math.abs(s[i] - s[i - 1]), `frame ${i}`).toBeLessThanOrEqual(step);
    // down to the one-arm speed while one arm is down, back to the full speed (no `speed` at all) with both up
    const one = flying.filter((o) => o.intent!.oneArm);
    expect(one.length * FRAME_MS).toBeGreaterThan(1000);
    expect(one.at(-1)!.intent!.speed).toBe(cfg.oneArmSpeed);
    expect(out.at(-1)!.intent!.speed).toBeUndefined();
    expect(out.at(-1)!.intent!.oneArm).toBeUndefined();
    // it takes a few frames either way, not one
    const easing = s.filter((x) => x > cfg.oneArmSpeed + 0.01 && x < 0.99).length;
    expect(easing).toBeGreaterThanOrEqual(8);
  });

  it('the bird itself: no stop, no jolt, its speed between the two', () => {
    const out = play(new PointingDetector(), moves);
    let v = { x: 0, y: 0 };
    const vs: { x: number; y: number }[] = [];
    // each camera frame is two physics steps
    for (const o of out) for (let k = 0; k < 2; k++) vs.push((v = pointingStep(v, o.intent!, STEP_MS)));
    const from = Math.round(400 / STEP_MS);
    const sp = vs.slice(from).map((x) => Math.hypot(x.x, x.y));
    expect(Math.min(...sp)).toBeGreaterThan(cfg.oneArmSpeed * cfg.cruiseSpeed - 0.3);
    expect(Math.max(...sp)).toBeLessThanOrEqual(cfg.cruiseSpeed + 1e-6);
    // within 100 ms the velocity changes by less than a jolt (5 px per step: the most is the turn from where the V
    // pointed to where the one arm does); the speed alone by under 1.5 (the 2.1 between the two speeds, spread out)
    let worst = 0, worstSpeed = 0;
    for (let i = from + 6; i < vs.length; i++) {
      worst = Math.max(worst, Math.hypot(vs[i].x - vs[i - 6].x, vs[i].y - vs[i - 6].y));
      worstSpeed = Math.max(worstSpeed, Math.abs(Math.hypot(vs[i].x, vs[i].y) - Math.hypot(vs[i - 6].x, vs[i - 6].y)));
    }
    expect(worst).toBeLessThan(4);
    expect(worstSpeed).toBeLessThan(1.5);
  });

  it('with oneArmBlendMs 0 the speed steps (what the easing is for)', () => {
    cfg.oneArmBlendMs = 0;
    const s = speeds(play(new PointingDetector(), moves).filter((o) => o.t >= 300));
    let worst = 0;
    for (let i = 1; i < s.length; i++) worst = Math.max(worst, Math.abs(s[i] - s[i - 1]));
    expect(worst).toBeCloseTo(1 - cfg.oneArmSpeed, 6);
  });
});

describe('continuous steering by one arm', () => {
  const speed = (p: PointingIntent) => Math.hypot(p.vx ?? 0, p.vy ?? 0);
  const one = cfg.oneArmSpeed * cfg.cruiseSpeed;

  it('one arm hanging, the other pointing: flies where it points at the one-arm speed', () => {
    for (const [out, deg] of [[90, 0], [180, 90], [135, 45], [-120, 150]] as const) {
      const p = continuousArms(leftArm(3), rightArm(out));
      expect(p, `${out}`).toMatchObject({ mode: 'fly', oneArm: true });
      expect(speed(p)).toBeCloseTo(one, 2);
      expect(p.dx).toBeCloseTo(dir(deg).x, 2);
      expect(p.dy).toBeCloseTo(dir(deg).y, 2);
    }
    expect(oneArmWeight(leftArm(3), rightArm(90)).w).toBeCloseTo(1, 3);
  });

  it('not let through yet (the gain at 0): a hover, or the flight the bird was on', () => {
    const waiting = continuousArms(leftArm(3), rightArm(90), { gain: 0 });
    expect(waiting.mode).toBe('hover');
    expect(speed(waiting)).toBeLessThan(0.05);
    const carried = continuousArms(leftArm(3), rightArm(90), { gain: 0, carry: { vx: 0, vy: -7 } });
    expect(carried.mode).toBe('fly');
    expect(carried.oneArm).toBeUndefined();
    expect(carried.vy).toBeCloseTo(-7, 2);
    // half way: half of each
    const half = continuousArms(leftArm(3), rightArm(90), { gain: 0.5, carry: { vx: 0, vy: -7 } });
    expect(half.vx).toBeCloseTo(one / 2, 2);
    expect(half.vy).toBeCloseTo(-3.5, 2);
  });

  it('a tilted T with its lower arm 25° and more from straight down, and arms pointing together, are as without it', () => {
    const same = (l: { x: number; y: number }, r: { x: number; y: number }) => {
      const p = continuousArms(l, r), q = bothArms(l, r);
      expect(p.vx).toBeCloseTo(q.vx, 9);
      expect(p.vy).toBeCloseTo(q.vy, 9);
      expect(p.oneArm).toBeUndefined();
    };
    for (const low of [25, 30, 34, 45, 60]) for (const high of [60, 75, 90, 110, 140]) same(leftArm(low), rightArm(high));
    // pointing together, one of them in the cone: both arms' flight
    for (const [l, r] of [[-50, 25], [10, -40], [30, -50]]) same(leftArm(l), rightArm(r));
    expect(oneArmWeight(leftArm(30), rightArm(90)).w).toBe(0);
  });

  it('but with the pointing arm raised steeply (no T reaches there) the whole rest cone hangs', () => {
    // straight up beside an arm 28° out: mostly the one-arm flight, up
    const p = continuousArms(leftArm(28), rightArm(180));
    expect(oneArmWeight(leftArm(28), rightArm(180)).w).toBeGreaterThan(0.6);
    expect(p.mode).toBe('fly');
    expect(p.dy).toBeGreaterThan(0.95);
  });

  it('off: exactly the command of both arms', () => {
    cfg.oneArm = false;
    for (let l = -180; l < 180; l += 15)
      for (let r = -172; r < 180; r += 15) {
        const p = continuousArms(dir(l), dir(r));
        if (p.mode === 'rest') continue;
        const q = bothArms(dir(l), dir(r));
        expect(p.vx).toBeCloseTo(q.vx, 12);
        expect(p.vy).toBeCloseTo(q.vy, 12);
      }
    expect(oneArmWeight(leftArm(3), rightArm(90)).w).toBe(0);
  });

  describe('the detector', () => {
    beforeEach(() => {
      cfg.continuous = true;
    });

    it('from the rest: hovers while the pose waits, then eases into the one-arm flight', () => {
      const d = new PointingDetector();
      play(d, [{ ms: 500, left: DOWN, right: DOWN }]);
      const out = play(d, [{ ms: 1800, left: DOWN, right: 90 }], 500);
      const waiting = out.filter((o) => o.t - 500 > cfg.enterMs + 2 * FRAME_MS && o.t - 500 < cfg.oneArmEnterMs);
      expect(waiting.length).toBeGreaterThan(2);
      for (const o of waiting) {
        expect(o.intent?.mode).toBe('hover');
        expect(speed(o.intent!)).toBeLessThan(0.1);
      }
      const last = out.at(-1)!.intent!;
      expect(last).toMatchObject({ mode: 'fly', oneArm: true });
      expect(last.vx).toBeCloseTo(one, 1);
      expect(Math.abs(last.vy!)).toBeLessThan(0.1);
      // eased in: no frame-to-frame step of more than a fifth of it (33 ms of the 150 ms time constant)
      const vs = out.map((o) => speed(o.intent!));
      for (let i = 1; i < vs.length; i++) expect(vs[i] - vs[i - 1], `frame ${i}`).toBeLessThan(one * 0.21);
    });

    it('arms lowered one after the other from a T: a hover in between, never the one-arm flight', () => {
      for (const gap of [70, 130]) {
        const out = play(new PointingDetector(), [
          { ms: 600, left: 90, right: 90 },
          { ms: 200, left: [90, DOWN], right: 90 },
          { ms: gap, left: DOWN, right: 90 },
          { ms: 200, left: DOWN, right: [90, DOWN] },
          { ms: 600, left: DOWN, right: DOWN },
        ]);
        expect(out.some((o) => o.intent?.oneArm), `gap ${gap}`).toBe(false);
        // while the left arm hangs and the right one is still level: next to no command (it was 3.75 px/step
        // diagonally down towards the level arm before one arm steering)
        for (const o of out.filter((x) => x.t >= 800 && x.t < 800 + gap)) expect(speed(o.intent!), `gap ${gap}`).toBeLessThan(0.5);
        expect(out.at(-1)!.intent?.mode).toBe('rest');
      }
    });

    it('both arms -> one arm: the flight carries on, then turns into the one-arm flight without a stop or a step', () => {
      // from the arm hanging (on its way down the arms are neither, for a frame: a T as far as the map can tell)
      const out = play(new PointingDetector(), [
        { ms: 600, left: 170, right: 170 },
        { ms: 130, left: [170, DOWN], right: 170 },
        { ms: 1500, left: DOWN, right: 170 },
      ]).filter((o) => o.t >= 730);
      const vs = out.map((o) => speed(o.intent!));
      expect(out.every((o) => o.intent?.mode === 'fly')).toBe(true);
      // while the pose waits the bird flies on as it did, not by one arm yet
      expect(out.filter((o) => o.t - 730 < cfg.oneArmEnterMs - FRAME_MS).every((o) => !o.intent!.oneArm && speed(o.intent!) > one)).toBe(true);
      expect(Math.min(...vs)).toBeGreaterThan(one - 0.5);
      expect(Math.max(...vs)).toBeLessThanOrEqual(cfg.cruiseSpeed + 1e-6);
      for (let i = 1; i < out.length; i++) {
        const a = out[i - 1].intent!, b = out[i].intent!;
        expect(Math.hypot(b.vx! - a.vx!, b.vy! - a.vy!), `frame ${i}`).toBeLessThan(1.5);
      }
      const last = out.at(-1)!.intent!;
      expect(last.oneArm).toBe(true);
      expect(speed(last)).toBeCloseTo(one, 1);
      expect(last.dy).toBeGreaterThan(0.95);
    });
  });
});
