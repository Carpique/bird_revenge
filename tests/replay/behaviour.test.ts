import { describe, expect, it } from 'vitest';
import { PoseDetectors } from '../../src/input/poseControls';
import { PoseSession } from '../../src/input/poseSession';
import { synthPose } from '../synthetic';
import { allRecordings, cleanRun, tutorialRecording } from './harness';
import { hitchScenario, nullGapScenario, runScenario, SCENARIOS, type Scenario } from './scenarios';

/**
 * The game's CURRENT behaviour on a recorded session, pinned as metrics (the numbers are what the code does
 * today, with margins). A change that improves tracking on purpose flips the matching assertion in the same
 * commit. The metrics are explained in `harness.ts` (`Metrics`); `metrics.test.ts` prints them all.
 */

/** shoot triggers in a clean replay of a recording, by name (a recording not listed here has none pinned) */
const EXPECTED_TRIGGERS: Record<string, number> = { 'control-tutorial': 8 };

const rec = tutorialRecording();
const clean = cleanRun(rec);
const scenario = (name: string): Scenario => {
  const s = SCENARIOS.find((x) => x.name === name);
  if (!s) throw new Error(`no scenario ${name}`);
  return s;
};
const run = (s: Scenario) => runScenario(rec, s, clean);

describe('clean recordings', () => {
  for (const r of allRecordings()) {
    it(`${r.name}: no false out-of-frame, recalibration or stale controls after the warm-up`, () => {
      const c = cleanRun(r);
      const after = (t: number) => t >= c.from;
      expect(c.run.events.filter((e) => after(e.t))).toEqual([]);
      expect(c.run.ticks.filter((tk) => after(tk.t) && tk.t <= c.to && tk.mode === 'stale')).toEqual([]);
      expect(c.run.ticks.filter((tk) => after(tk.t) && tk.t <= c.to && tk.state !== 'playing')).toEqual([]);
    });
    it(`${r.name}: calibrates and starts playing`, () => {
      const c = cleanRun(r);
      expect(c.run.events.map((e) => e.type)).toContain('countdownEnd');
    });
  }

  it('the tutorial recording fires the expected number of shoot triggers', () => {
    for (const r of allRecordings()) {
      const expected = EXPECTED_TRIGGERS[r.name];
      if (expected !== undefined) expect(cleanRun(r).run.triggers.length).toBe(expected);
    }
  });
});

describe('null frames (the tracker loses the person)', () => {
  it('100 ms and 340 ms gaps: no recalibration, no soft pause', () => {
    for (const ms of [100, 340]) {
      const r = run(nullGapScenario(ms));
      for (const m of r.runs) {
        expect(m.recalibrations).toBe(0);
        expect(m.outOfFrameMs).toBe(0);
        expect(m.calibratingMs).toBe(0);
      }
    }
  });

  it('a 340 ms gap leaves the bird without controls for 200 ms at most (the 300 ms staleness limit)', () => {
    for (const m of run(nullGapScenario(340)).runs) expect(m.staleMs).toBeLessThan(200);
  });

  it('680 ms gap: recalibration (the big dialog, calibration hold and countdown), every time', () => {
    const r = run(nullGapScenario(680));
    for (const m of r.runs) {
      expect(m.recalibrations).toBe(1);
      // the dialog's hold + the countdown: the game is back in about 1.2 s + 2 s after the person is
      expect(m.calibratingMs).toBeGreaterThan(3000);
      expect(m.recoveryMs).toBeGreaterThan(3000);
      expect(m.recoveryMs).toBeLessThan(4500);
    }
  });

  it('1500 ms gap: still one recalibration, and longer in the dialog', () => {
    const r = run(nullGapScenario(1500));
    for (const m of r.runs) expect(m.recalibrations).toBe(1);
    expect(r.mean.calibratingMs!).toBeGreaterThan(run(nullGapScenario(680)).mean.calibratingMs!);
  });
});

