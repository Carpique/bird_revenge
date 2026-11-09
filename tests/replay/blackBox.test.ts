import { describe, expect, it } from 'vitest';
import { BLACK_BOX_GAP_MS, BlackBox, parseBlackBox, type BlackBoxContext } from '../../src/pose/blackBox';
import { synthPose } from '../synthetic';
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
  it('keeps the last seconds in a bounded ring and dumps them in order', () => {
    const b = new BlackBox(2); // 120 frames of room
    for (let i = 0; i < 500; i++) b.add(i * 33, raw(i * 33), ctx({ lift: i }));
    expect(b.length).toBe(120);
    const d = b.dump(info)!;
    expect(d.frames).toHaveLength(120);
    expect(d.frames[0].t).toBe(0);
    expect(d.frames[119].t).toBe(119 * 33);
    expect(d.frames[0].ctl.lift).toBe(380); // the oldest kept: frame 380
    expect(d.frames[119].ctl.lift).toBe(499);
    expect(b.seconds).toBeCloseTo((119 * 33) / 1000, 3);
  });

  it('stores null frames, the game state per frame and the flags', () => {
    const b = new BlackBox(2);
    b.add(0, raw(0), ctx());
    b.add(33, null, ctx({ state: 'calibrating', playerPresent: false, personDetected: false, inFrame: false, inferenceMs: 3 }));
    const d = b.dump(info)!;
    expect(d.frames[0].lm).toHaveLength(33);
    expect(d.frames[0].lm![0]).toHaveLength(3);
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
});
