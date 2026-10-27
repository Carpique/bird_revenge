import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config, type Config } from '../src/config';
import { FlapDetector } from '../src/gestures/FlapDetector';
import { fitArmLine, TiltDetector } from '../src/gestures/TiltDetector';
import { flightStep, sideAmount } from '../src/game/flight';
import { STEP_MS } from '../src/game/physics';
import { armElevation, hipAbduction, kneeAngle } from '../src/gestures/geometry';
import { ShootDetector } from '../src/gestures/ShootDetector';
import { VisibilityMonitor } from '../src/gestures/VisibilityMonitor';
import { L } from '../src/pose/landmarks';
import { i18n } from '../src/ui/i18n';
import { frames, synthPose } from './synthetic';

i18n.set('en'); // hints are matched in English

/** Within a describe block: run its tests with these config values, so they test the mechanism, not the current tuning. */
const pin = <S extends keyof Config>(section: S, values: Partial<Config[S]>) => {
  const saved = { ...(config[section] as object) };
  beforeEach(() => Object.assign(config[section] as object, values));
  afterEach(() => Object.assign(config[section] as object, saved));
};

const flapAngle = (t: number, hz: number, lo = 20, hi = 150) =>
  lo + ((hi - lo) * (1 - Math.cos(2 * Math.PI * hz * (t / 1000)))) / 2;

describe('geometry', () => {
  it('measures arm elevation and knee angle on the synthetic body', () => {
    const f = synthPose({ t: 0, armLeft: 90, armRight: 30 });
    expect(Math.abs(armElevation(f, 'left') - 90)).toBeLessThan(6); // torso axis leans ~4° (hips narrower than shoulders)
    expect(Math.abs(armElevation(f, 'right') - 30)).toBeLessThan(6);
    expect(kneeAngle(f, 'left')).toBeGreaterThan(175);
  });

  it('measures hip abduction, positive outward on both sides', () => {
    const f = synthPose({ t: 0, legLeft: 30, legRight: -10 });
    expect(Math.abs(hipAbduction(f, 'left') - 30)).toBeLessThan(6);
    expect(Math.abs(hipAbduction(f, 'right') + 10)).toBeLessThan(6);
  });
});

describe('FlapDetector', () => {
  it('gives no lift when arms are still', () => {
    const d = new FlapDetector();
    let maxLift = 0;
    for (const f of frames(2000, () => ({ armLeft: 15, armRight: 15 }))) maxLift = Math.max(maxLift, d.update(f, true, true).lift);
    expect(maxLift).toBe(0);
  });

  it('vigorous symmetric flapping gives average lift above gravity', () => {
    const d = new FlapDetector();
    let liftSum = 0, n = 0;
    let out;
    for (const f of frames(4000, (t) => ({ armLeft: flapAngle(t, 1.5), armRight: flapAngle(t, 1.5) }))) {
      out = d.update(f, true, true);
      liftSum += out.lift;
      n++;
    }
    const gravity = config.physics.gravity * 1000;
    expect(liftSum / n).toBeGreaterThan(gravity);
    expect(out!.left.strokes).toBeGreaterThanOrEqual(5);
    expect(out!.left.frequency).toBeGreaterThan(1.2);
    expect(out!.left.frequency).toBeLessThan(1.8);
  });

  it('lifts as much flapping tilted as flapping level', () => {
    const avgLift = (offset: number) => {
      const d = new FlapDetector();
      let s = 0, n = 0;
      for (const f of frames(4000, (t) => ({ armLeft: flapAngle(t, 1.5) - offset, armRight: flapAngle(t, 1.5) + offset }))) {
        const o = d.update(f, true, true);
        if (f.t < 1000) continue;
        s += o.lift;
        n++;
      }
      return s / n;
    };
    const level = avgLift(0);
    expect(level).toBeGreaterThan(0);
    expect(Math.abs(avgLift(25) - level)).toBeLessThan(level * 0.1);
  });

  it('lift is produced only during downstrokes', () => {
    const d = new FlapDetector();
    for (const f of frames(3000, (t) => ({ armLeft: flapAngle(t, 1), armRight: flapAngle(t, 1) }))) {
      const o = d.update(f, true, true);
      if (o.left.velocity > 0 && o.right.velocity > 0) expect(o.lift).toBe(0);
    }
  });

  it('faster flapping gives more lift', () => {
    const avgLift = (hz: number) => {
      const d = new FlapDetector();
      let s = 0, n = 0;
      for (const f of frames(4000, (t) => ({ armLeft: flapAngle(t, hz), armRight: flapAngle(t, hz) }))) {
        s += d.update(f, true, true).lift;
        n++;
      }
      return s / n;
    };
    expect(avgLift(1.6)).toBeGreaterThan(avgLift(0.8));
  });
});

