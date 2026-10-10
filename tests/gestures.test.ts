import { describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { FlapDetector } from '../src/gestures/FlapDetector';
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

  it('vigorous symmetric flapping gives average lift above gravity and no net steering', () => {
    const d = new FlapDetector();
    let liftSum = 0, steerSum = 0, n = 0;
    let out;
    for (const f of frames(4000, (t) => ({ armLeft: flapAngle(t, 1.5), armRight: flapAngle(t, 1.5) }))) {
      out = d.update(f, true, true);
      liftSum += out.lift;
      steerSum += out.steer;
      n++;
    }
    const gravity = config.physics.gravity * 1000;
    expect(liftSum / n).toBeGreaterThan(gravity);
    expect(Math.abs(steerSum / n)).toBeLessThan(1);
    expect(out!.left.strokes).toBeGreaterThanOrEqual(5);
    expect(out!.left.frequency).toBeGreaterThan(1.2);
    expect(out!.left.frequency).toBeLessThan(1.8);
  });

  it('flapping only the left arm steers right (steerSign = +1)', () => {
    const d = new FlapDetector();
    let steerSum = 0;
    for (const f of frames(3000, (t) => ({ armLeft: flapAngle(t, 1.5), armRight: 15 }))) steerSum += d.update(f, true, true).steer;
    expect(steerSum).toBeGreaterThan(0);
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
