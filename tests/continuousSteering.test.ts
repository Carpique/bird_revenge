import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { classifyArms, continuousArms, outwardElevation, pointingFlapRate, pointingLean, pointingStep, type PointingIntent } from '../src/game/pointing';
import { STEP_MS } from '../src/game/physics';
import { PointingDetector } from '../src/gestures/PointingDetector';
import { frames } from './synthetic';

/** direction on screen (y up) at `deg` (0 = right, 90 = up) */
const dir = (deg: number) => ({ x: Math.cos((deg * Math.PI) / 180), y: Math.sin((deg * Math.PI) / 180) });
const speed = (p: PointingIntent) => Math.hypot(p.vx ?? 0, p.vy ?? 0);
/** a T tilted `tilt` deg (+: the right hand higher) and lowered `low` deg (both arms, on average) */
const T = (tilt: number, low = 0) => [dir(180 + low + tilt), dir(-low + tilt)] as const;

describe('continuousArms: the pure poses', () => {
  it('arms hanging (both in the rest cone): rest, no velocity', () => {
    const p = continuousArms(dir(-100), dir(-80));
    expect(p.mode).toBe('rest');
    expect(p.vx).toBeUndefined();
  });

  it('parallel arms fly where they point at the cruising speed, as the poses do', () => {
    for (const deg of [90, 0, 180, 45, 135, -30, -150]) {
      const p = continuousArms(dir(deg - 10), dir(deg + 10));
      const d = classifyArms(dir(deg - 10), dir(deg + 10))!;
      expect(p.mode, `${deg}`).toBe('fly');
      expect(speed(p)).toBeCloseTo(config.pointing.cruiseSpeed, 6);
      expect(p.vx! / config.pointing.cruiseSpeed).toBeCloseTo(d.dx, 6);
      expect(-p.vy! / config.pointing.cruiseSpeed).toBeCloseTo(d.dy, 6);
    }
  });

  it('a level T, also raised or lowered a little: hover, no velocity', () => {
    for (const low of [-25, -10, 0, 10, 25]) {
      const p = continuousArms(...T(0, low));
      expect(p.mode, `${low}`).toBe('hover');
      expect(speed(p)).toBeLessThan(1e-9);
    }
  });

  it('a tilted T: drifts towards the lower hand at the drift speed, keeping its altitude', () => {
    const right = continuousArms(...T(-30)); // the right hand lower
    expect(right).toMatchObject({ mode: 'drift', dx: 1 });
    expect(right.vx).toBeCloseTo(config.pointing.driftSpeed, 6);
    expect(right.vy).toBeCloseTo(0, 9);
    const left = continuousArms(...T(30));
    expect(left.vx).toBeCloseTo(-config.pointing.driftSpeed, 6);
    expect(left.vy).toBeCloseTo(0, 9);
    // inside the dead zone: hover
    expect(continuousArms(...T(config.pointing.tiltDeadZone - 1)).mode).toBe('hover');
  });

  it('a lowered tilted T descends towards the lower hand; with descend off it keeps its altitude', () => {
    const p = continuousArms(...T(-30, 25));
    expect(p.mode).toBe('drift');
    expect(p.vx).toBeGreaterThan(1);
    expect(p.vy).toBeGreaterThan(0.5);
    expect(p.sink).toBe(p.vy);
    const was = config.pointing.descend;
    config.pointing.descend = false;
    try {
      expect(continuousArms(...T(-30, 25)).vy).toBeCloseTo(0, 9);
    } finally {
      config.pointing.descend = was;
    }
  });

  it('a symmetric V climbs straight up, faster the higher the arms; a shallow one hovers', () => {
    const v = (a: number) => continuousArms(dir(180 - a), dir(a));
    expect(v(20).mode).toBe('hover');
    let last = 0;
    for (const a of [36, 42, 50, 56]) {
      const p = v(a);
      expect(p.vx).toBeCloseTo(0, 9);
      expect(p.vy!).toBeLessThan(-last);
      last = -p.vy!;
    }
    expect(last).toBeLessThan(config.pointing.cruiseSpeed);
    expect(v(70).vy).toBeCloseTo(-config.pointing.cruiseSpeed, 6);
  });

  it('arms low and apart (an A) descend', () => {
    const p = continuousArms(dir(-130), dir(-50));
    expect(p.vx).toBeCloseTo(0, 9);
    expect(p.vy).toBeGreaterThan(1);
  });
});