describe('ShootDetector', () => {
  const baseline = () => {
    const f = synthPose({ t: 0 });
    return { left: hipAbduction(f, 'left'), right: hipAbduction(f, 'right') };
  };
  const detector = () => {
    const d = new ShootDetector();
    d.calibrate(baseline());
    return d;
  };

  it('fires once per shoot, re-arms after putting the leg down', () => {
    const d = detector();
    const seq = [
      ...frames(500, () => ({})),
      ...frames(600, () => ({ legLeft: 40 }), 500),
      ...frames(600, () => ({}), 1100),
      ...frames(600, () => ({ legLeft: 40 }), 1700),
      ...frames(400, () => ({}), 2300),
    ];
    let triggers = 0;
    for (const f of seq) if (d.update(f, true).triggered) triggers++;
    expect(triggers).toBe(2);
  });

  it('does not fire on flapping while standing', () => {
    const d = detector();
    let triggers = 0;
    for (const f of frames(3000, (t) => ({ armLeft: flapAngle(t, 1.5), armRight: flapAngle(t, 1.5) }))) if (d.update(f, true).triggered) triggers++;
    expect(triggers).toBe(0);
  });

  it('fires on a clear sideways raise but not on a slight one', () => {
    const fires = (deg: number) => {
      const d = detector();
      return frames(1000, () => ({ legRight: deg })).some((f) => d.update(f, true).triggered);
    };
    expect(fires(35)).toBe(true);
    expect(fires(10)).toBe(false);
  });

  it('fires once whichever leg (or both) goes out', () => {
    for (const pose of [{ legLeft: 40 }, { legRight: 40 }, { legLeft: 35, legRight: 35 }]) {
      const d = detector();
      const hits = frames(1000, () => pose).map((f) => d.update(f, true)).filter((o) => o.triggered);
      expect(hits.length).toBe(1);
    }
  });

  it('does not fire when stepping closer or further away', () => {
    const d = detector();
    let triggers = 0;
    for (const f of [...frames(1000, () => ({ scale: 0.65 })), ...frames(1000, () => ({ scale: 1.3 }), 1000)]) if (d.update(f, true).triggered) triggers++;
    expect(triggers).toBe(0);
  });

  it('still works with the legs out of frame (estimated legs)', () => {
    const d = detector();
    const hits = frames(1000, (t) => ({ legLeft: t > 300 ? 40 : 0, hideLegs: true })).map((f) => d.update(f, true)).filter((o) => o.triggered);
    expect(hits.length).toBe(1);
  });

  it('does nothing while the hips are not visible', () => {
    const d = detector();
    expect(frames(1000, () => ({ legLeft: 40 })).some((f) => d.update(f, false).triggered)).toBe(false);
  });

  it('works while flapping', () => {
    const d = detector();
    let triggers = 0;
    for (const f of frames(800, (t) => ({ legLeft: t > 300 ? 40 : 0, armLeft: flapAngle(t, 1.5), armRight: flapAngle(t, 1.5) })))
      if (d.update(f, true).triggered) triggers++;
    expect(triggers).toBe(1);
  });
});

describe('VisibilityMonitor', () => {
  const run = (m: VisibilityMonitor, seq: ReturnType<typeof frames>) => seq.map((f) => m.update(f, f.t));

  it('becomes in frame shortly after the person appears', () => {
    const m = new VisibilityMonitor();
    const out = run(m, frames(1000, () => ({})));
    expect(out[0].inFrame).toBe(false);
    expect(out[out.length - 1].inFrame).toBe(true);
  });

  it('does not need the hands, only the elbows and the start of the forearms', () => {
    const cut = (f: ReturnType<typeof frames>[number], wristY: number) => {
      for (const i of [L.leftWrist, L.rightWrist]) f.lm[i] = { ...f.lm[i], y: wristY, v: 0.1 };
      for (const i of [L.leftElbow, L.rightElbow]) f.lm[i] = { ...f.lm[i], y: 0.1 };
      return f;
    };
    // hands just above the frame: most of the forearm still in view
    const handsOut = run(new VisibilityMonitor(), frames(1000, () => ({ armLeft: 170, armRight: 170 })).map((f) => cut(f, -0.05)));
    expect(handsOut[handsOut.length - 1].inFrame).toBe(true);
    // forearms leave the frame right at the elbow
    const forearmsOut = run(new VisibilityMonitor(), frames(1000, () => ({ armLeft: 170, armRight: 170 })).map((f) => cut(f, -0.4)));
    expect(forearmsOut[forearmsOut.length - 1].parts.leftArm.visible).toBe(false);
  });

  it('does not need the legs', () => {
    const m = new VisibilityMonitor();
    const out = run(m, frames(1500, () => ({ hideLegs: true })));
    const last = out[out.length - 1];
    expect(last.parts.leftLeg.visible).toBe(false);
    expect(last.inFrame).toBe(true);
  });

  it('ignores brief dropouts but reports a sustained one, with a hint', () => {
    const m = new VisibilityMonitor();
    run(m, frames(1000, () => ({})));
    const brief = run(m, frames(200, () => ({ hideHips: true }), 1000));
    expect(brief.every((o) => o.inFrame)).toBe(true);
    run(m, frames(500, () => ({}), 1200));
    const long = run(m, frames(1200, () => ({ hideHips: true }), 1700));
    const last = long[long.length - 1];
    expect(last.inFrame).toBe(false);
    expect(last.parts.torso.visible).toBe(false);
    expect(last.parts.leftArm.visible).toBe(true);
    expect(last.hint).toMatch(/hips/);
    // recovers
    const back = run(m, frames(1000, () => ({}), 2900));
    expect(back[back.length - 1].inFrame).toBe(true);
  });

  it('reports no person after frames stop', () => {
    const m = new VisibilityMonitor();
    run(m, frames(1000, () => ({})));
    m.update(null, 1100);
    const o = m.update(null, 1700);
    expect(o.personDetected).toBe(false);
    expect(o.hint).toMatch(/Step in front/);
  });
});

