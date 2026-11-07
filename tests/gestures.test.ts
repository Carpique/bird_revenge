import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config, type Config } from '../src/config';
import { FlapDetector } from '../src/gestures/FlapDetector';
import { droopHold, fitArmLine, TiltDetector } from '../src/gestures/TiltDetector';
import { flightStep, liftShare, sideBoost, sideAmount, smoothLift } from '../src/game/flight';
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

describe('FlapDetector priming', () => {
  pin('flap', { velocityDeadzone: 40, primeRise: 25, primeVelocity: 40, primeHoldMs: 350 });

  /** max lift over a piecewise-linear arm path: [ms, angle] points, both arms alike */
  const maxLiftAlong = (path: [number, number][]) => {
    const d = new FlapDetector();
    const at = (t: number) => {
      const i = path.findIndex(([pt]) => pt >= t);
      if (i <= 0) return path[Math.max(0, i)][1];
      const [t0, a0] = path[i - 1], [t1, a1] = path[i];
      return a0 + ((a1 - a0) * (t - t0)) / (t1 - t0);
    };
    let max = 0;
    for (const f of frames(path[path.length - 1][0], (t) => ({ armLeft: at(t), armRight: at(t) }))) max = Math.max(max, d.update(f, true, true).lift);
    return max;
  };

  it('lowering the arms from a held T does not flap', () => {
    expect(maxLiftAlong([[0, 90], [1000, 90], [1300, 20], [1600, 20]])).toBe(0);
  });

  it('raising the arms, holding them, then lowering does not flap', () => {
    expect(maxLiftAlong([[0, 20], [300, 120], [1200, 120], [1500, 20], [1800, 20]])).toBe(0);
  });

  it('raising then flapping straight down lifts', () => {
    expect(maxLiftAlong([[0, 20], [300, 120], [400, 120], [600, 20], [800, 20]])).toBeGreaterThan(config.physics.gravity * 1000);
  });

  it('a small twitch up does not prime', () => {
    expect(maxLiftAlong([[0, 90], [500, 90], [600, 100], [800, 20], [1000, 20]])).toBe(0);
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

  it('does not fire when leaning the upper body sideways, or switching the lean from side to side', () => {
    const d = detector();
    let triggers = 0;
    const seq = [
      ...frames(3000, () => ({ lean: 12 })),
      ...frames(3000, () => ({ lean: -12 }), 3000),
      ...frames(3000, () => ({ lean: 12 }), 6000),
    ];
    for (const f of seq) if (d.update(f, true).triggered) triggers++;
    expect(triggers).toBe(0);
  });

  it('fires on a sideways raise while leaning', () => {
    const d = detector();
    const hits = frames(3000, (t) => ({ lean: -12, legLeft: t > 2000 ? 40 : 0 })).map((f) => d.update(f, true)).filter((o) => o.triggered);
    expect(hits.length).toBe(1);
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

  it('reports a person off to the side as not present, after a while', () => {
    const m = new VisibilityMonitor();
    run(m, frames(1000, () => ({})));
    const shift = (dx: number) => (f: ReturnType<typeof frames>[number]) => ({ ...f, lm: f.lm.map((p) => ({ ...p, x: p.x + dx })) });
    const brief = run(m, frames(300, () => ({}), 1000).map(shift(0.35)));
    expect(brief.every((o) => o.playerPresent)).toBe(true);
    run(m, frames(500, () => ({}), 1300));
    const long = run(m, frames(1000, () => ({}), 1800).map(shift(-0.35)));
    const last = long[long.length - 1];
    expect(last.personDetected).toBe(true);
    expect(last.centred).toBe(false);
    expect(last.playerPresent).toBe(false);
    expect(last.inFrame).toBe(false);
    expect(last.hint).toMatch(/middle/);
    const back = run(m, frames(1000, () => ({}), 2800));
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

  it('is not spread when the arms are neither in a straight line nor lowered evenly', () => {
    // arms down, up, one arm out, one arm level and the other well below
    for (const [l, r] of [[15, 15], [170, 170], [90, 15], [90, 55]]) {
      const out = run(frames(1000, () => ({ armLeft: l, armRight: r })));
      expect(out.some((o) => o.spread)).toBe(false);
      expect(last(out).hold).toBe(0);
    }
  });

  describe('arms lowered evenly', () => {
    pin('hover', { holdDroop: 10, fallDroop: 60, maxDroopDiff: 25 });

    it('a T holds fully; the lower both arms go, the less it holds, down to nothing', () => {
      const hold = (l: number, r = l) => last(run(frames(1000, () => ({ armLeft: l, armRight: r })))).hold;
      expect(hold(90)).toBe(1);
      expect(hold(82)).toBe(1); // within holdDroop
      const mid = hold(65);
      const low = hold(45);
      expect(mid).toBeGreaterThan(0.3);
      expect(mid).toBeLessThan(0.8);
      expect(low).toBeGreaterThan(0);
      expect(low).toBeLessThan(mid);
      expect(hold(25)).toBe(0); // past fallDroop
      // about the same angle is enough; too uneven isn't
      expect(hold(60, 70)).toBeGreaterThan(0);
      expect(hold(45, 80)).toBe(0);
    });

    it('follows the arms down as they are lowered', () => {
      const out = run(frames(3000, (t) => ({ armLeft: 90 - (t / 3000) * 60, armRight: 90 - (t / 3000) * 60 })));
      const holds = out.slice(10).map((o) => o.hold);
      for (let i = 1; i < holds.length; i++) expect(holds[i]).toBeLessThanOrEqual(holds[i - 1] + 1e-9);
      expect(holds[0]).toBe(1);
      expect(last(holds)).toBeLessThan(0.1);
    });

    it('droopHold ramps linearly between holdDroop and fallDroop', () => {
      expect(droopHold(0)).toBe(1);
      expect(droopHold(10)).toBe(1);
      expect(droopHold(35)).toBeCloseTo(0.5);
      expect(droopHold(60)).toBe(0);
      expect(droopHold(80)).toBe(0);
    });
  });
});

describe('flight physics', () => {
  pin('tilt', { fullTilt: 35, holdDrag: 0.2, sideLift: 0.75 });
  pin('flap', { liftSmoothMs: 350, flappingGravity: 0.5 });
  /** wingbeats: 150 ms of lift, then 250 ms of none */
  const beat = (i: number) => ((i * STEP_MS) % 400 < 150 ? 3000 : 0);
  /**
   * `steps` physics steps (default 2 s) at a fixed tilt with Matter's gravity and air friction, from velocity v0
   * (px/step) and smoothed lift `lift0`; `lift` (px/s², or per step) is the wingbeats' lift. Returns the velocity,
   * how far the bird fell (px, + = down) and the vertical speed at every step.
   */
  const sim = (tilt: number, hovering: boolean | number, o: { v0?: { x: number; y: number }; lift?: number | ((i: number) => number); lift0?: number; steps?: number } = {}) => {
    const g = config.physics.gravity * 1e-3 * STEP_MS ** 2;
    const k = 1 - config.physics.birdAirFriction;
    let v = { ...(o.v0 ?? { x: 0, y: 0 }) };
    let lift = o.lift0 ?? 0;
    let fell = 0;
    const vys: number[] = [];
    for (let i = 0; i < (o.steps ?? 120); i++) {
      const raw = typeof o.lift === 'function' ? o.lift(i) : (o.lift ?? 0);
      lift = smoothLift(lift, raw * liftShare(tilt), STEP_MS);
      const s = flightStep(v, tilt, Number(hovering), lift, STEP_MS);
      v = { x: s.x * k, y: (s.y + g * s.gravity - lift * 1e-6 * STEP_MS ** 2) * k };
      fell += v.y;
      vys.push(v.y);
    }
    return { ...v, fell, vys };
  };
  const fly = (tilt: number, hovering: boolean, v0?: { x: number; y: number }) => sim(tilt, hovering, { v0 });

  it('hovering level: keeps its altitude, no sideways push', () => {
    expect(Math.abs(fly(0, true).fell)).toBeLessThan(3);
    const braked = fly(0, true, { x: 0, y: 7 });
    expect(Math.abs(braked.y)).toBeLessThan(0.1);
    expect(braked.x).toBe(0);
  });

  it('a tilted T: flies sideways, faster with more tilt, keeping its altitude', () => {
    const shallow = fly(-20, true); // the right hand lower: flies right
    const steep = fly(-45, true);
    expect(shallow.x).toBeGreaterThan(1);
    expect(steep.x).toBeGreaterThan(shallow.x);
    expect(Math.abs(shallow.fell)).toBeLessThan(3);
    expect(Math.abs(steep.fell)).toBeLessThan(3);
    expect(fly(45, true).x).toBeLessThan(-1); // the other way
    // a fall is braked to a stop, as when level
    expect(Math.abs(fly(-30, true, { x: 0, y: 7 }).y)).toBeLessThan(0.1);
  });

  it('the tilt only steers: without the arms held out or flapping, a tilted bird falls like a level one', () => {
    const tilted = fly(-30, false);
    const level = fly(0, false);
    expect(tilted.x).toBeGreaterThan(1);
    expect(tilted.y).toBeCloseTo(level.y, 5);
  });

  it('hovering with the arms lowered: sinks steadily, faster the lower they are', () => {
    const sink = (hold: number) => sim(0, hold, { steps: 240 }).y;
    const free = sink(0);
    const half = sink(0.5);
    const little = sink(0.8);
    expect(little).toBeGreaterThan(0.2);
    expect(half).toBeGreaterThan(little);
    expect(free).toBeGreaterThan(half);
    // settled at a sink speed: no longer speeding up
    expect(sim(0, 0.5, { steps: 480 }).y - half).toBeLessThan(0.3);
    // tilted, the same
    expect(sim(-30, 0.5, { steps: 240 }).y).toBeCloseTo(half, 5);
  });

  it('turns a sideways flight around when tilted the other way', () => {
    expect(fly(30, true, { x: 6, y: 0 }).x).toBeLessThan(-1);
  });

  it('a fresh small tilt stays slow; holding it or tilting more speeds up fast; braking stays crisp', () => {
    const run = (tilt: number, ms: number, x0 = 0) => {
      let x = x0;
      for (let t = 0; t < ms; t += STEP_MS) x = flightStep({ x, y: 0 }, tilt, 0, 0, STEP_MS, t).x;
      return x;
    };
    const small = config.tilt.fineTilt; // the right hand higher: flies left
    const big = config.tilt.boostTilt + 5;
    expect(Math.abs(run(small, 250))).toBeLessThan(Math.abs(run(big, 250)) * 0.5);
    // within fineMs a small tilt stays slow; held longer, it speeds up to its full speed
    const fullTilt = config.tilt.fullTilt;
    config.tilt.fullTilt = config.tilt.deadZone + 1; // a small tilt asking for full speed
    expect(Math.abs(run(small, config.tilt.fineMs - STEP_MS))).toBeCloseTo(config.tilt.fineSpeed, 5);
    expect(Math.abs(run(small, config.tilt.fineMs + 1000))).toBeGreaterThan(config.tilt.fineSpeed * 2);
    config.tilt.fullTilt = fullTilt;
    expect(sideBoost(small, 0)).toBe(0);
    expect(sideBoost(small, config.tilt.fineMs)).toBe(1);
    expect(sideBoost(big, 0)).toBe(1);
    // turning back from full speed brakes at the full sideAccel, gentle start or not
    const v = config.tilt.sideSpeed;
    const fullDv = config.tilt.sideAccel * (STEP_MS / 1000) ** 2;
    expect(flightStep({ x: v, y: 0 }, small, 0, 0, STEP_MS, 0).x).toBeCloseTo(v - fullDv, 5);
  });

  it('arms level, not flapping: falls as fast as ever', () => {
    const g = config.physics.gravity * 1e-3 * STEP_MS ** 2;
    const free = sim(0, false, { steps: 30 });
    // full gravity, only air friction against it
    expect(free.y).toBeGreaterThan(30 * g * 0.6);
  });

  it('right after flapping the fall starts gently, then speeds up to normal', () => {
    const justFlapped = sim(0, false, { lift0: 1200, steps: 30 });
    const long = sim(0, false, { steps: 30 });
    expect(justFlapped.fell).toBeLessThan(long.fell * 0.6);
    // the lift fades out: then it speeds up as fast as in a plain fall
    const late = (r: { vys: number[] }) => r.vys[29] - r.vys[25];
    expect(late(sim(0, false, { lift0: 1200, steps: 60 }))).toBeCloseTo(late(long), 1);
  });

  it('weak flapping slows a fall, without climbing', () => {
    const weak = sim(0, false, { lift: 400, steps: 240 });
    const free = sim(0, false, { steps: 240 });
    expect(weak.y).toBeGreaterThan(0);
    expect(weak.y).toBeLessThan(free.y * 0.5);
  });

  it('flapping climbs in a straight line, not in steps, level and tilted alike', () => {
    for (const tilt of [0, -30]) {
      const { x, vys } = sim(tilt, false, { lift: beat, steps: 240 });
      const settled = vys.slice(120);
      expect(Math.abs(x) > 1).toBe(tilt !== 0);
      // climbing steadily: never stalls between wingbeats
      expect(Math.max(...settled)).toBeLessThan(-1);
      expect(Math.max(...settled) - Math.min(...settled)).toBeLessThan(0.5 * -Math.max(...settled));
    }
  });

  it('flapping level climbs faster than flapping tilted', () => {
    const level = sim(0, false, { lift: beat, steps: 240 });
    const tilted = sim(-30, false, { lift: beat, steps: 240 });
    expect(level.fell).toBeLessThan(tilted.fell);
    expect(tilted.fell).toBeLessThan(0);
  });
});
