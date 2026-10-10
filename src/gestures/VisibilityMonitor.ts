import { config } from '../config';
import { PART_LANDMARKS, PART_NAMES, type PartName } from '../pose/landmarks';
import type { PoseFrame } from '../pose/types';
import { isVisible } from './geometry';

export interface PartStatus {
  /** raw: visible in this frame */
  raw: boolean;
  /** smoothed 0..1 */
  score: number;
  /** debounced decision used by the game */
  visible: boolean;
}

export interface VisibilityOutput {
  personDetected: boolean;
  parts: Record<PartName, PartStatus>;
  allVisible: boolean;
  /** body bounding box in normalised image coords (not mirrored), if a person is detected */
  box: { minX: number; maxX: number; minY: number; maxY: number } | null;
  /** what to tell the player, or null when all good */
  hint: string | null;
}

interface PartTimer {
  status: PartStatus;
  belowSince: number | null;
  aboveSince: number | null;
}

/**
 * Decides whether the player is fully in frame, with smoothing + hysteresis so the
 * "get back in frame" overlay doesn't flicker on single bad frames.
 */
export class VisibilityMonitor {
  private parts = {} as Record<PartName, PartTimer>;
  private personDetected = false;
  private lastPersonT = -Infinity;

  constructor() {
    this.reset();
  }

  reset() {
    for (const p of PART_NAMES) {
      this.parts[p] = { status: { raw: false, score: 0, visible: false }, belowSince: null, aboveSince: null };
    }
    this.personDetected = false;
  }

  update(f: PoseFrame | null, now: number): VisibilityOutput {
    const cfg = config.visibility;
    if (f) {
      this.personDetected = true;
      this.lastPersonT = now;
    } else if (now - this.lastPersonT > cfg.noPersonAfterMs) {
      this.personDetected = false;
    }

    for (const name of PART_NAMES) {
      const timer = this.parts[name];
      const st = timer.status;
      st.raw = !!f && PART_LANDMARKS[name].every((i) => isVisible(f.lm[i], cfg.minLandmarkVisibility, cfg.frameMargin));
      st.score = cfg.emaAlpha * (st.raw ? 1 : 0) + (1 - cfg.emaAlpha) * st.score;

      if (st.score < cfg.lostBelow) {
        timer.belowSince ??= now;
      } else {
        timer.belowSince = null;
      }
      if (st.score > cfg.recoverAbove) {
        timer.aboveSince ??= now;
      } else {
        timer.aboveSince = null;
      }
      const lostAfter = name === 'leftArm' || name === 'rightArm' ? cfg.armLostAfterMs : cfg.lostAfterMs;
      if (st.visible && timer.belowSince !== null && now - timer.belowSince >= lostAfter) st.visible = false;
      if (!st.visible && timer.aboveSince !== null && now - timer.aboveSince >= cfg.recoverAfterMs) st.visible = true;
    }

    const parts = Object.fromEntries(PART_NAMES.map((n) => [n, { ...this.parts[n].status }])) as Record<PartName, PartStatus>;
    const allVisible = this.personDetected && PART_NAMES.every((n) => parts[n].visible);
    const box = f ? bodyBox(f) : null;
    return { personDetected: this.personDetected, parts, allVisible, box, hint: makeHint(this.personDetected, parts, box) };
  }
}

function bodyBox(f: PoseFrame) {
  // nose, shoulders, elbows, wrists, hips, knees, ankles — MediaPipe estimates these even off-frame
  const idx = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const i of idx) {
    const p = f.lm[i];
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  // nose is not the top of the head
  minY -= (maxY - minY) * 0.06;
  return { minX, maxX, minY, maxY };
}

function makeHint(
  person: boolean,
  parts: Record<PartName, PartStatus>,
  box: VisibilityOutput['box'],
): string | null {
  if (!person) return 'Step in front of the camera';
  const cfg = config.visibility;
  const legsLost = !parts.leftLeg.visible || !parts.rightLeg.visible;
  const headLost = !parts.head.visible;
  const armsLost = !parts.leftArm.visible || !parts.rightArm.visible;
  const h = box ? box.maxY - box.minY : 0;
  if (legsLost && headLost) return 'Step back — you are too close';
  if (legsLost) return 'Step back — your feet are out of view';
  if (headLost) return 'Step back — your head is out of view';
  if (box && armsLost) {
    // box is in camera coords; on the mirrored screen left/right swap
    const centre = 1 - (box.minX + box.maxX) / 2;
    if (centre < 0.4) return 'Move right — an arm is out of view';
    if (centre > 0.6) return 'Move left — an arm is out of view';
    return 'Step back — your arms are out of view';
  }
  if (!parts.torso.visible) return 'Face the camera';
  if (box && h > cfg.maxBodyHeight) return 'Step back a little';
  if (box && h < cfg.minBodyHeight) return 'Come a bit closer';
  return null;
}
