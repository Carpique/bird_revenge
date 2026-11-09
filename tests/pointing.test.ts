import { describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { classifyArms, pointingStep, type PointingIntent } from '../src/game/pointing';
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
    expect(classifyArms(dir(135), dir(45))).toBeNull(); // a wide V
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
