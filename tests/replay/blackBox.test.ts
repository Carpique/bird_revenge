import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { describe, expect, it } from 'vitest';
import { BLACK_BOX_GAP_MS, BlackBox, parseBlackBox, type BlackBoxContext } from '../../src/pose/blackBox';
import { L } from '../../src/pose/landmarks';
import { PoseSmoother } from '../../src/pose/PoseSmoother';
import { synthPose, type SynthPose } from '../synthetic';
import { simulate, toRecording, type TF } from './harness';

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
