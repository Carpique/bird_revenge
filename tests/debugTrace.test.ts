import { describe, expect, it } from 'vitest';
import { TraceLog, type TraceFrame } from '../src/dev/debugTrace';
import { PoseDetectors } from '../src/input/poseControls';
import { L } from '../src/pose/landmarks';
import { frames } from './synthetic';

describe('TraceLog', () => {
  it("logs the right arm's confidence dropping as the events that open the out-of-frame panel", () => {
    const detectors = new PoseDetectors();
    const log = new TraceLog();
    const out: TraceFrame[] = [];
    // arms pointing up together; from 1 s to 3 s MediaPipe loses confidence in the right elbow
    for (const f of frames(4000, () => ({ armLeft: 170, armRight: 170 }))) {
      if (f.t >= 1000 && f.t < 3000) f.lm[L.rightElbow].v = 0.3;
      const raw = f.lm.map((p) => ({ x: p.x, y: p.y, z: 0, visibility: p.v }));
      out.push(log.add(f, f.t, detectors.update(f, f.t), raw, 12.34));
    }
    const types = log.events.map((e) => e.type);
    expect(types[0]).toBe('start');
    expect(log.events).toContainEqual(expect.objectContaining({ type: 'raw', part: 'rightArm', problem: 'rightElbow v=0.30' }));
    expect(log.events).toContainEqual(expect.objectContaining({ type: 'lost', part: 'rightArm' }));
    // the panel opens after the arm is lost, and closes once it's back
    expect(types.indexOf('outOfFrame')).toBeGreaterThan(types.indexOf('lost'));
    expect(types.lastIndexOf('inFrame')).toBeGreaterThan(types.indexOf('back'));

    const mid = out.find((f) => f.t >= 2000)!;
    expect(mid.parts.rightArm[0]).toBe(0);
    expect(mid.inFrame).toBe(false);
    expect(mid.raw![L.rightElbow][3]).toBe(0.3);
    expect(mid.ms).toBe(12.3);
    expect(mid.pointing?.right).toBeNull();
  });
});
