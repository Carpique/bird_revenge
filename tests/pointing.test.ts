import { describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { classifyArms, outwardElevation, pointingStep, type PointingIntent, type PointingMode } from '../src/game/pointing';
import { STEP_MS } from '../src/game/physics';
import { PointingDetector } from '../src/gestures/PointingDetector';
import { frames } from './synthetic';

/** direction on screen (y up) at `deg` (0 = right, 90 = up) */
const dir = (deg: number) => ({ x: Math.cos((deg * Math.PI) / 180), y: Math.sin((deg * Math.PI) / 180) });

describe('classifyArms', () => {
  it('arms hanging down, a little apart: rest', () => {
    expect(classifyArms(dir(-100), dir(-80))?.mode).toBe('rest');
    expect(classifyArms(dir(-115), dir(-70))?.mode).toBe('rest');
  });

  it('T: hover, with leeway for a sloppy T', () => {
    expect(classifyArms(dir(180), dir(0))?.mode).toBe('hover');
    // both raised a bit, both drooping a bit, one bent a bit off
    expect(classifyArms(dir(150), dir(30))?.mode).toBe('hover');
    expect(classifyArms(dir(-155), dir(-25))?.mode).toBe('hover');
    expect(classifyArms(dir(170), dir(-10))?.mode).toBe('hover'); // tilted 10°: still level
  });

  it('tilted T: drift towards the lower hand', () => {
    // the right hand lower
    expect(classifyArms(dir(155), dir(-25))).toMatchObject({ mode: 'drift', dx: 1, dy: 0 });
    // the left hand lower
    expect(classifyArms(dir(-145), dir(35))).toMatchObject({ mode: 'drift', dx: -1, dy: 0 });
  });

  it('tilt hysteresis: once drifting, a slightly smaller tilt keeps drifting', () => {
    const t = config.pointing.tiltDeadZone - config.pointing.tiltHysteresis / 2;
    expect(classifyArms(dir(180 - t), dir(-t), 'hover')?.mode).toBe('hover');
    expect(classifyArms(dir(180 - t), dir(-t), 'drift')?.mode).toBe('drift');
  });

  it('both arms pointing the same way: fly that way', () => {
    for (const deg of [90, 0, 180, 45, 135, -30, -150]) {
      const p = classifyArms(dir(deg - 10), dir(deg + 10))!;
      expect(p.mode, `${deg}°`).toBe('fly');
      expect(p.dx).toBeCloseTo(Math.cos((deg * Math.PI) / 180), 5);
      expect(p.dy).toBeCloseTo(Math.sin((deg * Math.PI) / 180), 5);
    }
  });

  it('nothing in particular: no reading', () => {
    expect(classifyArms(dir(90), dir(0))).toBeNull(); // one up, one out
    // a steeply tilted T, one arm barely above level: no V
    expect(classifyArms(dir(175), dir(80))).toBeNull();
    expect(classifyArms(dir(100), dir(5))).toBeNull();
  });

  describe('arms raised in a V (vUp)', () => {
    const withV = <T>(on: boolean, f: () => T) => {
      const was = config.pointing.vUp;
      config.pointing.vUp = on;
      try {
        return f();
      } finally {
        config.pointing.vUp = was;
      }
    };

    it('a symmetric V: flies straight up', () => {
      for (const e of [45, 50, 60]) {
        const p = classifyArms(dir(180 - e), dir(e))!;
        expect(p, `${e}°`).toMatchObject({ mode: 'fly' });
        expect(p.dx).toBeCloseTo(0, 5);
        expect(p.dy).toBeCloseTo(1, 5);
      }
    });

    it('a lopsided V: up and towards the lower arm', () => {
      // the left arm 20° above level, the right 70°: up and to the left, where the two arms point together
      const left = classifyArms(dir(160), dir(70))!;
      expect(left.mode).toBe('fly');
      expect(Math.atan2(left.dy, left.dx) * (180 / Math.PI)).toBeCloseTo(115, 5);
      const right = classifyArms(dir(110), dir(25))!;
      expect(right.mode).toBe('fly');
      expect(right.dx).toBeGreaterThan(0.3);
      expect(right.dy).toBeGreaterThan(0.7);
    });

    it('an arm below vMinArm: no V', () => {
      const m = config.pointing.vMinArm;
      expect(classifyArms(dir(180 - (m - 2)), dir(85))).toBeNull();
      expect(classifyArms(dir(180 - (m + 2)), dir(85))?.mode).toBe('fly');
    });

    it('rest, the T, the tilted T and parallel arms keep their meaning', () => {
      expect(classifyArms(dir(-100), dir(-80))?.mode).toBe('rest');
      expect(classifyArms(dir(150), dir(30))?.mode).toBe('hover'); // raised 30°: still a T
      const raised = config.pointing.tMaxRaise - 2;
      expect(classifyArms(dir(180 - raised), dir(raised))?.mode).toBe('hover');
      expect(classifyArms(dir(155), dir(-25))).toMatchObject({ mode: 'drift', dx: 1 });
      expect(classifyArms(dir(-145), dir(35))).toMatchObject({ mode: 'drift', dx: -1 });
      expect(classifyArms(dir(80), dir(100))).toMatchObject({ mode: 'fly' });
    });

    it('hysteresis: once flying, a V a little below the thresholds still flies, and comes before the T', () => {
      const h = config.pointing.vHysteresis;
      // the arms' average just under tMaxRaise: a T, unless already flying
      const e = config.pointing.tMaxRaise - h / 2;
      for (const current of [null, 'hover', 'drift', 'rest'] as const) expect(classifyArms(dir(180 - e), dir(e), current)?.mode).toBe('hover');
      expect(classifyArms(dir(180 - e), dir(e), 'fly')).toMatchObject({ mode: 'fly', dy: expect.closeTo(1, 5) });
      // further down: a T again
      const below = config.pointing.tMaxRaise - h - 2;
      expect(classifyArms(dir(180 - below), dir(below), 'fly')?.mode).toBe('hover');
      // an arm just under vMinArm
      const m = config.pointing.vMinArm - h / 2;
      expect(classifyArms(dir(180 - m), dir(85), 'hover')).toBeNull();
      expect(classifyArms(dir(180 - m), dir(85), 'fly')?.mode).toBe('fly');
    });

    it('off: every pose reads as before', () => {
      // classifyArms as it was before the V
      const before = (l: { x: number; y: number }, r: { x: number; y: number }, current: PointingMode | null) => {
        const deg = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y))) * (180 / Math.PI);
        const cfg = config.pointing;
        const down = { x: 0, y: -1 };
        if (deg(l, down) <= cfg.restCone && deg(r, down) <= cfg.restCone) return { mode: 'rest', dx: 0, dy: 0 };
        const eL = outwardElevation(l, -1), eR = outwardElevation(r, 1);
        if (Math.abs(eL) <= cfg.tMaxArm && Math.abs(eR) <= cfg.tMaxArm && Math.abs((eL + eR) / 2) <= cfg.tMaxRaise) {
          const tilt = (eR - eL) / 2;
          if (Math.abs(tilt) < cfg.tiltDeadZone - (current === 'drift' ? cfg.tiltHysteresis : 0)) return { mode: 'hover', dx: 0, dy: 0 };
          return { mode: 'drift', dx: tilt > 0 ? -1 : 1, dy: 0 };
        }
        if (deg(l, r) <= cfg.parallelMax) {
          const n = Math.hypot(l.x + r.x, l.y + r.y) || 1;
          return { mode: 'fly', dx: (l.x + r.x) / n, dy: (l.y + r.y) / n };
        }
        return null;
      };
      let vs = 0;
      // b off the 5° grid, so no pose sits exactly on a threshold (rounding would decide it)
      withV(false, () => {
        for (let a = -180; a < 180; a += 5)
          for (let b = -178.5; b < 180; b += 5)
            for (const current of [null, 'rest', 'hover', 'drift', 'fly'] as const) {
              const got = classifyArms(dir(a), dir(b), current);
              const want = before(dir(a), dir(b), current);
              if (want === null) expect(got, `${a} ${b} ${current}`).toBeNull();
              else {
                expect(got, `${a} ${b} ${current}`).toMatchObject({ mode: want.mode });
                expect(got!.dx).toBeCloseTo(want.dx, 9);
                expect(got!.dy).toBeCloseTo(want.dy, 9);
              }
            }
      });
      // and on, some of those poses are a V
      for (let a = -180; a < 180; a += 5) for (let b = -178.5; b < 180; b += 5) if (!before(dir(a), dir(b), null) && classifyArms(dir(a), dir(b))) vs++;
      expect(vs).toBeGreaterThan(50);
    });
  });
});

