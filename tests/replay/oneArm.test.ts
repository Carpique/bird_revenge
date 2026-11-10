import { afterEach, describe, expect, it } from 'vitest';
import { config } from '../../src/config';
import { STEP_MS } from '../../src/game/physics';
import { PoseDetectors } from '../../src/input/poseControls';
import type { PointingIntent } from '../../src/game/pointing';
import { toPoseFrame } from '../../src/tutorial/recording';
import { fly, jolts } from './flight';
import { allRecordings, simulate, tutorialRecording, type Recording, type Tick } from './harness';

// the poses, not continuous steering (the default): what these tests measure
config.pointing.continuous = false;

/**
 * One arm steering (`pointing.oneArm`) on the recordings of real play (black-box dumps), through the full pipeline:
 * where the bird flies by one arm, for how long, how fast (flown with Matter.js, `flight.ts`), and that arms on
 * their way up or down don't fly it. Open loop: the players steered a bird without it (it dropped to rest there).
 */

const dumps = allRecordings().filter((r) => r.rec.level === 'black-box');
const short = (r: Recording) => r.name.replace(/^2026-11-(09|10)-/, '');

interface Episode {
  /** ticks [i0, i1] of the run in play */
  i0: number;
  i1: number;
  ms: number;
  /** the mode the bird was in before it and after it ('-': the recording ends) */
  from: string;
  to: string;
}

const play = (r: Recording) => simulate(r, r.frames, { startState: 'playing' }).ticks.filter((k) => k.state === 'playing');

/** the stretches where the bird flies by one arm */
function episodes(ticks: Tick[]): Episode[] {
  const eps: Episode[] = [];
  for (let i = 0; i < ticks.length; i++) {
    if (!ticks[i].intent?.oneArm) continue;
    let j = i;
    while (j + 1 < ticks.length && ticks[j + 1].intent?.oneArm) j++;
    eps.push({ i0: i, i1: j, ms: Math.round((j - i + 1) * STEP_MS), from: i ? ticks[i - 1].mode : '-', to: j + 1 < ticks.length ? ticks[j + 1].mode : '-' });
    i = j;
  }
  return eps;
}
const describeEps = (ticks: Tick[], eps: Episode[]) => eps.map((e) => `${(ticks[e.i0].t / 1000).toFixed(1)}s ${e.ms}ms ${e.from}>${e.to}`).join(', ') || 'none';

