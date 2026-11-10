import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { describe, expect, it } from 'vitest';
import { WORLD } from '../../src/config';
import type { BirdSample } from '../../src/game/Bird';
import type { PointingIntent } from '../../src/game/pointing';
import {
  BLACK_BOX_FORMAT,
  BLACK_BOX_GAP_MS,
  BlackBox,
  blackBoxEffect,
  parseBlackBox,
  type BlackBoxContext,
  type BlackBoxDump,
} from '../../src/pose/blackBox';
import { L } from '../../src/pose/landmarks';
import { PoseSmoother } from '../../src/pose/PoseSmoother';
import { synthPose, type SynthPose } from '../synthetic';
import { allRecordings, simulate, toRecording, type TF } from './harness';
import tutorialJson from '../../src/tutorial/control-tutorial.json?raw';

const recordingsJson = import.meta.glob<string>('./recordings/*.json', { eager: true, query: '?raw', import: 'default' });

const ctx = (over: Partial<BlackBoxContext> = {}): BlackBoxContext => ({
  state: 'playing',
  personDetected: true,
  centred: true,
  playerPresent: true,
  inFrame: true,
  lift: 0,
  tilt: 0,
  hover: 0,
  flapping: false,
  inferenceMs: 8,
  ...over,
});
const info = { model: 'lite', delegate: 'GPU', config: {}, flapping: true };
/** MediaPipe's shape: x, y, visibility */
const raw = (t: number, arm = 90) => synthPose({ t, armLeft: arm, armRight: arm }).lm.map((p) => ({ x: p.x, y: p.y, z: 0, visibility: p.v }));

