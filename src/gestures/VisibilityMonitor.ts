import { config } from '../config';
import { L, PART_LANDMARKS, PART_NAMES, REQUIRED_PARTS, type PartName } from '../pose/landmarks';
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
  /** all REQUIRED_PARTS visible: enough of the player in view to play */
  inFrame: boolean;
  /** upper-body bounding box in normalised image coords (not mirrored), if a person is detected */
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
 * Decides whether enough of the player is in frame (REQUIRED_PARTS), with smoothing + hysteresis so the
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
    const inFrame = this.personDetected && REQUIRED_PARTS.every((n) => parts[n].visible);
    const box = f ? upperBodyBox(f) : null;
    return { personDetected: this.personDetected, parts, inFrame, box, hint: makeHint(this.personDetected, parts, box, f) };
  }
}

function upperBodyBox(f: PoseFrame) {
  // nose, shoulders, elbows, wrists, hips — MediaPipe estimates these even off-frame
  const idx = [0, 11, 12, 13, 14, 15, 16, 23, 24];
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
  f: PoseFrame | null,
): string | null {
  if (!person) return 'Step in front of the camera';
  const cfg = config.visibility;
  const armsLost = !parts.leftArm.visible || !parts.rightArm.visible;
  const h = box ? box.maxY - box.minY : 0;
  // hips below the frame edge: too close (or camera too high)
  const hipsBelow = !!f && Math.max(f.lm[L.leftHip].y, f.lm[L.rightHip].y) > 1 - cfg.frameMargin;
  if (!parts.torso.visible && hipsBelow) return 'Step back — your hips are out of view';
  if (box && armsLost) {
    // box is in camera coords; on the mirrored screen left/right swap
    const centre = 1 - (box.minX + box.maxX) / 2;
    if (centre < 0.4) return 'Move right — an arm is out of view';
    if (centre > 0.6) return 'Move left — an arm is out of view';
    return 'Step back — your arms are out of view';
  }
  if (!parts.torso.visible) return 'Face the camera';
  if (box && h < cfg.minUpperBodyHeight) return 'Come a bit closer';
  return null;
}