describe('one arm steering on recordings of play', () => {
  const saved = { ...config.pointing };
  afterEach(() => {
    Object.assign(config.pointing, saved);
  });

  it('there are recordings of play, the second player\'s among them', () => {
    expect(dumps.length).toBeGreaterThanOrEqual(5);
    expect(dumps.filter((r) => r.name.startsWith('2026-11-10-drugi-gracz-'))).toHaveLength(2);
  });

  // trening 26.6 s 800 ms (after a flight up) and 57.1 s 1533 ms (from the rest); drugi-gracz-2 24.6 s 800 ms (from a
  // tilted T) and 59.0 s 967 ms (from the rest, to the end of the recording): an arm straight up, or up and across
  it('the bird flies by one arm where the pose was held: twice each on two recordings, for 0.8 s and more', () => {
    const count: Record<string, number> = {};
    for (const r of dumps) {
      const ticks = play(r);
      const eps = episodes(ticks);
      console.log(`one arm ${short(r)}: ${describeEps(ticks, eps)}`);
      count[short(r)] = eps.length;
      for (const e of eps) expect(e.ms, `${short(r)} at ${ticks[e.i0].t}`).toBeGreaterThanOrEqual(700);
    }
    expect(count).toMatchObject({ 'gra-po-strojeniu': 0, gra: 0, trening: 2, 'drugi-gracz-1': 0, 'drugi-gracz-2': 2 });
  });

  it('where it flies by one arm the bird goes where the arm points, at the one-arm speed, never faster than both arms', () => {
    const cfg = config.pointing;
    let n = 0;
    for (const r of dumps) {
      const ticks = play(r);
      const vs = fly(ticks);
      for (const e of episodes(ticks)) {
        // from 0.4 s in (the speed eased from a flight's, the bird brought round) to the episode's end: at the one-arm
        // speed (the median; under it while the arm moves and the bird turns), never over it
        const speeds = vs.slice(e.i0 + Math.round(400 / STEP_MS), e.i1 + 1).map((v) => Math.hypot(v.x, v.y)).sort((x, y) => x - y);
        expect(speeds[Math.floor(speeds.length / 2)], `${short(r)} at ${ticks[e.i0].t}`).toBeGreaterThan(cfg.oneArmSpeed * cfg.cruiseSpeed - 0.3);
        expect(speeds[speeds.length - 1], `${short(r)} at ${ticks[e.i0].t}`).toBeLessThan(cfg.oneArmSpeed * cfg.cruiseSpeed + 0.6);
        n += speeds.length;
        for (let i = e.i0; i <= e.i1; i++) expect(Math.hypot(vs[i].x, vs[i].y)).toBeLessThanOrEqual(cfg.cruiseSpeed + 1e-6);
        // the pointing arm was up each time (straight up, or up and across the body): so is the flight, on the whole
        const dys = ticks.slice(e.i0, e.i1 + 1).map((k) => k.intent!.dy);
        expect(dys.reduce((x, y) => x + y, 0) / dys.length, `${short(r)} at ${ticks[e.i0].t}`).toBeGreaterThan(0.3);
      }
      expect(jolts(vs), short(r)).toBe(0);
    }
    expect(n).toBeGreaterThan(100);
  });

  it('the speed eases between both arms and one arm: steps of 0.75 px per step a camera frame at most (2.1 with oneArmBlendMs 0)', () => {
    const worst = () => {
      let w = 0;
      for (const r of dumps) {
        const ticks = play(r);
        for (let i = 1; i < ticks.length; i++) {
          const a = ticks[i - 1].intent, b = ticks[i].intent;
          if (a?.mode === 'fly' && b?.mode === 'fly') w = Math.max(w, Math.abs((a.speed ?? 1) - (b.speed ?? 1)) * config.pointing.cruiseSpeed);
        }
      }
      return w;
    };
    const eased = worst();
    expect(eased).toBeGreaterThan(0);
    expect(eased).toBeLessThan(0.8);
    config.pointing.oneArmBlendMs = 0;
    expect(worst()).toBeCloseTo((1 - config.pointing.oneArmSpeed) * config.pointing.cruiseSpeed, 6);
  });

  // at 60 ms: po-strojeniu 27.2 s 317 ms and 54.6 s 333 ms, trening 1.7 s 333 ms (each a tilted T coming down to the
  // rest), drugi-gracz-2 16.5 s 217 ms (an arm on its way up from the rest); at 150-200 ms one of them is left
  it('the wait (oneArmEnterMs) is what keeps arms on their way up or down from flying it: short flights at 60 ms, none at 300', () => {
    const shortOnes = () => {
      const out: string[] = [];
      for (const r of dumps) {
        const ticks = play(r);
        for (const e of episodes(ticks)) if (e.ms < 400) out.push(`${short(r)} ${(ticks[e.i0].t / 1000).toFixed(1)}s ${e.ms}ms ${e.from}>${e.to}`);
      }
      return out;
    };
    expect(shortOnes()).toEqual([]);
    config.pointing.oneArmEnterMs = config.pointing.enterMs;
    const quick = shortOnes();
    console.log(`one arm, oneArmEnterMs ${config.pointing.enterMs}: short flights ${quick.join(', ')}`);
    expect(quick.length).toBeGreaterThanOrEqual(3);
    // arms coming down from a tilted T to the rest
    expect(quick.filter((s) => s.endsWith('drift>rest')).length).toBeGreaterThanOrEqual(2);
  });

  it('off: no such flight, and the first recording of play is told the same either way (nobody held the pose there)', () => {
    config.pointing.oneArm = false;
    for (const r of dumps) expect(episodes(play(r)), short(r)).toHaveLength(0);
    const gra = dumps.find((r) => r.name === '2026-11-09-gra');
    if (gra) {
      const off = play(gra).map((k) => k.intent);
      config.pointing.oneArm = true;
      expect(play(gra).map((k) => k.intent)).toEqual(off);
    }
  });

  // the demonstrator waves one arm at the start and at the end (3.6-5.2 s and 64.9-66.7 s, the arm 25-40° above
  // level): read as steering it would fly the demonstration's bird off for 1.5 s and 1.8 s
  it('the instructions\' recording predates it and is played back without it (PoseReplay): its bird is told what it was told before', () => {
    const rec = tutorialRecording().rec;
    expect(rec.oneArm).toBeUndefined();
    /** the intents the recorded stream gives, through the detectors as `PoseReplay.feed` runs them */
    const intents = (oneArm: boolean | null) => {
      const det = new PoseDetectors();
      det.pointing.oneArm = oneArm;
      if (rec.baseline) det.shoot.calibrate({ ...rec.baseline });
      const out: (PointingIntent | null)[] = [];
      for (const f of rec.frames) out.push(det.update(toPoseFrame(f, rec.aspect), f.t).pointing?.intent ?? null);
      return out;
    };
    // as the demonstration plays it, with one arm steering on in the config
    const demo = intents(rec.oneArm ?? false);
    expect(demo.some((p) => p?.oneArm)).toBe(false);
    // what a live player doing the same would get now: the two waves fly
    const live = intents(null);
    expect(live.filter((p) => p?.oneArm).length).toBeGreaterThan(60);
    // and before one arm steering: the same as the demonstration
    config.pointing.oneArm = false;
    expect(intents(null)).toEqual(demo);
  });

  it('continuous steering: the same flights, eased in, no jolts', () => {
    config.pointing.continuous = true;
    const count: Record<string, number> = {};
    for (const r of dumps) {
      const ticks = play(r);
      const eps = episodes(ticks);
      console.log(`one arm, continuous ${short(r)}: ${describeEps(ticks, eps)}`);
      count[short(r)] = eps.length;
      for (const e of eps) expect(e.ms, `${short(r)} at ${ticks[e.i0].t}`).toBeGreaterThanOrEqual(400);
      expect(jolts(fly(ticks)), short(r)).toBe(0);
    }
    expect(count).toMatchObject({ 'gra-po-strojeniu': 0, gra: 0, trening: 2, 'drugi-gracz-1': 0, 'drugi-gracz-2': 2 });
  });
});