describe('hitches (no frames delivered, no callbacks)', () => {
  it('680 ms: no recalibration (the monitor sees no gap), controls stale for about 400 ms', () => {
    const r = run(hitchScenario(680));
    for (const m of r.runs) {
      expect(m.recalibrations).toBe(0);
      expect(m.outOfFrameMs).toBe(0);
      expect(m.staleMs).toBeGreaterThan(300);
      expect(m.staleMs).toBeLessThan(520);
    }
    expect(r.mean.staleMs!).toBeGreaterThan(350);
    expect(r.mean.staleMs!).toBeLessThan(480);
  });

  it('1500 ms: still no recalibration, stale for the length less the 300 ms limit', () => {
    const r = run(hitchScenario(1500));
    for (const m of r.runs) {
      expect(m.recalibrations).toBe(0);
      expect(m.staleMs).toBeGreaterThan(1100);
      expect(m.staleMs).toBeLessThan(1400);
    }
  });
});

describe('visibility and landmark noise', () => {
  it('arms of low visibility for 600 ms: no recalibration, no soft pause, no wrong controls', () => {
    for (const name of ['left arm low visibility 600 ms', 'both arms low visibility 600 ms']) {
      for (const m of run(scenario(name)).runs) {
        expect(m.recalibrations).toBe(0);
        expect(m.outOfFrameMs).toBe(0);
        expect(m.wrongMs).toBe(0);
      }
    }
  });

  it('a hallucinated wrist (low visibility, hanging) for 300 ms: no pause, a few hundred ms of wrong controls at most', () => {
    for (const m of run(scenario('left wrist hallucination 300 ms')).runs) {
      expect(m.recalibrations).toBe(0);
      expect(m.outOfFrameMs).toBe(0);
      expect(m.wrongMs).toBeLessThan(700);
    }
  });

  it('landmark jitter: never pauses; heavy jitter (sigma 0.03) fires the poo button spuriously', () => {
    const light = run(scenario('jitter sigma 0.008')).mean;
    const heavy = run(scenario('jitter sigma 0.03')).mean;
    for (const m of [light, heavy]) {
      expect(m.recalibrations).toBe(0);
      expect(m.outOfFrameMs).toBe(0);
    }
    expect(light.triggers).toBe(EXPECTED_TRIGGERS['control-tutorial']);
    expect(heavy.triggers!).toBeGreaterThan(30);
    expect(heavy.wrongMs!).toBeGreaterThan(light.wrongMs!);
  });

  it('off-centre by 0.15: nothing happens; by 0.3: the player does not count as present', () => {
    const near = run(scenario('off-centre 0.15')).mean;
    expect(near.recalibrations).toBe(0);
    expect(near.calibratingMs).toBe(0);
    const far = run(scenario('off-centre 0.3')).mean;
    // the whole clip is spent behind the calibration dialog, the tracker is told to look again
    expect(far.calibratingMs!).toBeGreaterThan(60000);
    expect(far.redetects!).toBeGreaterThan(30);
    expect(far.triggers).toBe(0);
  });
});

describe('PoseSession', () => {
  /** detectors that have seen the standing person for 2 s (the monitor needs that to count the player present) */
  const warm = () => {
    const detectors = new PoseDetectors();
    for (let t = 0; t < 2000; t += 33) detectors.update(synthPose({ t }), t);
    return detectors;
  };

  it('controls go stale 300 ms after the last frame, and only apply while playing', () => {
    const detectors = warm();
    const session = new PoseSession();
    let state: string = 'outOfFrame';
    let t = 2000;
    for (; t < 3000; t += 33) state = session.update(state, detectors.update(synthPose({ t }), t), t).state;
    expect(state).toBe('playing');
    const last = t - 33;
    expect(session.controls('playing', last + 100).pointing).not.toBeNull();
    expect(session.controls('playing', last + 299).pointing).not.toBeNull();
    expect(session.controls('playing', last + 300).pointing).toBeNull();
    expect(session.controls('outOfFrame', last + 10).pointing).toBeNull();
    session.clear();
    expect(session.controls('playing', last + 10).pointing).toBeNull();
  });

  it('no person for noPersonAfterMs sends a game in progress back to calibrating, not before', () => {
    const detectors = warm();
    const session = new PoseSession();
    let state: string = 'playing';
    let recalibratedAt: number | null = null;
    for (let t = 2000; t < 4000 && recalibratedAt === null; t += 33) {
      const step = session.update(state, detectors.update(null, t), t);
      state = step.state;
      if (step.recalibrate) recalibratedAt = t - 2000;
    }
    expect(recalibratedAt).not.toBeNull();
    expect(recalibratedAt!).toBeGreaterThanOrEqual(450);
    expect(recalibratedAt!).toBeLessThan(600);
    expect(state).toBe('calibrating');
  });
});