describe('BlackBox', () => {
  it('keeps the last seconds in a bounded ring and dumps them in order (a camera faster than 60 fps fills the ring)', () => {
    const b = new BlackBox(2); // 120 frames of room
    for (let i = 0; i < 500; i++) b.add(i * 10, raw(i * 10), ctx({ lift: i }));
    expect(b.length).toBe(120);
    const d = b.dump(info)!;
    expect(d.frames).toHaveLength(120);
    expect(d.frames[0].t).toBe(0);
    expect(d.frames[119].t).toBe(119 * 10);
    expect(d.frames[0].ctl.lift).toBe(380); // the oldest kept: frame 380
    expect(d.frames[119].ctl.lift).toBe(499);
    expect(b.seconds).toBeCloseTo((119 * 10) / 1000, 3);
  });

  it('the window is time, not frames: at 30 or 15 fps, and with uneven frame times, no more than the seconds asked for', () => {
    for (const dt of [33, 67]) {
      const b = new BlackBox(2);
      for (let i = 0; i < 500; i++) b.add(i * dt, raw(i * dt), ctx());
      expect(b.seconds).toBeLessThanOrEqual(2);
      expect(b.seconds).toBeGreaterThan(2 - dt / 1000 - 1e-9);
      expect(b.length).toBe(Math.floor(2000 / dt) + 1);
    }
    const b = new BlackBox(2);
    let t = 0;
    for (let i = 0; i < 300; i++) b.add((t += i % 7 === 0 ? 180 : 25), raw(t), ctx());
    expect(b.seconds).toBeLessThanOrEqual(2);
    expect(b.dump(info)!.blackBox.seconds).toBeLessThanOrEqual(2);
  });

  it('stores null frames, the game state per frame and the flags', () => {
    const b = new BlackBox(2);
    b.add(0, raw(0), ctx());
    b.add(33, null, ctx({ state: 'calibrating', playerPresent: false, personDetected: false, inFrame: false, inferenceMs: 3 }));
    const d = b.dump(info)!;
    expect(d.frames[0].lm).toHaveLength(33);
    expect(d.frames[0].lm![0]).toHaveLength(4); // x, y, visibility, z
    expect(d.frames[1].lm).toBeNull();
    expect(d.frames[1]).toMatchObject({ st: 'calibrating', pp: false, pd: false, in: false, ms: 3 });
    expect(d.frames[0]).toMatchObject({ st: 'playing', pp: true, ce: true, in: true });
    expect(d.blackBox).toMatchObject({ model: 'lite', delegate: 'GPU' });
  });

  it('is empty before the first frame, and a long gap (camera off) starts a new stream', () => {
    const b = new BlackBox(2);
    expect(b.dump(info)).toBeNull();
    b.add(0, raw(0), ctx());
    b.add(33, raw(33), ctx());
    b.add(33 + BLACK_BOX_GAP_MS + 1, raw(0), ctx());
    expect(b.length).toBe(1);
  });

  it('rejects what is not a recording', () => {
    expect(() => parseBlackBox({ version: 2 })).toThrow();
    expect(() => parseBlackBox({ version: 1, aspect: 1.7, frames: [{ t: 5, lm: [] }] })).toThrow();
    expect(() => parseBlackBox({ version: 1, aspect: 1.7, frames: [{ t: 5, lm: null }, { t: 5, lm: null }] })).toThrow();
  });

  it('round-trips a synthetic dump through the replay harness', () => {
    // 6 s of a person flapping, 4 s of nobody (long enough for a recalibration), 2 s of the person back
    const b = new BlackBox(60);
    const live: TF[] = [];
    for (let i = 0; i < 340; i++) {
      const t = i * 33;
      const gone = t >= 6000 && t < 10000;
      const arm = 90 + 80 * Math.sin(t / 150);
      b.add(1000 + t, gone ? null : raw(t, arm), ctx({ playerPresent: !gone }));
      live.push({ t, f: gone ? null : { t, aspect: 16 / 9, lm: synthPose({ t, armLeft: arm, armRight: arm }).lm } });
    }
    const json = JSON.parse(JSON.stringify(b.dump(info)));
    const rec = toRecording('black-box', parseBlackBox(json));
    expect(rec.frames).toHaveLength(340);
    expect(rec.frames.filter((f) => f.f === null)).toHaveLength(live.filter((f) => f.f === null).length);
    expect(rec.frames[0].t).toBe(0);

    const replay = simulate(rec, rec.frames);
    const direct = simulate(toRecording('direct', { ...rec.rec, frames: live.map((f) => ({ t: f.t, lm: f.f && f.f.lm.map((p) => [p.x, p.y, p.v] as [number, number, number]) })) }), live);
    // the same game decisions on the dump as on the stream it was made from (to 4 decimals of rounding)
    expect(replay.events.map((e) => e.type)).toEqual(direct.events.map((e) => e.type));
    expect(replay.events.some((e) => e.type === 'recalibrate')).toBe(true);
    expect(replay.ticks.length).toBe(direct.ticks.length);
  });
  it('keeps MediaPipe depth (z), so the replay stands in for a hidden arm as the game did', () => {
    // pointing up-left together for 1 s, then the right (far, larger z) arm hidden and guessed hanging, for 2 s
    const POINT_LEFT: Omit<SynthPose, 't'> = { armLeft: 120, armRight: -120 };
    const hanging = synthPose({ t: 0, armLeft: 10, armRight: 10 }).lm;
    const rawAt = (t: number): NormalizedLandmark[] => {
      const lm = synthPose({ t, ...POINT_LEFT }).lm.map((p, i) => ({
        x: p.x, y: p.y, z: i === L.rightWrist || i === L.rightElbow ? 0.15 : -0.25, visibility: p.v,
      }));
      if (t >= 1000) for (const i of [L.rightElbow, L.rightWrist]) lm[i] = { ...lm[i], x: hanging[i].x, y: hanging[i].y, visibility: 0.3 };
      return lm;
    };
    const b = new BlackBox(60);
    for (let t = 0; t < 3000; t += 33) b.add(t, rawAt(t), ctx());
    const rec = toRecording('black-box', parseBlackBox(JSON.parse(JSON.stringify(b.dump(info)))));
    expect(rec.frames[0].f!.lm[L.rightWrist].z).toBeCloseTo(0.15, 4);
    expect(rec.frames[0].f!.lm[L.leftWrist].z).toBeCloseTo(-0.25, 4);
    // the tracker's pipeline on the dump: with the depths the stand-in comes in, without them (all 0) it does not
    const standIn = (keepZ: boolean) => {
      const sm = new PoseSmoother();
      for (const { t, f } of rec.frames)
        sm.process(f!.lm.map((p) => ({ x: p.x, y: p.y, z: keepZ ? (p.z ?? 0) : 0, visibility: p.v })), f!.aspect, t);
      return sm.occlusion.standIn.right;
    };
    expect(standIn(true)).toBe(1);
    expect(standIn(false)).toBe(0);
  });

  it('keeps the calibration baseline, so the replay shoots as the game did', () => {
    // a person standing, a calibration 4 s in, then the left leg out twice
    const b = new BlackBox(60);
    const baseline = { left: 0, right: 0 };
    for (let t = 0; t < 12000; t += 33) {
      const leg = (t >= 7000 && t < 7600) || (t >= 9500 && t < 10100) ? 45 : 0;
      if (t === 3960) b.calibrated(t, baseline);
      b.add(t, synthPose({ t, legLeft: leg }).lm.map((p) => ({ x: p.x, y: p.y, z: 0, visibility: p.v })), ctx());
    }
    const d = JSON.parse(JSON.stringify(b.dump(info)));
    expect(d.baseline).toBeNull(); // calibrated after the first frame...
    expect(d.calibrations).toEqual([{ t: 3960, baseline }]); // ...so it comes in at its time
    const replay = simulate(toRecording('black-box', parseBlackBox(d)), toRecording('black-box', parseBlackBox(d)).frames);
    expect(replay.triggers.length).toBe(2);
    // without the calibration the shoot detector never fires
    const bare = parseBlackBox({ ...d, calibrations: undefined });
    expect(simulate(toRecording('bare', bare), toRecording('bare', bare).frames).triggers).toHaveLength(0);

    // a calibration older than the window is the baseline of the dump
    const c = new BlackBox(2);
    c.calibrated(0, baseline);
    for (let t = 0; t < 5000; t += 33) c.add(t, raw(t), ctx());
    const dc = c.dump(info)!;
    expect(dc.baseline).toEqual(baseline);
    expect(dc.calibrations).toBeUndefined();
  });
});