describe('pointing physics', () => {
  /** 2 s airborne with Matter's gravity and air friction, from velocity v0 (px/step, y down) */
  const fly = (p: PointingIntent, v0 = { x: 0, y: 0 }) => {
    const g = config.physics.gravity * 1e-3 * STEP_MS ** 2;
    let v = { ...v0 };
    for (let i = 0; i < 120; i++) {
      const s = pointingStep(v, p, STEP_MS);
      const k = 1 - (p.mode === 'rest' ? config.physics.birdAirFriction : config.pointing.airFriction);
      v = { x: s.x * k, y: (s.y + g * s.gravity) * k };
    }
    return v;
  };

  it('fly: cruising speed in the pointed direction, whatever it is', () => {
    const up = fly({ mode: 'fly', dx: 0, dy: 1 }, { x: 0, y: 6 });
    expect(up.y).toBeLessThan(-config.pointing.cruiseSpeed * 0.95);
    expect(Math.abs(up.x)).toBeLessThan(0.1);
    const d = fly({ mode: 'fly', dx: Math.SQRT1_2, dy: -Math.SQRT1_2 });
    expect(Math.hypot(d.x, d.y)).toBeGreaterThan(config.pointing.cruiseSpeed * 0.95);
    expect(d.x).toBeGreaterThan(0);
    expect(d.y).toBeGreaterThan(0);
  });

  it('hover: stops and holds its place', () => {
    const v = fly({ mode: 'hover', dx: 0, dy: 0 }, { x: 6, y: 5 });
    expect(Math.hypot(v.x, v.y)).toBeLessThan(0.1);
  });

  it('drift: slow and level', () => {
    const v = fly({ mode: 'drift', dx: -1, dy: 0 }, { x: 0, y: 4 });
    expect(v.x).toBeLessThan(-config.pointing.driftSpeed * 0.95);
    expect(v.x).toBeGreaterThan(-config.pointing.driftSpeed * 1.05);
    expect(Math.abs(v.y)).toBeLessThan(0.1);
  });

  it('drift with the arms lowered: sideways and down, at the sinking speed', () => {
    const v = fly({ mode: 'drift', dx: 1, dy: 0, sink: 1.2 });
    expect(v.x).toBeGreaterThan(config.pointing.driftSpeed * 0.95);
    expect(v.y).toBeGreaterThan(1.2 * 0.95);
    expect(v.y).toBeLessThan(1.2 * 1.05);
  });

  it('rest: momentum fades, falls', () => {
    const v = fly({ mode: 'rest', dx: 0, dy: 0 }, { x: 8, y: -6 });
    expect(Math.abs(v.x)).toBeLessThan(0.5);
    expect(v.y).toBeGreaterThan(3);
  });
});