/** an arm's outward elevation (deg) to its direction on screen: `side` -1 the left arm, +1 the right */
const arm = (side: -1 | 1, elev: number) => dir(side < 0 ? 180 - elev : elev);
const ss = (x: number, a: number, b: number) => {
  const k = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};
/** the map before spread arms banked towards the lower hand (e71fb9e): the mean's own sideways part */
function preFix(l: { x: number; y: number }, r: { x: number; y: number }) {
  const cfg = config.pointing;
  const sx = (l.x + r.x) / 2, sy = (l.y + r.y) / 2, m = Math.hypot(sx, sy);
  const g = ss(m, cfg.togetherZero, cfg.togetherFull);
  const eL = outwardElevation(l, -1), eR = outwardElevation(r, 1);
  const spread = (1 - ss(Math.abs(eL), 75, 90)) * (1 - ss(Math.abs(eR), 75, 90));
  const tilt = (eR - eL) / 2;
  const tiltK = spread * ss(Math.abs(tilt), cfg.tiltDeadZone, cfg.tiltFull);
  const lowered = Math.max(0, Math.min(1, (-(eL + eR) / 2 - cfg.descendZero) / (cfg.descendFull - cfg.descendZero)));
  const sink = tiltK * cfg.descendSpeed * lowered;
  return {
    vx: (g * cfg.cruiseSpeed * sx) / (m || 1) + (1 - g) * -Math.sign(tilt) * tiltK * cfg.driftSpeed,
    vy: (-g * cfg.cruiseSpeed * sy) / (m || 1) + (1 - g) * sink,
  };
}

describe('continuousArms: spread arms bank towards the lower hand', () => {
  it('the worked example: a tilted T lowered past the point where the mean leaned the other way', () => {
    // left -55 / right -15: the right hand higher by 20, the bird descends to the left at the tilt ramp's half drift
    const a = continuousArms(arm(-1, -55), arm(1, -15));
    expect(a.vx).toBeCloseTo(-0.93, 2);
    expect(a.vy).toBeCloseTo(1.0, 2);
    expect(preFix(arm(-1, -55), arm(1, -15)).vx).toBeCloseTo(-0.84, 2);
    // 5° lower: before, the flight term all but cancelled the drift (-0.15); now it adds to it
    const b = continuousArms(arm(-1, -60), arm(1, -20));
    expect(b.vx).toBeCloseTo(-1.24, 2);
    expect(b.vy).toBeCloseTo(2.19, 2);
    expect(preFix(arm(-1, -60), arm(1, -20)).vx).toBeCloseTo(-0.15, 2);
  });

  it('lowering a tilted T: sideways always towards the lower hand, descending no slower the lower the arms', () => {
    for (const tilt of [10, 15, 20, 25, 30, 35, 40])
      for (const side of [1, -1] as const) {
        let lastVy = 0;
        // down to where the lower arm starts to hang or the rest cone: 75° below level without one arm steering
        // (past it, the spread weight fades out), `restCone` − 10 from straight down with it (past it, the other arm
        // starts to be the one pointing: `oneArmWeight`)
        const lowest = config.pointing.oneArm ? Math.min(75, 100 - config.pointing.restCone) : 75;
        for (let low = 0; tilt + low <= lowest; low += 1) {
          const t = side * tilt;
          const p = continuousArms(...T(t, low));
          if (p.mode === 'rest') break;
          // + tilt: the right hand higher, the lower hand on the left
          expect(Math.sign(t) * p.vx!, `tilt ${t} low ${low}`).toBeLessThanOrEqual(1e-9);
          expect(p.vy!, `tilt ${t} low ${low}`).toBeGreaterThanOrEqual(lastVy - 1e-9);
          lastVy = p.vy!;
        }
        // well lowered, it really descends diagonally (past the tilt's dead zone)
        if (tilt >= 20) expect(Math.abs(continuousArms(...T(side * tilt, lowest - 5 - tilt)).vx!)).toBeGreaterThan(0.8);
      }
  });

  it('every V and every pair of arms pointing together the same way: the same command as before', () => {
    let worst = 0;
    // both arms raised (or level), each out to its own side or across the body
    for (let eL = 0; eL <= 180; eL += 2)
      for (let eR = 0; eR <= 180; eR += 2) {
        const p = continuousArms(arm(-1, eL), arm(1, eR));
        const q = preFix(arm(-1, eL), arm(1, eR));
        worst = Math.max(worst, Math.hypot(p.vx! - q.vx, p.vy! - q.vy));
      }
    // parallel within parallelMax (as the poses read it), in every direction, outside the rest cone, except arms
    // straddling straight down (below)
    for (let deg = -180; deg < 180; deg += 2)
      for (let d = 0; d <= config.pointing.parallelMax / 2; d += 1) {
        const [l, r] = [dir(deg + d), dir(deg - d)];
        for (const [a, b] of [[l, r], [r, l]]) {
          const p = continuousArms(a, b);
          if (p.mode === 'rest') continue;
          if (outwardElevation(a, -1) < 0 && outwardElevation(a, -1) > -90 && outwardElevation(b, 1) < 0 && outwardElevation(b, 1) > -90) continue;
          const q = preFix(a, b);
          worst = Math.max(worst, Math.hypot(p.vx! - q.vx, p.vy! - q.vy));
        }
      }
    expect(worst).toBeLessThan(1e-9);
  });

  it('arms within parallelMax but either side of straight down (a narrowed A) go towards the lower hand too', () => {
    // left -52, right -78: 50° apart, the poses read them as parallel and flew down and left; now down and right
    const p = continuousArms(arm(-1, -52), arm(1, -78));
    expect(preFix(arm(-1, -52), arm(1, -78)).vx).toBeLessThan(-1.5);
    expect(p.vx).toBeGreaterThan(1.2);
    expect(p.vy).toBeCloseTo(preFix(arm(-1, -52), arm(1, -78)).vy, 9);
  });
});