const bird = (over: Partial<BirdSample> = {}): BirdSample => ({ x: 640, y: 300, vx: 0, vy: 0, onGround: false, perched: false, dying: false, ...over });
const roundTrip = (d: BlackBoxDump | null) => JSON.parse(JSON.stringify(d));

describe('BlackBox: the effect (format 2)', () => {
  it('round-trips the intent, the bird, the drops and the long render frames through add -> dump -> blackBoxEffect', () => {
    const b = new BlackBox(2);
    const fly: PointingIntent = { mode: 'fly', dx: 0.70710678, dy: 0.70710678 };
    const drift: PointingIntent = { mode: 'drift', dx: -1, dy: 0, sink: 2.345 };
    b.add(0, raw(0), ctx({ intent: fly, bird: bird({ x: 100.04, y: 200.06, vx: 1.234, vy: -5.678 }), dropped: 0, longRender: 0 }));
    b.add(33, raw(33), ctx({ intent: drift, bird: bird({ onGround: true, perched: true }), dropped: 2, longRender: 3 }));
    b.add(66, raw(66), ctx({ intent: { mode: 'hover', dx: 0, dy: 0 }, bird: bird({ dying: true }), dropped: 1, longRender: 1 }));
    b.add(99, raw(99), ctx({ intent: { mode: 'rest', dx: 0, dy: 0, sink: 0 }, bird: bird(), dropped: 0, longRender: 0 }));
    const d = roundTrip(b.dump({ ...info, source: 'capture' }));
    // short keys, rounded
    expect(d.frames[0]).toMatchObject({ pi: { m: 'fly', dx: 0.707, dy: 0.707 }, bd: { x: 100, y: 200.1, vx: 1.23, vy: -5.68 }, dr: 0, lr: 0 });
    expect(d.frames[0].pi.s).toBeUndefined(); // no sink: no key
    expect(d.frames[0].bd.gr).toBeUndefined(); // flags only when true
    expect(d.frames[1]).toMatchObject({ pi: { m: 'drift', dx: -1, dy: 0, s: 2.35 }, bd: { gr: true, pe: true }, dr: 2, lr: 3 });
    expect(d.blackBox).toMatchObject({
      format: BLACK_BOX_FORMAT,
      source: 'capture',
      dropped: 3,
      longRender: 4,
      world: { width: WORLD.width, height: WORLD.height, groundY: WORLD.groundY },
    });
    expect(d.blackBox.world.stepMs).toBeCloseTo(1000 / 60, 3);

    const e = blackBoxEffect(d)!;
    expect(e).toMatchObject({ format: 2, source: 'capture', dropped: 3, longRender: 4 });
    expect(e.frames.map((f) => f.t)).toEqual(d.frames.map((f: { t: number }) => f.t));
    expect(e.frames[0]).toEqual({
      t: 0,
      hasIntent: true,
      intent: { mode: 'fly', dx: 0.707, dy: 0.707 },
      bird: { x: 100, y: 200.1, vx: 1.23, vy: -5.68, onGround: false, perched: false, dying: false },
      dropped: 0,
      longRender: 0,
    });
    expect(e.frames[1].intent).toEqual({ mode: 'drift', dx: -1, dy: 0, sink: 2.35 });
    expect(e.frames[1].bird).toMatchObject({ onGround: true, perched: true, dying: false });
    expect(e.frames[2].intent).toEqual({ mode: 'hover', dx: 0, dy: 0 });
    expect(e.frames[2].bird).toMatchObject({ onGround: false, dying: true });
    expect(e.frames[3].intent).toEqual({ mode: 'rest', dx: 0, dy: 0 });
    // the replay side is untouched: parseBlackBox still hands a plain recording
    expect(Object.keys(parseBlackBox(d).frames[0]).sort()).toEqual(['lm', 't']);
  });

  it("round-trips continuous steering's velocity, a zero included; an intent without one reads back without it", () => {
    const b = new BlackBox(2);
    const drift: PointingIntent = { mode: 'drift', dx: -1, dy: 0, vx: -1.234, vy: 0 };
    const fly: PointingIntent = { mode: 'fly', dx: 0.6, dy: 0.8, vx: 4.2, vy: -5.6 };
    const hover: PointingIntent = { mode: 'hover', dx: 0, dy: 0, vx: 0, vy: 0 };
    b.add(0, raw(0), ctx({ intent: drift }));
    b.add(33, raw(33), ctx({ intent: fly }));
    b.add(66, raw(66), ctx({ intent: hover }));
    b.add(99, raw(99), ctx({ intent: { mode: 'fly', dx: 1, dy: 0 } }));
    const d = roundTrip(b.dump(info));
    expect(d.frames[0].pi).toEqual({ m: 'drift', dx: -1, dy: 0, vx: -1.23, vy: 0 });
    expect(d.frames[2].pi).toEqual({ m: 'hover', dx: 0, dy: 0, vx: 0, vy: 0 });
    expect(d.frames[3].pi).toEqual({ m: 'fly', dx: 1, dy: 0 });
    const e = blackBoxEffect(d)!;
    expect(e.frames.map((f) => f.intent)).toEqual([
      { mode: 'drift', dx: -1, dy: 0, vx: -1.23, vy: 0 },
      { mode: 'fly', dx: 0.6, dy: 0.8, vx: 4.2, vy: -5.6 },
      { mode: 'hover', dx: 0, dy: 0, vx: 0, vy: 0 },
      { mode: 'fly', dx: 1, dy: 0 },
    ]);
  });

  it('a format-2 dump written before the velocity reads as before', () => {
    const b = new BlackBox(2);
    b.add(0, raw(0), ctx({ intent: { mode: 'hover', dx: 0, dy: 0 } }));
    const d = roundTrip(b.dump(info));
    d.frames = [{ t: 0, lm: [], pi: { m: 'drift', dx: 1, dy: 0, s: 0.5 } }, { t: 33, lm: [], pi: { m: 'hover', dx: 0, dy: 0 } }];
    expect(blackBoxEffect(d)!.frames.map((f) => f.intent)).toEqual([
      { mode: 'drift', dx: 1, dy: 0, sink: 0.5 },
      { mode: 'hover', dx: 0, dy: 0 },
    ]);
  });

  it('a null intent and unknown drops are represented and read back as such; what was not given is absent', () => {
    const b = new BlackBox(2);
    b.add(0, null, ctx({ state: 'calibrating', intent: null, bird: bird(), dropped: null, longRender: 0 }));
    b.add(33, raw(33), ctx()); // nothing of the effect given (as a caller without it)
    const d = roundTrip(b.dump(info));
    expect(d.frames[0].pi).toBeNull();
    expect('dr' in d.frames[0]).toBe(false);
    for (const k of ['pi', 'bd', 'dr', 'lr']) expect(k in d.frames[1]).toBe(false);
    expect(d.blackBox.source).toBeNull(); // no source given
    const e = blackBoxEffect(d)!;
    expect(e.frames[0]).toMatchObject({ hasIntent: true, intent: null, dropped: null, longRender: 0 });
    expect(e.frames[0].bird).not.toBeNull();
    expect(e.frames[1]).toEqual({ t: 33, hasIntent: false, intent: null, bird: null, dropped: null, longRender: null });
    expect(e).toMatchObject({ dropped: 0, longRender: 0 });
  });

  it('the effect wraps with the ring and is pruned by the time window together with its frames', () => {
    // a camera faster than 60 fps wraps the ring; each frame's effect carries its index
    const b = new BlackBox(2); // 120 frames of room
    for (let i = 0; i < 500; i++) {
      const intent: PointingIntent | null = i % 5 === 0 ? null : { mode: 'fly', dx: (i % 100) / 100, dy: 0 };
      b.add(i * 10, raw(i * 10), ctx({ lift: i, intent, bird: bird({ x: i, vy: i / 10 }), dropped: i % 3 === 0 ? null : i % 7, longRender: i % 4 }));
    }
    const check = (d: BlackBoxDump, first: number) => {
      const e = blackBoxEffect(roundTrip(d))!;
      expect(e.frames).toHaveLength(d.frames.length);
      let dropped = 0, long = 0;
      e.frames.forEach((f, k) => {
        const i = first + k;
        expect(d.frames[k].ctl.lift).toBe(i); // the frame and its effect stay together
        expect(f.bird!.x).toBe(i);
        expect(f.bird!.vy).toBeCloseTo(i / 10, 2);
        expect(f.intent).toEqual(i % 5 === 0 ? null : { mode: 'fly', dx: (i % 100) / 100, dy: 0 });
        expect(f.dropped).toBe(i % 3 === 0 ? null : i % 7);
        expect(f.longRender).toBe(i % 4);
        dropped += f.dropped ?? 0;
        long += f.longRender!;
      });
      // the header's totals are over the dump only
      expect(e.dropped).toBe(dropped);
      expect(e.longRender).toBe(long);
    };
    check(b.dump(info)!, 380);

    // 30 fps: the time window, not the ring, drops the old frames, and their effect with them
    const c = new BlackBox(2);
    for (let i = 0; i < 500; i++) {
      const intent: PointingIntent | null = i % 5 === 0 ? null : { mode: 'fly', dx: (i % 100) / 100, dy: 0 };
      c.add(i * 33, raw(i * 33), ctx({ lift: i, intent, bird: bird({ x: i, vy: i / 10 }), dropped: i % 3 === 0 ? null : i % 7, longRender: i % 4 }));
    }
    const dc = c.dump(info)!;
    expect(dc.frames).toHaveLength(Math.floor(2000 / 33) + 1);
    check(dc, 500 - dc.frames.length);
  });

  it('a dump from before the effect (no format) parses as before and yields no effect', () => {
    const old: [string, string][] = [['control-tutorial', tutorialJson], ...Object.entries(recordingsJson)];
    expect(old.length).toBe(4);
    for (const [name, text] of old) {
      const json = JSON.parse(text);
      expect(blackBoxEffect(json), name).toBeNull();
      expect(() => parseBlackBox(json), name).not.toThrow();
      expect(json.frames.some((f: object) => 'pi' in f || 'bd' in f), name).toBe(false);
    }
    // the replay suite's view of them is unchanged (same frames as the harness loads)
    expect(allRecordings()).toHaveLength(4);

    // a new dump: the same recording for the replay as the dump without its effect and header additions
    const b = new BlackBox(2);
    for (let i = 0; i < 30; i++) b.add(i * 33, raw(i * 33), ctx({ intent: { mode: 'hover', dx: 0, dy: 0 }, bird: bird(), dropped: 0, longRender: 1 }));
    const d = roundTrip(b.dump(info));
    const stripped = {
      ...d,
      frames: d.frames.map(({ pi, bd, dr, lr, ...f }: Record<string, unknown>) => (void [pi, bd, dr, lr], f)),
      blackBox: { ...d.blackBox, format: undefined, source: undefined, dropped: undefined, longRender: undefined, world: undefined },
    };
    expect(blackBoxEffect(stripped)).toBeNull();
    expect(parseBlackBox(d)).toEqual(parseBlackBox(stripped));
    // plain recordings and junk: no effect, no throw
    expect(blackBoxEffect({ version: 1, aspect: 1.7, frames: [] })).toBeNull();
    expect(blackBoxEffect(null)).toBeNull();
  });

  it('records the intent the pipeline gives the bird, frame by frame (a recording played as main.ts feeds the box)', () => {
    for (const rec of allRecordings()) {
      const b = new BlackBox(rec.frames[rec.frames.length - 1].t / 1000 + 1);
      const given: (PointingIntent | null)[] = [];
      const run = simulate(rec, rec.frames, {
        onFrame: ({ t, f }, state, c) => {
          given.push(c.pointing && { ...c.pointing });
          const lm = f && f.lm.map((p) => ({ x: p.x, y: p.y, z: p.z ?? 0, visibility: p.v }));
          b.add(t, lm, ctx({ state, intent: c.pointing, flapping: c.flapping, dropped: null }));
        },
      });
      // the hook only watches: the run is the same as without it
      expect(run).toEqual(simulate(rec, rec.frames));
      const e = blackBoxEffect(roundTrip(b.dump(info)))!;
      expect(e.frames).toHaveLength(given.length);
      expect(given.length).toBeGreaterThanOrEqual(rec.frames.length - 1); // the last 60 Hz tick may come before the last frame
      const playing = given.filter((p) => p !== null);
      expect(playing.length, rec.name).toBeGreaterThan(100); // the recording does reach play and pointing
      e.frames.forEach((f, k) => {
        const p = given[k];
        if (!p) return expect(f.intent).toBeNull();
        expect(f.intent!.mode).toBe(p.mode);
        expect(f.intent!.dx).toBeCloseTo(p.dx, 3);
        expect(f.intent!.dy).toBeCloseTo(p.dy, 3);
        expect(f.intent!.sink ?? 0).toBeCloseTo(p.sink ?? 0, 2);
      });
      const modes = new Set(e.frames.map((f) => f.intent?.mode ?? 'none'));
      expect(modes.has('fly') || modes.has('drift') || modes.has('hover'), rec.name).toBe(true);
    }
  });
});