describe('TiltDetector', () => {
  pin('tilt', { fullTilt: 35 });
  pin('hover', { maxBend: 0.12 });
  const run = (fs: ReturnType<typeof frames>) => {
    const flap = new FlapDetector();
    const tilt = new TiltDetector();
    return fs.map((f) => tilt.update(f, true, true, flap.update(f, true, true)));
  };
  const last = <T,>(xs: T[]) => xs[xs.length - 1];

  it('fits a straight, level line through arms held out in a T', () => {
    const line = fitArmLine(synthPose({ t: 0, armLeft: 90, armRight: 90 }));
    expect(Math.abs(line.tilt)).toBeLessThan(1);
    expect(line.bend).toBeLessThan(0.01);
  });

  it('T held still: spread after a short hold, level', () => {
    const out = run(frames(1000, () => ({ armLeft: 90, armRight: 85 })));
    expect(out[0].spread).toBe(false);
    expect(last(out).spread).toBe(true);
    expect(sideAmount(last(out).tilt)).toBe(0);
  });

  it('stops being spread once the arms are lowered', () => {
    const out = run([
      ...frames(1000, () => ({ armLeft: 90, armRight: 90 })),
      ...frames(1000, () => ({ armLeft: 15, armRight: 15 }), 1000),
    ]);
    expect(out[29].spread).toBe(true);
    expect(last(out).spread).toBe(false);
  });

  it('tilted T: still spread, sideways towards the lower hand (as seen on screen), faster when tilted more', () => {
    // the player's left hand down: it's on the screen's left (mirrored view), so the bird flies left
    const left = last(run(frames(1000, () => ({ armLeft: 70, armRight: 110 }))));
    expect(left.spread).toBe(true);
    expect(sideAmount(left.tilt)).toBeLessThan(0);
    const right = last(run(frames(1000, () => ({ armLeft: 110, armRight: 70 }))));
    expect(sideAmount(right.tilt)).toBeGreaterThan(0);
    const steeper = last(run(frames(1000, () => ({ armLeft: 125, armRight: 55 }))));
    expect(steeper.spread).toBe(true);
    expect(sideAmount(steeper.tilt)).toBeGreaterThan(sideAmount(right.tilt));
  });

  it('flapping level: not spread, no sideways flight', () => {
    const out = run(frames(3000, (t) => ({ armLeft: flapAngle(t, 1.5), armRight: flapAngle(t, 1.5) })));
    expect(out.some((o) => o.spread)).toBe(false);
    expect(out.every((o) => sideAmount(o.tilt) === 0)).toBe(true);
  });

  it('flapping slightly out of step stays (nearly) level', () => {
    // the right arm 40 ms behind the left
    const out = run(frames(3000, (t) => ({ armLeft: flapAngle(t, 1.5), armRight: flapAngle(t - 40, 1.5) })));
    expect(Math.max(...out.map((o) => Math.abs(sideAmount(o.tilt))))).toBeLessThan(0.25);
  });

  it('flapping tilted: steadily sideways towards the lower hand', () => {
    const out = run(frames(3000, (t) => ({ armLeft: flapAngle(t, 1.5) - 25, armRight: flapAngle(t, 1.5) + 25 })));
    // after settling, every frame flies left (the player's left hand is the lower one)
    expect(out.slice(15).every((o) => sideAmount(o.tilt) < -0.3)).toBe(true);
  });

  it('raised into a V (up to maxRaise): spread too, tilted or not', () => {
    const v = last(run(frames(1000, () => ({ armLeft: 135, armRight: 135 }))));
    expect(v.spread).toBe(true);
    expect(sideAmount(v.tilt)).toBe(0);
    const tilted = last(run(frames(1000, () => ({ armLeft: 110, armRight: 160 }))));
    expect(tilted.spread).toBe(true);
    expect(sideAmount(tilted.tilt)).toBeLessThan(0); // the left hand lower: flies left
  });

  it('is not spread when the arms are not in a straight line', () => {
    // arms down, up, drooping into a downward V, one arm out, one arm level and the other well below
    for (const [l, r] of [[15, 15], [170, 170], [60, 60], [90, 15], [90, 60]]) {
      const out = run(frames(1000, () => ({ armLeft: l, armRight: r })));
      expect(out.some((o) => o.spread)).toBe(false);
    }
  });
});