describe('continuousArms: continuity', () => {
  it('outside the rest cone, a 1° change of an arm changes the command by little', () => {
    const inCone = (deg: number) => Math.abs(((deg + 90 + 540) % 360) - 180) <= config.pointing.restCone;
    let worst = 0;
    for (let l = -180; l < 180; l += 3)
      for (let r = -180; r < 180; r += 3) {
        if (inCone(l) && inCone(r)) continue;
        const a = continuousArms(dir(l), dir(r));
        for (const [l2, r2] of [[l + 1, r], [l, r + 1]]) {
          if (inCone(l2) && inCone(r2)) continue;
          const b = continuousArms(dir(l2), dir(r2));
          worst = Math.max(worst, Math.hypot(a.vx! - b.vx!, a.vy! - b.vy!));
        }
      }
    // the steepest ramp: `togetherZero`..`togetherFull` (smoothstep, slope 1.5 / 0.3) times the cruising speed, with
    // one arm's degree moving the mean by up to 0.5° worth: ~0.3 px/step (the cruising speed is 7). Steeper still:
    // one arm starting to hang (75°..90° below level, the spread weight's fade) with the other lowered out to its
    // side. The flight's sideways part turns there from the lower hand to the mean's own (the outstretched arm's)
    // within 15°: 2 · cruise · |s_x| / |s| (~0.5) · smoothstep's 0.1 per degree = ~0.7 px/step (0.70 measured).
    // With one arm steering the steepest is where an arm starts to hang beside one pointing 20° below level: the
    // tilted T's descent towards the lower hand turns into the flight towards the pointing arm (~7 px/step apart)
    // within 15° (0.73 measured)
    expect(worst).toBeLessThan(0.75);
  });
});

