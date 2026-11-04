import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { describe, expect, it } from 'vitest';
import { PoseDetectors } from '../src/input/poseControls';
import { ArmOcclusion } from '../src/pose/ArmOcclusion';
import { L } from '../src/pose/landmarks';
import type { PoseFrame } from '../src/pose/types';
import { frames, synthPose, type SynthPose } from './synthetic';

const ASPECT = 16 / 9;

/** Arms pointing up and to the person's left (screen left): the left arm raised outward, the right one across the body. */
const POINT_LEFT: Omit<SynthPose, 't'> = { armLeft: 120, armRight: -120 };

/** MediaPipe's landmarks for a synthetic frame: the right arm behind the left one (larger z). */
const toRaw = (f: PoseFrame): NormalizedLandmark[] =>
  f.lm.map((p, i) => ({ x: p.x, y: p.y, z: i === L.rightWrist || i === L.rightElbow ? 0.15 : -0.25, visibility: p.v }));

/** What MediaPipe does with a hidden arm: low confidence, and the arm guessed hanging down. */
function hideArm(raw: NormalizedLandmark[], side: 'left' | 'right', visibility: number) {
  const hanging = toRaw(synthPose({ t: 0, armLeft: 10, armRight: 10 }));
  for (const i of side === 'left' ? [L.leftElbow, L.leftWrist] : [L.rightElbow, L.rightWrist]) {
    raw[i] = { ...hanging[i], z: raw[i].z, visibility };
  }
}

const fromRaw = (raw: NormalizedLandmark[], t: number): PoseFrame => ({
  t,
  lm: raw.map((p) => ({ x: p.x, y: p.y, v: p.visibility ?? 0 })),
  aspect: ASPECT,
});

describe('ArmOcclusion', () => {
  it('stands the near arm in for the far one hidden behind it, keeping the player in frame and the bird flying', () => {
    const occ = new ArmOcclusion();
    const det = new PoseDetectors();
    let last: ReturnType<PoseDetectors['update']> | null = null;
    // pointing together for 1 s, then for 3 s MediaPipe loses the right (far) arm and guesses it hanging
    for (const f of frames(4000, () => POINT_LEFT)) {
      const raw = toRaw(f);
      if (f.t >= 1000) hideArm(raw, 'right', 0.3);
      const out = occ.apply(raw, ASPECT);
      if (f.t >= 1000) {
        expect(occ.standIn.right).toBe(1);
        // the stand-in: the left arm's wrist, moved onto the right shoulder
        expect(out[L.rightWrist].x - out[L.rightShoulder].x).toBeCloseTo(raw[L.leftWrist].x - raw[L.leftShoulder].x);
        expect(out[L.rightWrist].y - out[L.rightShoulder].y).toBeCloseTo(raw[L.leftWrist].y - raw[L.leftShoulder].y);
        expect(raw[L.rightWrist].visibility).toBe(0.3);
      }
      last = det.update(fromRaw(out, f.t), f.t);
    }
    expect(occ.standIn.left).toBe(0);
    expect(last!.vis.inFrame).toBe(true);
    expect(last!.pointing!.intent!.mode).toBe('fly');
    // flying where the arms point: up and to the screen's left
    expect(last!.pointing!.intent!.dx).toBeLessThan(0);
    expect(last!.pointing!.intent!.dy).toBeGreaterThan(0);
  });

  it('blends the stand-in in as the confidence fades', () => {
    const occ = new ArmOcclusion();
    const weights: number[] = [];
    for (const f of frames(1000, () => POINT_LEFT)) {
      const raw = toRaw(f);
      // confidence falling from 0.9 to 0.4 over the second
      for (const i of [L.rightElbow, L.rightWrist]) raw[i] = { ...raw[i], visibility: 0.9 - f.t / 2000 };
      occ.apply(raw, ASPECT);
      weights.push(occ.standIn.right);
    }
    expect(weights[0]).toBe(0);
    expect(weights.at(-1)).toBe(1);
    for (let i = 1; i < weights.length; i++) expect(weights[i]).toBeGreaterThanOrEqual(weights[i - 1]);
    expect(weights.some((w) => w > 0.2 && w < 0.8)).toBe(true);
  });

  it('leaves the arm alone once it is seen again', () => {
    const occ = new ArmOcclusion();
    for (const f of frames(2000, () => POINT_LEFT)) {
      const raw = toRaw(f);
      if (f.t >= 500 && f.t < 1500) hideArm(raw, 'right', 0.3);
      const out = occ.apply(raw, ASPECT);
      if (f.t >= 1500) {
        expect(occ.standIn.right).toBe(0);
        expect(out[L.rightWrist]).toBe(raw[L.rightWrist]);
      }
    }
  });

  it("doesn't stand in when the arms weren't pointing together (a T: each arm out to its own side)", () => {
    const occ = new ArmOcclusion();
    for (const f of frames(2000, () => ({ armLeft: 90, armRight: 90 }))) {
      const raw = toRaw(f);
      if (f.t >= 1000) hideArm(raw, 'right', 0.3);
      expect(occ.apply(raw, ASPECT)[L.rightWrist]).toBe(raw[L.rightWrist]);
    }
  });

  it("doesn't stand in for the near arm (it can't be hidden behind the far one)", () => {
    const occ = new ArmOcclusion();
    for (const f of frames(2000, () => POINT_LEFT)) {
      const raw = toRaw(f);
      if (f.t >= 1000) hideArm(raw, 'left', 0.3);
      expect(occ.apply(raw, ASPECT)[L.leftWrist]).toBe(raw[L.leftWrist]);
    }
  });

  it('gives up when the near arm fades too: the player really is out of view', () => {
    const occ = new ArmOcclusion();
    for (const f of frames(2000, () => POINT_LEFT)) {
      const raw = toRaw(f);
      if (f.t >= 500) hideArm(raw, 'right', 0.3);
      if (f.t >= 1000) for (const i of [L.leftElbow, L.leftWrist]) raw[i] = { ...raw[i], visibility: 0.5 };
      occ.apply(raw, ASPECT);
      if (f.t >= 1000) expect(occ.standIn).toEqual({ left: 0, right: 0 });
    }
  });
});