describe('flight physics', () => {
  pin('tilt', { fullTilt: 35, holdDrag: 0.2 });
  /**
   * `steps` physics steps (default 2 s) at a fixed tilt with Matter's gravity and air friction, from velocity v0
   * (px/step) and `sinceFlap` ms after the last flap; `lift` (px/s²) counts as flapping. Returns the velocity and
   * how far the bird fell (px, + = down).
   */
  const sim = (tilt: number, hovering: boolean, o: { v0?: { x: number; y: number }; lift?: number; sinceFlap?: number; steps?: number } = {}) => {
    const g = config.physics.gravity * 1e-3 * STEP_MS ** 2;
    const lift = o.lift ?? 0;
    const up = lift * 1e-6 * STEP_MS ** 2;
    let v = { ...(o.v0 ?? { x: 0, y: 0 }) };
    let since = o.sinceFlap ?? Infinity;
    let fell = 0;
    for (let i = 0; i < (o.steps ?? 120); i++) {
      since = lift > 0 ? 0 : since + STEP_MS;
      const s = flightStep(v, tilt, hovering, since, STEP_MS);
      const k = 1 - config.physics.birdAirFriction;
      v = { x: s.x * k, y: (s.y + (s.holdUp ? 0 : g * (s.gravity ?? 1)) - up) * k };
      fell += v.y;
    }
    return { ...v, fell };
  };
  const fly = (tilt: number, hovering: boolean, v0?: { x: number; y: number }) => sim(tilt, hovering, { v0 });

  it('hovering level: keeps its altitude, no sideways push', () => {
    expect(Math.abs(fly(0, true).fell)).toBeLessThan(3);
    const braked = fly(0, true, { x: 0, y: 7 });
    expect(Math.abs(braked.y)).toBeLessThan(0.1);
    expect(braked.x).toBe(0);
  });

  it('tilted: flies sideways, faster with more tilt, keeping its altitude', () => {
    const shallow = fly(-20, false); // the right hand lower: flies right
    const steep = fly(-45, true);
    expect(shallow.x).toBeGreaterThan(1);
    expect(steep.x).toBeGreaterThan(shallow.x);
    expect(Math.abs(shallow.fell)).toBeLessThan(3);
    expect(Math.abs(steep.fell)).toBeLessThan(3);
    expect(fly(45, false).x).toBeLessThan(-1); // the other way
  });

  it('tilted: a fall is braked to a stop', () => {
    expect(Math.abs(fly(-30, false, { x: 0, y: 7 }).y)).toBeLessThan(0.1);
  });

  it('turns a sideways flight around when tilted the other way', () => {
    expect(fly(30, true, { x: 6, y: 0 }).x).toBeLessThan(-1);
  });

  it('arms level, long after flapping: falls as fast as ever', () => {
    const g = config.physics.gravity * 1e-3 * STEP_MS ** 2;
    const free = sim(0, false, { steps: 30 });
    // full gravity, only air friction against it
    expect(free.y).toBeGreaterThan(30 * g * 0.6);
  });

  it('right after a flap the fall starts gently, then speeds up to normal', () => {
    const justFlapped = sim(0, false, { sinceFlap: 0, steps: 30 });
    const long = sim(0, false, { steps: 30 });
    expect(justFlapped.fell).toBeLessThan(long.fell * 0.6);
    // after afterFlapMs it's back to full gravity: the speed grows as fast as in a plain fall
    const later = sim(0, false, { sinceFlap: config.flap.afterFlapMs, steps: 30 });
    expect(later.y).toBeCloseTo(long.y, 5);
  });

  it('flapping tilted climbs as fast as flapping level', () => {
    const level = sim(0, false, { lift: 1500 });
    const tilted = sim(-30, false, { lift: 1500 });
    expect(level.y).toBeLessThan(-1);
    expect(tilted.y).toBeCloseTo(level.y, 5);
    expect(tilted.x).toBeGreaterThan(1);
  });
});