describe('PointingDetector with continuous steering', () => {
  let was: boolean;
  beforeEach(() => {
    was = config.pointing.continuous;
    config.pointing.continuous = true;
  });
  afterEach(() => {
    config.pointing.continuous = was;
  });
  const run = (d: PointingDetector, ms: number, pose: { armLeft: number; armRight: number }, t0 = 0) =>
    frames(ms, () => pose, t0).map((f) => ({ t: f.t, o: d.update(f, true, true) }));

  it('the command follows the arms every frame, with the velocity', () => {
    const d = new PointingDetector();
    // elevations: 10 hanging, 90 level, 180 straight up
    const out = run(d, 500, { armLeft: 180, armRight: 180 }).at(-1)!.o;
    expect(out.intent).toMatchObject({ mode: 'fly' });
    expect(out.intent!.vy).toBeLessThan(-0.95 * config.pointing.cruiseSpeed);
    expect(out.candidate).toEqual(out.intent);
  });

  it('leaving the rest and going back to it are debounced by enterMs; meanwhile the bird keeps what it had', () => {
    const d = new PointingDetector();
    run(d, 500, { armLeft: 10, armRight: 10 });
    const up = run(d, 500, { armLeft: 180, armRight: 180 }, 500);
    const first = up.find((e) => e.o.intent?.mode !== 'rest')!;
    expect(first.t - 500).toBeGreaterThanOrEqual(config.pointing.enterMs);
    expect(first.t - 500).toBeLessThan(config.pointing.enterMs + 100);
    const down = run(d, 500, { armLeft: 10, armRight: 10 }, 1000);
    const rest = down.find((e) => e.o.intent?.mode === 'rest')!;
    expect(rest.t - 1000).toBeGreaterThanOrEqual(config.pointing.enterMs);
    expect(down.filter((e) => e.t < rest.t).every((e) => e.o.intent?.mode === 'fly')).toBe(true);
  });

  it('arms matching no pose never drop the bird to rest (no ambiguousMs)', () => {
    // the left arm 50° below level, the right one 70° above: neither a T, nor parallel, nor a V
    const pose = { armLeft: 40, armRight: 160 };
    config.pointing.continuous = false;
    expect(run(new PointingDetector(), 1500, pose).at(-1)!.o.intent?.mode).toBe('rest');
    config.pointing.continuous = true;
    const out = run(new PointingDetector(), 1500, pose);
    expect(out.every((e) => e.o.candidate !== null)).toBe(true);
    expect(out.slice(5).every((e) => e.o.intent?.mode !== 'rest' && e.o.intent?.vx !== undefined)).toBe(true);
  });

  it('an arm not visible: no intent', () => {
    const d = new PointingDetector();
    run(d, 300, { armLeft: 180, armRight: 180 });
    const [f] = frames(40, () => ({ armLeft: 180, armRight: 180 }), 300);
    expect(d.update(f, true, false)).toMatchObject({ candidate: null, intent: null });
  });

  it('switched off, the intent carries no velocity (the poses as before)', () => {
    config.pointing.continuous = false;
    const out = run(new PointingDetector(), 1000, { armLeft: 120, armRight: 60 }).map((e) => e.o.intent!);
    expect(out.at(-1)).toMatchObject({ mode: 'drift', dx: 1 });
    expect(out.every((p) => p.vx === undefined && p.vy === undefined)).toBe(true);
  });
});

describe('pointing physics with a velocity', () => {
  const maxDv = config.pointing.accel * (STEP_MS / 1000) ** 2;

  it('pointingStep approaches the velocity asked for, within the accel limit, holding the bird up', () => {
    const p: PointingIntent = { mode: 'drift', dx: 1, dy: 0, vx: 3, vy: 4 };
    const g = pointingStep({ x: 0, y: 0 }, p, STEP_MS);
    expect(Math.hypot(g.x, g.y)).toBeCloseTo(maxDv, 9);
    expect(g.y / g.x).toBeCloseTo(4 / 3, 9);
    expect(g.gravity).toBe(0);
    let v = { x: 0, y: 0 };
    for (let i = 0; i < 60; i++) v = pointingStep(v, p, STEP_MS);
    expect(v).toMatchObject({ x: 3, y: 4 });
    // whatever the label: a hover with a velocity moves at it too
    expect(pointingStep({ x: 3, y: 4 }, { ...p, mode: 'hover' }, STEP_MS)).toMatchObject({ x: 3, y: 4 });
  });

  it('the lean and the wingbeat follow the speed asked for, not the label', () => {
    const cruise = config.pointing.cruiseSpeed;
    const at = (vx: number, vy = 0, mode: PointingIntent['mode'] = 'drift'): PointingIntent => ({ mode, dx: Math.sign(vx), dy: 0, vx, vy });
    expect(pointingLean(at(cruise, 0, 'fly'))).toBeCloseTo(config.pointing.leanDeg, 9);
    expect(pointingLean(at(cruise / 2))).toBeCloseTo(config.pointing.leanDeg / 2, 9);
    // the same velocity, labelled either side of the fly / drift border: the same lean and wingbeat
    expect(pointingLean(at(3, -2, 'fly'))).toBe(pointingLean(at(3, -2, 'drift')));
    expect(pointingFlapRate(at(3, -2, 'fly'))).toBe(pointingFlapRate(at(3, -2, 'drift')));
    expect(pointingFlapRate(at(0, 0, 'hover'))).toBe(config.tilt.holdFlapRate);
    expect(pointingFlapRate(at(cruise, 0, 'fly'))).toBeCloseTo(config.pointing.flapRate, 9);
    expect(pointingFlapRate({ mode: 'rest', dx: 0, dy: 0 })).toBeNull();
    // the poses: as before
    expect(pointingFlapRate({ mode: 'fly', dx: 1, dy: 0 })).toBe(config.pointing.flapRate);
    expect(pointingFlapRate({ mode: 'drift', dx: 1, dy: 0 })).toBe(config.tilt.holdFlapRate);
  });
});
