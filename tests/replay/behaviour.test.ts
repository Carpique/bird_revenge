import { describe, expect, it, vi } from 'vitest';
import { config } from '../../src/config';
import { PoseDetectors } from '../../src/input/poseControls';
import { PoseSession } from '../../src/input/poseSession';
import type { PoseFrame } from '../../src/pose/types';
import { synthPose } from '../synthetic';
import { allRecordings, cleanRun, sameControl, shift, simulate, tutorialRecording } from './harness';
import { hitchScenario, nullGapScenario, runScenario, SCENARIOS, type Scenario } from './scenarios';

/**
 * The game's behaviour on a recorded session, pinned as metrics (the numbers are what the code does, with
 * margins). A change that improves tracking on purpose flips the matching assertion in the same commit. The metrics are explained in `harness.ts` (`Metrics`); `metrics.test.ts` prints them all.
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
  it('gaps up to 340 ms (within pose.holdLastMs): no pause, no recalibration, the bird keeps its controls', () => {
    for (const ms of [34, 100, 340]) {
      for (const m of run(nullGapScenario(ms)).runs) {
        expect(m.recalibrations, `${ms} ms`).toBe(0);
        expect(m.outOfFrameMs, `${ms} ms`).toBe(0);
        expect(m.calibratingMs, `${ms} ms`).toBe(0);
        expect(m.staleMs, `${ms} ms`).toBe(0);
        // the held controls are the last good ones, off from the clean run for the length of the gap at most
        expect(m.wrongMs, `${ms} ms`).toBeLessThan(ms + 100);
      }
    }
  });

  it('510 to 2000 ms: a soft pause, the bird does not fall, no recalibration, back within a second', () => {
    for (const ms of [510, 680, 1020, 1500, 2000]) {
      for (const m of run(nullGapScenario(ms)).runs) {
        expect(m.recalibrations, `${ms} ms`).toBe(0);
        expect(m.calibratingMs, `${ms} ms`).toBe(0);
        expect(m.outOfFrameMs, `${ms} ms`).toBeGreaterThan(ms - config.pose.holdLastMs - 100);
        expect(m.staleMs, `${ms} ms`).toBeLessThan(80);
        expect(m.recoveryMs, `${ms} ms`).not.toBeNull();
        expect(m.recoveryMs!, `${ms} ms`).toBeLessThan(1000);
      }
    }
  });

  it('3.5 s: recalibration (the big dialog), as nobody is there any more', () => {
    for (const m of run(nullGapScenario(3500)).runs) {
      expect(m.recalibrations).toBe(1);
      expect(m.calibratingMs).toBeGreaterThan(0);
    }
  });
});

describe('hitches (no frames delivered, no callbacks)', () => {
  it('340 ms: nothing happens at all', () => {
    for (const m of run(hitchScenario(340)).runs) {
      expect(m.outOfFrameMs).toBe(0);
      expect(m.staleMs).toBe(0);
    }
  });

  it('680 ms and 1500 ms: the gap counts like null frames: soft pause, no fall, no recalibration', () => {
    for (const ms of [680, 1500]) {
      for (const m of run(hitchScenario(ms)).runs) {
        expect(m.recalibrations, `${ms} ms`).toBe(0);
        expect(m.staleMs, `${ms} ms`).toBe(0);
        expect(m.outOfFrameMs, `${ms} ms`).toBeGreaterThan(ms - config.pose.holdLastMs - 100);
        expect(m.recoveryMs!, `${ms} ms`).toBeLessThan(1000);
      }
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

  it('an elbow below the threshold for 1 s: one short soft pause (recoverAfterMs 150: on average 404 ms, back after 391 ms; it was 542 and 537)', () => {
    const r = run(scenario('left elbow low visibility 1000 ms'));
    for (const m of r.runs) {
      expect(m.recalibrations).toBe(0);
      expect(m.staleMs).toBe(0);
      expect(m.outOfFrameMs).toBeGreaterThan(0);
    }
    expect(r.mean.outOfFrameMs!).toBeLessThan(480);
    expect(r.mean.recoveryMs!).toBeLessThan(480);
  });

  it('a hallucinated wrist (low visibility, hanging) for 300 ms: no pause, a few hundred ms of wrong controls at most', () => {
    for (const m of run(scenario('left wrist hallucination 300 ms')).runs) {
      expect(m.recalibrations).toBe(0);
      expect(m.outOfFrameMs).toBe(0);
      expect(m.wrongMs).toBeLessThan(700);
    }
  });

  it('a wrist only guessed (v=0.15, hanging) with a confident elbow: the arm keeps pointing along the upper arm', () => {
    // without pose.minWristVisibility this was 483 ms (left wrist, 1 s) and 858 ms (both) of wrong controls on average
    const one = run(scenario('left wrist hanging v=0.15 1000 ms'));
    const both = run(scenario('both wrists hanging v=0.15 1000 ms'));
    for (const m of [...one.runs, ...both.runs]) {
      expect(m.recalibrations).toBe(0);
      expect(m.outOfFrameMs).toBe(0);
      expect(m.staleMs).toBe(0);
    }
    expect(one.mean.wrongMs!).toBeLessThan(150);
    expect(both.mean.wrongMs!).toBeLessThan(250);
  });

  it('normal play is unaffected by the wrist gate: the same controls tick by tick, the same shoot triggers', () => {
    for (const r of allRecordings()) {
      const on = cleanRun(r).run;
      const saved = config.pose.minWristVisibility;
      config.pose.minWristVisibility = 0;
      const off = simulate(r, r.frames);
      config.pose.minWristVisibility = saved;
      expect(on.ticks.filter((tk, i) => !sameControl(tk, off.ticks[i])).length, r.name).toBe(0);
      expect(on.triggers, r.name).toEqual(off.triggers);
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

  it('off-centre by 0.15: nothing happens; by 0.35 for 2 s: a soft pause, no recalibration', () => {
    const near = run(scenario('off-centre 0.15')).mean;
    expect(near.recalibrations).toBe(0);
    expect(near.calibratingMs).toBe(0);
    for (const m of run(scenario('off-centre 0.35 for 2000 ms')).runs) {
      expect(m.recalibrations).toBe(0);
      expect(m.calibratingMs).toBe(0);
      expect(m.outOfFrameMs).toBeGreaterThan(1000);
      expect(m.staleMs).toBeLessThan(80);
      expect(m.recoveryMs!).toBeLessThan(1000);
    }
  });

  it('off-centre by 0.35 for 4 s (longer than personGoneAfterMs): still only a soft pause, the person never left', () => {
    for (const m of run(scenario('off-centre 0.35 for 4000 ms')).runs) {
      expect(m.recalibrations).toBe(0);
      expect(m.calibratingMs).toBe(0);
      expect(m.outOfFrameMs).toBeGreaterThan(3000);
      expect(m.recoveryMs!).toBeLessThan(1000);
    }
  });

  it('off-centre for good (0.35): the game never starts, the tracker is told to look again', () => {
    const far = runScenario(rec, { name: 'far', ms: 0, build: (f) => shift(f, 0.35) }, clean).mean;
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

  /** a session of a game playing, fed the standing person for a second */
  const playing = () => {
    const detectors = warm();
    const session = new PoseSession();
    let state: string = 'outOfFrame';
    let t = 2000;
    for (; t < 3000; t += 33) state = session.update(state, detectors.update(synthPose({ t }), t), t).state;
    expect(state).toBe('playing');
    return { detectors, session, state, last: t - 33 };
  };

  it('controls apply while fresh (pose.holdLastMs after the last good frame), and only while playing', () => {
    const { session, last } = playing();
    const hold = config.pose.holdLastMs;
    expect(session.controls('playing', last + 100).pointing).not.toBeNull();
    expect(session.controls('playing', last + hold - 1).pointing).not.toBeNull();
    expect(session.controls('playing', last + hold).pointing).toBeNull();
    expect(session.controls('outOfFrame', last + 10).pointing).toBeNull();
    session.clear();
    expect(session.controls('playing', last + 10).pointing).toBeNull();
  });

  it('null frames: the last controls go on, then a soft pause, then the calibration dialog', () => {
    const { detectors, session, last } = playing();
    let state: string = 'playing';
    const at: Record<string, number> = {};
    for (let t = last + 33; t < last + 4000; t += 33) {
      const step = session.update(state, detectors.update(null, t), t);
      if (step.state !== state) at[step.state] = t - last;
      state = step.state;
      if (t - last < config.pose.holdLastMs) expect(session.controls(state, t).pointing).not.toBeNull();
      if (state === 'outOfFrame') expect(session.controls(state, t).pointing).toBeNull();
    }
    expect(at.outOfFrame).toBeGreaterThanOrEqual(config.pose.holdLastMs);
    expect(at.outOfFrame).toBeLessThan(config.pose.holdLastMs + 70);
    expect(at.calibrating).toBeGreaterThanOrEqual(config.visibility.personGoneAfterMs);
    expect(at.calibrating).toBeLessThan(config.visibility.personGoneAfterMs + 70);
  });

  it('no frames at all (a hitch): `tick` pauses and recalibrates on the same thresholds', () => {
    const { session, last } = playing();
    expect(session.tick('playing', last + config.pose.holdLastMs - 1).state).toBe('playing');
    expect(session.tick('playing', last + config.pose.holdLastMs).state).toBe('outOfFrame');
    const gone = session.tick('outOfFrame', last + config.visibility.personGoneAfterMs);
    expect(gone.recalibrate).toBe(true);
    expect(gone.state).toBe('calibrating');
    // not while the camera is off (or before any frame)
    session.clear();
    expect(session.tick('playing', last + 60000).state).toBe('playing');
  });

  /** the standing person moved sideways by `dx` (off centre) */
  const moved = (t: number, dx: number): PoseFrame => {
    const f = synthPose({ t });
    for (const p of f.lm) p.x += dx;
    return f;
  };

  it('a stall longer than personGoneAfterMs recalibrates whichever comes first: the first frame or the ticker', () => {
    const gone = config.visibility.personGoneAfterMs + 500;
    // the frame first: it ends the gap, but the gap is judged before it renews anything
    {
      const { detectors, session, last } = playing();
      const t = last + gone;
      const step = session.update('playing', detectors.update(synthPose({ t }), t), t);
      expect(step.recalibrate).toBe(true);
      expect(step.state).toBe('calibrating');
    }
    // the ticker first
    {
      const { session, last } = playing();
      const step = session.tick('playing', last + gone);
      expect(step.recalibrate).toBe(true);
      expect(step.state).toBe('calibrating');
    }
  });

  it('off centre longer than personGoneAfterMs: a soft pause, not the calibration dialog; centred again: playing', () => {
    const { detectors, session, last } = playing();
    let state: string = 'playing';
    let t = last + 33;
    const seen = new Set<string>();
    for (; t < last + config.visibility.personGoneAfterMs + 2000; t += 33) {
      const step = session.update(state, detectors.update(moved(t, 0.35), t), t);
      expect(step.recalibrate).toBe(false);
      state = step.state;
      seen.add(state);
      // the ticker between frames agrees
      const tick = session.tick(state, t + 16);
      expect(tick.recalibrate).toBe(false);
    }
    expect([...seen]).toEqual(expect.arrayContaining(['outOfFrame']));
    expect(seen.has('calibrating')).toBe(false);
    let back = -1;
    for (const t0 = t; t < t0 + 3000 && back < 0; t += 33) {
      state = session.update(state, detectors.update(synthPose({ t }), t), t).state;
      if (state === 'playing') back = t - t0;
    }
    expect(back).toBeGreaterThanOrEqual(0);
  });

  it('the detectors start afresh when the player is back after a spell off centre (the shoot calibration stays)', () => {
    const detectors = warm();
    const baseline = { left: 3, right: 4 };
    detectors.shoot.calibrate(baseline);
    const reset = vi.spyOn(detectors.pointing, 'reset');
    let t = 2000;
    for (; t < 3000; t += 33) detectors.update(synthPose({ t }), t);
    expect(reset).not.toHaveBeenCalled();
    for (; t < 5000; t += 33) detectors.update(moved(t, 0.35), t);
    expect(reset).not.toHaveBeenCalled(); // nothing while away: the reset comes with the player
    for (const t0 = t; t < t0 + 3000; t += 33) detectors.update(synthPose({ t }), t);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(detectors.shoot.baseline).not.toBeNull(); // kept (it re-learns slowly while standing, so not equal)
  });

  it('a soft pause ends with the first good frame back, and the bird flies on that frame', () => {
    const { detectors, session, last } = playing();
    let state: string = 'playing';
    let t = last + 33;
    for (; t < last + 1200; t += 33) state = session.update(state, detectors.update(null, t), t).state;
    expect(state).toBe('outOfFrame');
    // the monitor needs a while to count the parts as visible again: a few frames
    let back = -1;
    for (const t0 = t; t < t0 + 1500 && back < 0; t += 33) {
      const step = session.update(state, detectors.update(synthPose({ t }), t), t);
      state = step.state;
      if (state === 'playing') back = t - t0;
    }
    expect(back).toBeGreaterThanOrEqual(0);
    expect(back).toBeLessThan(800);
    expect(session.controls('playing', t - 33).pointing).not.toBeNull();
  });
});
