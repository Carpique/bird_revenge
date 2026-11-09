import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { PoseDetectors } from '../src/input/poseControls';
import { L } from '../src/pose/landmarks';
import { PoseSmoother } from '../src/pose/PoseSmoother';
import { WristGate } from '../src/pose/WristGate';
import { frames, synthPose } from './synthetic';

const ASPECT = 16 / 9;
const toRaw = (f: ReturnType<typeof synthPose>): NormalizedLandmark[] => f.lm.map((p) => ({ x: p.x, y: p.y, z: 0, visibility: p.v }));

/** both arms raised to the sides, as MediaPipe sees them */
const RAISED = { armLeft: 120, armRight: -120 };
const pose = () => toRaw(synthPose({ t: 0, ...RAISED }));
/** the left wrist guessed hanging from the shoulder, with visibility `v` */
function hangWrist(raw: NormalizedLandmark[], v: number) {
  const sh = raw[L.leftShoulder], wr = raw[L.leftWrist];
  raw[L.leftWrist] = { ...wr, x: sh.x, y: sh.y + Math.hypot(wr.x - sh.x, wr.y - sh.y), visibility: v };
}

describe('WristGate', () => {
  it('moves a wrist below pose.minWristVisibility onto the shoulder-elbow line when the elbow is confident', () => {
    const raw = pose();
    const el = raw[L.leftElbow], sh = raw[L.leftShoulder];
    hangWrist(raw, 0.15);
    const out = new WristGate().apply(raw);
    const wr = out[L.leftWrist];
    // on the line shoulder -> elbow, beyond the elbow
    const cross = (wr.x - el.x) * (el.y - sh.y) - (wr.y - el.y) * (el.x - sh.x);
    const dot = (wr.x - el.x) * (el.x - sh.x) + (wr.y - el.y) * (el.y - sh.y);
    expect(Math.abs(cross)).toBeLessThan(1e-9);
    expect(dot).toBeGreaterThan(0);
    expect(wr.visibility).toBe(0.15);
    expect(out[L.rightWrist]).toBe(raw[L.rightWrist]); // the other arm is untouched
    expect(raw[L.leftWrist].y).toBeGreaterThan(sh.y); // the input is left alone
  });

  it('leaves everything as it is with the wrist seen, or with the elbow not confident either (the arm is unknown)', () => {
    const gate = new WristGate();
    const seen = pose();
    expect(gate.apply(seen)).toBe(seen);
    const both = pose();
    hangWrist(both, 0.15);
    both[L.leftElbow] = { ...both[L.leftElbow], visibility: 0.3 };
    expect(gate.apply(both)).toBe(both);
    expect(gate.gated.left).toBe(false);
  });

  it('takes the wrist as seen again only above the margin (no flipping around the threshold)', () => {
    const gate = new WristGate();
    const { minWristVisibility: min, wristVisibilityMargin: margin } = config.pose;
    const at = (v: number) => {
      const raw = pose();
      hangWrist(raw, v);
      gate.apply(raw);
      return gate.gated.left;
    };
    expect(at(min + 0.01)).toBe(false);
    expect(at(min - 0.01)).toBe(true);
    expect(at(min + margin / 2)).toBe(true);
    expect(at(min + margin + 0.01)).toBe(false);
  });

  it('is part of the smoother: a hallucinated wrist does not turn the pointing direction', () => {
    /** the left arm's pointing angle (deg) after 2 s of `RAISED`, with the left wrist hallucinated from 0.5 s on (or not) */
    const angle = (hallucinate: boolean, minWrist = config.pose.minWristVisibility) => {
      const saved = config.pose.minWristVisibility;
      config.pose.minWristVisibility = minWrist;
      try {
        const sm = new PoseSmoother();
        const det = new PoseDetectors();
        let left: number | null = null;
        for (const f of frames(2000, () => RAISED)) {
          const raw = toRaw(f);
          if (hallucinate && f.t >= 500) hangWrist(raw, 0.15);
          const lm = sm.process(raw, ASPECT, f.t)!;
          left = det.update({ t: f.t, lm, aspect: ASPECT }, f.t).pointing!.left;
        }
        return left!;
      } finally {
        config.pose.minWristVisibility = saved;
      }
    };
    const clean = angle(false);
    expect(Math.abs(angle(true) - clean)).toBeLessThan(10);
    expect(Math.abs(angle(true, 0) - clean)).toBeGreaterThan(40); // without the gate the arm points down
  });
});