describe('PointingDetector', () => {
  const last = (fs: ReturnType<typeof frames>) => {
    const d = new PointingDetector();
    return fs.map((f) => d.update(f, true, true)).at(-1)!;
  };

  it('arms down: rest; T: hover', () => {
    expect(last(frames(500, () => ({ armLeft: 10, armRight: 10 }))).intent?.mode).toBe('rest');
    expect(last(frames(500, () => ({ armLeft: 90, armRight: 90 }))).intent?.mode).toBe('hover');
  });

  it("tilted T with the player's right hand lower: drifts to the screen's right", () => {
    // the player's right arm shows on the screen's right (mirrored view)
    expect(last(frames(500, () => ({ armLeft: 120, armRight: 60 }))).intent).toMatchObject({ mode: 'drift', dx: 1 });
  });

  it('both arms up: flies up; both pointing to the screen right: flies right', () => {
    const up = last(frames(500, () => ({ armLeft: 180, armRight: 180 }))).intent!;
    expect(up.mode).toBe('fly');
    expect(up.dy).toBeGreaterThan(0.95);
    // the player's left arm crosses the body (rotated inwards)
    const right = last(frames(500, () => ({ armLeft: -90, armRight: 90 }))).intent!;
    expect(right.mode).toBe('fly');
    expect(right.dx).toBeGreaterThan(0.95);
  });

  describe('arms raised in a V', () => {
    // elevations: 90 level, 180 straight up; a V 45° above level is 135
    const run = (d: PointingDetector, ms: number, pose: { armLeft: number; armRight: number }, t0 = 0) =>
      frames(ms, () => pose, t0).map((f) => d.update(f, true, true));

    it('from a T: flies up after enterMs, and keeps flying up however long the V is held', () => {
      const d = new PointingDetector();
      run(d, 500, { armLeft: 90, armRight: 90 });
      const out = run(d, 1500, { armLeft: 135, armRight: 135 }, 500);
      const first = out.findIndex((o) => o.intent?.mode === 'fly');
      expect(first).toBeGreaterThan(0);
      expect(out.slice(first).every((o) => o.intent?.mode === 'fly' && o.intent.dy > 0.99)).toBe(true);
    });

    it('off: a V matches nothing, and after ambiguousMs the bird rests (as before)', () => {
      const was = config.pointing.vUp;
      config.pointing.vUp = false;
      try {
        const d = new PointingDetector();
        run(d, 500, { armLeft: 90, armRight: 90 });
        const o = run(d, 1500, { armLeft: 135, armRight: 135 }, 500).at(-1)!;
        expect(o.candidate).toBeNull();
        expect(o.intent?.mode).toBe('rest');
      } finally {
        config.pointing.vUp = was;
      }
    });

    it('lowered to a raised T: keeps flying within vHysteresis, hovers below it', () => {
      const t = config.pointing.tMaxRaise;
      const h = config.pointing.vHysteresis;
      const d = new PointingDetector();
      run(d, 800, { armLeft: 135, armRight: 135 });
      // the smoothed arms pass through the band on the way down: flying, never hovering
      const kept = run(d, 800, { armLeft: 90 + t - h / 2, armRight: 90 + t - h / 2 }, 800);
      expect(kept.every((o) => o.intent?.mode === 'fly')).toBe(true);
      const lowered = run(d, 800, { armLeft: 90 + t - h - 5, armRight: 90 + t - h - 5 }, 1600);
      expect(lowered.at(-1)!.intent?.mode).toBe('hover');
      // and the same raised T from a hover stays a hover
      const d2 = new PointingDetector();
      run(d2, 500, { armLeft: 90, armRight: 90 });
      expect(run(d2, 800, { armLeft: 90 + t - h / 2, armRight: 90 + t - h / 2 }, 500).every((o) => o.intent?.mode === 'hover')).toBe(true);
    });
  });

  it('a pose held shorter than enterMs is ignored', () => {
    const d = new PointingDetector();
    const fs = frames(1000, (t) => (t >= 500 && t < 500 + config.pointing.enterMs / 2 ? { armLeft: 180, armRight: 180 } : { armLeft: 90, armRight: 90 }));
    expect(fs.map((f) => d.update(f, true, true)).every((o) => o.intent?.mode !== 'fly')).toBe(true);
  });

  describe('a tilted T with the arms lowered descends', () => {
    // elevations: 90 level, below 90 lowered (armLeft / armRight: the player's arms)
    const LOWERED = { armLeft: 80, armRight: 40 }; // -10 / -50: 30 below level on average, tilted 20: drift
    const run = (d: PointingDetector, ms: number, pose: { armLeft: number; armRight: number }, t0 = 0) =>
      frames(ms, () => pose, t0).map((f) => d.update(f, true, true));
    const expectedSink = (lowered: number) =>
      config.pointing.descendSpeed * Math.min(1, Math.max(0, (lowered - config.pointing.descendZero) / (config.pointing.descendFull - config.pointing.descendZero)));

    it('sinks the lower the arms are, towards the lower hand', () => {
      const o = run(new PointingDetector(), 800, LOWERED).at(-1)!;
      expect(o.intent).toMatchObject({ mode: 'drift', dx: 1 });
      expect(o.intent!.sink!).toBeCloseTo(expectedSink(30), 1);
    });

    it('a level tilted T keeps its altitude; a lowered T not tilted still hovers', () => {
      const level = run(new PointingDetector(), 800, { armLeft: 120, armRight: 60 }).at(-1)!;
      expect(level.intent).toMatchObject({ mode: 'drift' });
      expect(level.intent!.sink ?? 0).toBe(0);
      const sloppy = run(new PointingDetector(), 800, { armLeft: 62, armRight: 62 }).at(-1)!; // 28 below, level
      expect(sloppy.intent!.mode).toBe('hover');
      expect(sloppy.intent!.sink ?? 0).toBe(0);
    });

    it('hysteresis: 18 below level does not start it, but keeps it going once started; 12 below stops it', () => {
      const SLIGHT = { armLeft: 92, armRight: 52 }; // +2 / -38: 18 below, tilted 20
      const ABOVE_EXIT = { armLeft: 98, armRight: 58 }; // +8 / -32: 12 below
      expect(run(new PointingDetector(), 800, SLIGHT).every((o) => !o.intent?.sink)).toBe(true);
      const d = new PointingDetector();
      run(d, 800, LOWERED);
      const kept = run(d, 600, SLIGHT, 800).at(-1)!;
      expect(kept.intent!.sink!).toBeCloseTo(expectedSink(18), 1);
      const stopped = run(d, 600, ABOVE_EXIT, 1400).at(-1)!;
      expect(stopped.intent).toMatchObject({ mode: 'drift' });
      expect(stopped.intent!.sink ?? 0).toBe(0);
    });

    it('starts only after enterMs, and the speed picks up smoothly', () => {
      const d = new PointingDetector();
      run(d, 600, { armLeft: 120, armRight: 60 }); // a level drift first
      const out = run(d, 600, LOWERED, 600);
      const firstSink = out.findIndex((o) => (o.intent?.sink ?? 0) > 0);
      expect(firstSink).toBeGreaterThan(0);
      expect(out[firstSink].intent!.sink!).toBeLessThan(expectedSink(30) * 0.8); // not straight to full speed
    });

    it('off (pointing.descend false): a lowered tilted T keeps its altitude', () => {
      const was = config.pointing.descend;
      config.pointing.descend = false;
      try {
        expect(run(new PointingDetector(), 800, LOWERED).at(-1)!.intent!.sink ?? 0).toBe(0);
      } finally {
        config.pointing.descend = was;
      }
    });
  });

  it('no intent while an arm is out of view', () => {
    const d = new PointingDetector();
    const o = frames(200, () => ({ armLeft: 90, armRight: 90 })).map((f) => d.update(f, true, false)).at(-1)!;
    expect(o.intent).toBeNull();
  });
});
