import { describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { FlapDetector } from '../src/gestures/FlapDetector';
import { fitArmLine, GlideDetector } from '../src/gestures/GlideDetector';
import { diveAmount, glideStep } from '../src/game/glide';
import { STEP_MS } from '../src/game/physics';
import { armElevation, hipAbduction, kneeAngle } from '../src/gestures/geometry';
import { ShootDetector } from '../src/gestures/ShootDetector';
import { VisibilityMonitor } from '../src/gestures/VisibilityMonitor';
import { frames, synthPose } from './synthetic';

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

  /** average lift and sideways acceleration over the last 3 s of a 4 s run */
  const average = (pose: (t: number) => { armLeft: number; armRight: number }) => {
    const d = new FlapDetector();
    let lift = 0, side = 0, n = 0;
    for (const f of frames(4000, pose)) {
      const o = d.update(f, true, true);
      if (f.t < 1000) continue;
      lift += o.lift;
      side += o.side;
      n++;
    }
    return { lift: lift / n, side: side / n };
  };

  it('symmetric flapping goes straight up', () => {
    const { lift, side } = average((t) => ({ armLeft: flapAngle(t, 1.5), armRight: flapAngle(t, 1.5) }));
    expect(side).toBe(0);
    expect(lift).toBeGreaterThan(0);
  });

  it('flapping one arm pushes sideways, direction per arm and sideSign', () => {
    const left = average((t) => ({ armLeft: flapAngle(t, 1.5), armRight: 15 }));
    const right = average((t) => ({ armLeft: 15, armRight: flapAngle(t, 1.5) }));
    expect(left.side * config.flap.sideSign).toBeGreaterThan(200);
    expect(right.side * config.flap.sideSign).toBeLessThan(-200);
    const both = average((t) => ({ armLeft: flapAngle(t, 1.5), armRight: flapAngle(t, 1.5) }));
    expect(left.lift).toBeLessThan(both.lift / 2);
  });

  it('one arm flapping twice as fast pushes sideways, while still lifting', () => {
    const o = average((t) => ({ armLeft: flapAngle(t, 0.8), armRight: flapAngle(t, 1.6) }));
    expect(o.side * config.flap.sideSign).toBeLessThan(-100);
    expect(o.lift).toBeGreaterThan(0);
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

  it('reports which leg is raised', () => {
    for (const side of ['left', 'right'] as const) {
      const d = detector();
      const pose = side === 'left' ? { legLeft: 40 } : { legRight: 40 };
      const hits = frames(1000, () => pose).map((f) => d.update(f, true)).filter((o) => o.triggered);
      expect(hits.length).toBe(1);
      expect(hits[0].raisedLeg).toBe(side);
    }
  });

  it('reports no raised leg when both legs go out', () => {
    const d = detector();
    const hits = frames(1000, () => ({ legLeft: 35, legRight: 35 })).map((f) => d.update(f, true)).filter((o) => o.triggered);
    expect(hits.length).toBe(1);
    expect(hits[0].raisedLeg).toBe(null);
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

describe('GlideDetector', () => {
  const run = (fs: ReturnType<typeof frames>) => {
    const flap = new FlapDetector();
    const glide = new GlideDetector();
    return fs.map((f) => glide.update(f, true, true, flap.update(f, true, true)));
  };
  const last = <T,>(xs: T[]) => xs[xs.length - 1];

  it('fits a straight, level line through arms held out in a T', () => {
    const line = fitArmLine(synthPose({ t: 0, armLeft: 90, armRight: 90 }));
    expect(Math.abs(line.tilt)).toBeLessThan(1);
    expect(line.bend).toBeLessThan(0.01);
  });

  it('glides with arms held out in a T, after a short hold, about level', () => {
    const out = run(frames(1000, () => ({ armLeft: 90, armRight: 85 })));
    expect(out[0].gliding).toBe(false);
    expect(last(out).gliding).toBe(true);
    expect(diveAmount(last(out).tilt)).toBe(0);
  });

  it('stops gliding once the arms are lowered', () => {
    const out = run([
      ...frames(1000, () => ({ armLeft: 90, armRight: 90 })),
      ...frames(1000, () => ({ armLeft: 15, armRight: 15 }), 1000),
    ]);
    expect(out[29].gliding).toBe(true);
    expect(last(out).gliding).toBe(false);
  });

  it('dives towards the lower hand (as seen on screen), harder when tilted more', () => {
    // the player's left hand down: it's on the screen's left (mirrored view), so the bird dives left
    const left = last(run(frames(1000, () => ({ armLeft: 70, armRight: 110 }))));
    expect(left.gliding).toBe(true);
    expect(diveAmount(left.tilt)).toBeLessThan(0);
    const right = last(run(frames(1000, () => ({ armLeft: 110, armRight: 70 }))));
    expect(diveAmount(right.tilt)).toBeGreaterThan(0);
    const steeper = last(run(frames(1000, () => ({ armLeft: 135, armRight: 45 }))));
    expect(steeper.gliding).toBe(true);
    expect(diveAmount(steeper.tilt)).toBeGreaterThan(diveAmount(right.tilt));
  });

  it('does not glide when the arms are not in a straight line', () => {
    // arms down, up, a V, one arm out, one arm level and the other well below
    for (const [l, r] of [[15, 15], [170, 170], [130, 130], [90, 15], [90, 60]]) {
      const out = run(frames(1000, () => ({ armLeft: l, armRight: r })));
      expect(out.some((o) => o.gliding)).toBe(false);
    }
  });

  it('does not glide while flapping through horizontal', () => {
    const out = run(frames(3000, (t) => ({ armLeft: flapAngle(t, 1.5), armRight: flapAngle(t, 1.5) })));
    expect(out.some((o) => o.gliding)).toBe(false);
  });
});

describe('glide physics', () => {
  /** 2 s of airborne gliding at a fixed tilt with Matter's gravity and air friction, from velocity v0 (px/step) */
  const fly = (tilt: number, v0 = { x: 0, y: 0 }) => {
    const g = config.physics.gravity * 1e-3 * STEP_MS ** 2;
    let v = { ...v0 };
    for (let i = 0; i < 120; i++) {
      const s = glideStep(v, tilt, STEP_MS);
      const k = 1 - config.glide.airFriction;
      v = { x: s.x * k, y: (s.y + (s.holdUp ? 0 : g)) * k };
    }
    return v;
  };

  it('level arms: sinks slowly like a parachute, and the sideways speed decays', () => {
    const v = fly(0, { x: 8, y: 7 });
    expect(v.y).toBeGreaterThan(0);
    expect(v.y).toBeLessThan(config.glide.sinkSpeed + 0.5);
    expect(Math.abs(v.x)).toBeLessThan(4);
    expect(v.x).toBeGreaterThan(0); // slowly, not braked to a stop
  });

  it('tilted arms: dives sideways and down, faster with more tilt', () => {
    const shallow = fly(-20); // falls to the right
    const steep = fly(-45);
    expect(shallow.x).toBeGreaterThan(1);
    expect(steep.x).toBeGreaterThan(shallow.x);
    expect(steep.y).toBeGreaterThan(shallow.y);
    expect(Math.hypot(steep.x, steep.y)).toBeGreaterThan(2 * Math.hypot(shallow.x, shallow.y) - 1);
    expect(fly(45).x).toBeLessThan(-1); // the other way
  });

  it('turns a sideways flight around when diving the other way', () => {
    expect(fly(30, { x: 8, y: 0 }).x).toBeLessThan(-1);
  });
});
