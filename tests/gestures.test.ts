import { describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { FlapDetector } from '../src/gestures/FlapDetector';
import { armElevation, hipHeight, kneeAngle, thighDrop, torsoLength } from '../src/gestures/geometry';
import { SquatDetector } from '../src/gestures/SquatDetector';
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

describe('SquatDetector', () => {
  const baseline = () => {
    const f = synthPose({ t: 0 });
    const torso = torsoLength(f);
    return { torso, thigh: thighDrop(f) / torso, legs: hipHeight(f) / torso };
  };

  it('fires once per squat, re-arms after standing up', () => {
    const d = new SquatDetector();
    d.calibrate(baseline());
    const seq = [
      ...frames(500, () => ({})),
      ...frames(600, () => ({ squat: 0.8 }), 500),
      ...frames(600, () => ({}), 1100),
      ...frames(600, () => ({ squat: 0.8 }), 1700),
      ...frames(400, () => ({}), 2300),
    ];
    let triggers = 0;
    for (const f of seq) if (d.update(f, true).triggered) triggers++;
    expect(triggers).toBe(2);
  });

  it('does not fire on flapping while standing', () => {
    const d = new SquatDetector();
    d.calibrate(baseline());
    let triggers = 0;
    for (const f of frames(3000, (t) => ({ armLeft: flapAngle(t, 1.5), armRight: flapAngle(t, 1.5) }))) if (d.update(f, true).triggered) triggers++;
    expect(triggers).toBe(0);
  });

  it('fires on a half squat but not on a slight knee bend', () => {
    const fires = (squat: number) => {
      const d = new SquatDetector();
      d.calibrate(baseline());
      return frames(1000, () => ({ squat })).some((f) => d.update(f, true).triggered);
    };
    expect(fires(0.4)).toBe(true);
    expect(fires(0.15)).toBe(false);
  });

  it('fires on raising one leg and reports which one', () => {
    for (const side of ['left', 'right'] as const) {
      const d = new SquatDetector();
      d.calibrate(baseline());
      const hits = frames(1000, () => ({ raiseLeg: side })).map((f) => d.update(f, true)).filter((o) => o.triggered);
      expect(hits.length).toBe(1);
      expect(hits[0].raisedLeg).toBe(side);
    }
  });

  it('reports no raised leg for a two-footed squat', () => {
    const d = new SquatDetector();
    d.calibrate(baseline());
    const hits = frames(1000, () => ({ squat: 0.8 })).map((f) => d.update(f, true)).filter((o) => o.triggered);
    expect(hits.length).toBe(1);
    expect(hits[0].raisedLeg).toBe(null);
  });

  it('does not fire when stepping closer or further away', () => {
    const d = new SquatDetector();
    d.calibrate(baseline());
    let triggers = 0;
    for (const f of [...frames(1000, () => ({ scale: 0.65 })), ...frames(1000, () => ({ scale: 1.3 }), 1000)]) if (d.update(f, true).triggered) triggers++;
    expect(triggers).toBe(0);
  });

  it('works while flapping', () => {
    const d = new SquatDetector();
    d.calibrate(baseline());
    let triggers = 0;
    for (const f of frames(800, (t) => ({ squat: t > 300 ? 0.8 : 0, armLeft: flapAngle(t, 1.5), armRight: flapAngle(t, 1.5) })))
      if (d.update(f, true).triggered) triggers++;
    expect(triggers).toBe(1);
  });
});

describe('VisibilityMonitor', () => {
  const run = (m: VisibilityMonitor, seq: ReturnType<typeof frames>) => seq.map((f) => m.update(f, f.t));

  it('becomes fully visible shortly after the person appears', () => {
    const m = new VisibilityMonitor();
    const out = run(m, frames(1000, () => ({})));
    expect(out[0].allVisible).toBe(false);
    expect(out[out.length - 1].allVisible).toBe(true);
  });

  it('ignores brief dropouts but reports a sustained one, with a hint', () => {
    const m = new VisibilityMonitor();
    run(m, frames(1000, () => ({})));
    const brief = run(m, frames(200, () => ({ hideLegs: true }), 1000));
    expect(brief.every((o) => o.allVisible)).toBe(true);
    run(m, frames(500, () => ({}), 1200));
    const long = run(m, frames(1200, () => ({ hideLegs: true }), 1700));
    const last = long[long.length - 1];
    expect(last.allVisible).toBe(false);
    expect(last.parts.leftLeg.visible).toBe(false);
    expect(last.parts.torso.visible).toBe(true);
    expect(last.hint).toMatch(/feet/);
    // recovers
    const back = run(m, frames(1000, () => ({}), 2900));
    expect(back[back.length - 1].allVisible).toBe(true);
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
