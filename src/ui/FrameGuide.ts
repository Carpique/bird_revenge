import rough from 'roughjs';
import type { VisibilityOutput } from '../gestures/VisibilityMonitor';
import { PART_NAMES, REQUIRED_PARTS, SKELETON, type PartName } from '../pose/landmarks';
import type { PoseFrame } from '../pose/types';
import { scenery } from '../scenery/scenery';
import { HAND_FONT as FONT } from './fonts';
import { t } from './i18n';

export type GuideMode = 'hidden' | 'loading' | 'calibrate' | 'outOfFrame' | 'countdown';

export interface GuideState {
  mode: GuideMode;
  title?: string;
  message?: string;
  /** smaller second line (e.g. "Press Esc to play with the keyboard") */
  hint?: string;
  /** show `message` as an error (red) */
  error?: boolean;
  /** 0..1 calibration hold progress */
  progress?: number;
  /** seconds left in countdown */
  countdown?: number;
  frame: PoseFrame | null;
  vis: VisibilityOutput | null;
}

type P = [number, number];
interface Rect { x: number; y: number; w: number; h: number }

/** Height of the out-of-frame box as a fraction of the screen's; portrait with MINI_ASPECT (width / height). */
const MINI_HEIGHT = 0.3;
const MINI_ASPECT = 0.75;
const MINI_MARGIN = 16;
/** Calibration dialog height as a fraction of the screen's height... */
const DIALOG_HEIGHT = 0.8;
/** ...and its width / height: portrait, like the pose it shows. */
const DIALOG_ASPECT = 0.75;

/**
 * Ideal pose outline, in MIRRORED display coordinates of the camera image (0..1).
 * The player's left side is on the screen's left (like a mirror). Arms lowered, a bit away
 * from the body.
 */
const OUTLINE: Record<PartName, { kind: 'circle'; c: P; r: number } | { kind: 'path' | 'polygon'; pts: P[] }> = {
  head: { kind: 'circle', c: [0.5, 0.2], r: 0.055 },
  torso: { kind: 'polygon', pts: [[0.455, 0.3], [0.545, 0.3], [0.535, 0.56], [0.465, 0.56]] },
  leftArm: { kind: 'path', pts: [[0.455, 0.3], [0.425, 0.43], [0.4, 0.55]] },
  rightArm: { kind: 'path', pts: [[0.545, 0.3], [0.575, 0.43], [0.6, 0.55]] },
  leftLeg: { kind: 'path', pts: [[0.47, 0.56], [0.455, 0.73], [0.44, 0.9]] },
  rightLeg: { kind: 'path', pts: [[0.53, 0.56], [0.545, 0.73], [0.56, 0.9]] },
};

const GREEN = '#2f9e44';
const RED = '#e03131';
const INK = '#2b2b2b';
const MUTED = '#9aa5a8';

/**
 * Full-screen 2D-canvas overlay: loading screen, the "stand in the outline" calibration dialog,
 * the small "get back in frame" box in the lower right corner and the resume countdown.
 * The dialog and the corner box share the same schematic: game-sky background, target outline and
 * the player's live skeleton (no camera image).
 */
export class FrameGuide {
  private ctx: CanvasRenderingContext2D;
  private rc: ReturnType<typeof rough.canvas>;

  constructor(
    private canvas: HTMLCanvasElement,
    private video: HTMLVideoElement,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.rc = rough.canvas(canvas);
  }

  draw(s: GuideState, now: number) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = window.innerWidth, H = window.innerHeight;
    if (this.canvas.width !== Math.round(W * dpr) || this.canvas.height !== Math.round(H * dpr)) {
      this.canvas.width = Math.round(W * dpr);
      this.canvas.height = Math.round(H * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (s.mode === 'hidden') return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    switch (s.mode) {
      case 'loading':
        ctx.fillStyle = scenery.skyColor;
        ctx.fillRect(0, 0, W, H);
        this.text(s.message ?? t('Loading…'), W / 2, H / 2, 34, INK);
        break;
      case 'countdown':
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.fillRect(0, 0, W, H);
        this.text(String(Math.max(1, Math.ceil(s.countdown ?? 0))), W / 2, H / 2, 180, INK);
        this.text(t('Get ready to flap!'), W / 2, H / 2 + 120, 34, INK);
        break;
      case 'calibrate':
        this.drawCalibrateDialog(s, W, H, now);
        break;
      case 'outOfFrame':
        this.drawOutOfFrameBox(s, W, H, now);
        break;
    }
  }

  /**
   * Rectangle with the camera image's proportions, centred in `r`: fitted inside it, or with `cover`
   * filling it (overflowing on one axis; the caller clips to `r`).
   */
  private fitCamera(r: Rect, cover = false): Rect {
    const vw = this.video.videoWidth || 1280, vh = this.video.videoHeight || 720;
    const scale = (cover ? Math.max : Math.min)(r.w / vw, r.h / vh);
    const w = vw * scale, h = vh * scale;
    return { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h };
  }

  /**
   * "Stand in the outline" dialog, centred over the (paused) game: title, schematic, hint and the
   * hold-still progress bar. Also shows camera/model loading and camera errors. Portrait: the
   * schematic shows only the middle strip of the (landscape) camera view, where the player stands.
   */
  private drawCalibrateDialog(s: GuideState, W: number, H: number, now: number) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(0, 0, W, H);

    const h = Math.max(360, H * DIALOG_HEIGHT), w = Math.min(W * 0.9, h * DIALOG_ASPECT);
    const box: Rect = { x: (W - w) / 2, y: (H - h) / 2, w, h };
    this.drawPanel(box);

    const titleSize = Math.max(22, w * 0.08);
    const textSize = Math.max(15, w * 0.05);
    const pad = textSize * 0.8;
    const barH = Math.max(8, h * 0.025);
    const cx = box.x + w / 2;
    this.text(s.title ?? t('Stand in the outline'), cx, box.y + pad + titleSize / 2, titleSize, INK, w - 2 * pad);

    const poseTop = box.y + pad * 1.5 + titleSize;
    const footer = textSize * 1.5 + (s.hint ? textSize * 1.3 : 0) + barH + pad * 1.5;
    const poseArea: Rect = { x: box.x + pad, y: poseTop, w: w - 2 * pad, h: box.y + h - footer - poseTop };
    const cam = this.fitCamera(poseArea, true);
    ctx.save();
    ctx.beginPath();
    ctx.rect(poseArea.x, poseArea.y, poseArea.w, poseArea.h);
    ctx.clip();
    this.drawPose(s, cam, now, h);
    ctx.restore();

    let y = cam.y + cam.h + pad * 0.4 + textSize * 0.7;
    this.text(s.message ?? '', cx, y, textSize, s.error ? RED : INK, w - 2 * pad);
    if (s.hint) {
      y += textSize * 1.3;
      this.text(s.hint, cx, y, textSize * 0.85, '#555', w - 2 * pad);
    }

    const bw = w * 0.6, bx = cx - bw / 2, by = box.y + h - pad - barH;
    if (s.progress) {
      ctx.fillStyle = GREEN;
      ctx.fillRect(bx, by, bw * s.progress, barH);
    }
    this.rc.rectangle(bx, by, bw, barH, { stroke: s.progress ? INK : MUTED, strokeWidth: 2, roughness: 0.8, seed: 3 });
  }

  /**
   * Unobtrusive "get back in frame" box in the lower right corner with a blinking frame. Portrait,
   * like the calibration dialog: shows the middle strip of the camera view; the hint wraps.
   */
  private drawOutOfFrameBox(s: GuideState, W: number, H: number, now: number) {
    const h = H * MINI_HEIGHT;
    const box: Rect = { w: h * MINI_ASPECT, h, x: 0, y: 0 };
    box.x = W - box.w - MINI_MARGIN;
    box.y = H - box.h - MINI_MARGIN;
    const blinkOn = Math.floor(now / 400) % 2 === 0;
    this.drawPanel(box, blinkOn ? RED : INK, blinkOn ? 4 : 2);

    const textSize = Math.max(11, box.w * 0.085);
    const pad = textSize * 0.6;
    const ctx = this.ctx;
    ctx.font = `${textSize}px ${FONT}`;
    const lines = this.wrap(s.message ?? t('Get back in frame!'), box.w - 2 * pad);
    const lineH = textSize * 1.15;
    const textTop = box.y + box.h - pad - lines.length * lineH;

    const poseArea: Rect = { x: box.x + pad, y: box.y + pad, w: box.w - 2 * pad, h: textTop - pad * 0.5 - (box.y + pad) };
    ctx.save();
    ctx.beginPath();
    ctx.rect(poseArea.x, poseArea.y, poseArea.w, poseArea.h);
    ctx.clip();
    this.drawPose(s, this.fitCamera(poseArea, true), now, box.h);
    ctx.restore();

    lines.forEach((line, i) => this.text(line, box.x + box.w / 2, textTop + (i + 0.5) * lineH, textSize, INK, box.w - 2 * pad));
  }

  /** Greedy word wrap using the current ctx.font. */
  private wrap(text: string, maxWidth: number): string[] {
    const lines: string[] = [];
    let line = '';
    for (const word of text.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (line && this.ctx.measureText(next).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  /** Box with the game's sky colour and a sketchy border. */
  private drawPanel(box: Rect, border = INK, borderWidth = 3) {
    this.ctx.fillStyle = scenery.skyColor;
    this.ctx.fillRect(box.x, box.y, box.w, box.h);
    this.rc.rectangle(box.x, box.y, box.w, box.h, { stroke: border, strokeWidth: borderWidth, roughness: 1.2, seed: 11 });
  }

  /**
   * Target outline (each part green when visible; a lost required part blinks red, a lost optional
   * part such as the legs is grey) plus the player's live
   * skeleton, both mapped into the camera rectangle `cam` (mirrored). Line widths follow `boxH`,
   * the height of the box it is drawn in. Without visibility data (still loading) the outline is grey.
   */
  private drawPose(s: GuideState, cam: Rect, now: number, boxH: number) {
    const ctx = this.ctx;
    const outlineWidth = Math.min(7, Math.max(2, boxH * 0.022));
    const skeletonWidth = Math.min(3, Math.max(1.5, boxH * 0.006));
    // display coords (already mirrored) -> screen
    const toScreen = ([x, y]: P): P => [cam.x + x * cam.w, cam.y + y * cam.h];

    const blinkOn = Math.floor(now / 350) % 2 === 0;
    PART_NAMES.forEach((name, i) => {
      const ok = s.vis?.parts[name].visible ?? false;
      const required = REQUIRED_PARTS.includes(name);
      const color = !s.vis ? MUTED : ok ? GREEN : required ? RED : MUTED;
      if (s.vis && !ok && required && !blinkOn) return;
      const o = { stroke: color, strokeWidth: outlineWidth, roughness: 1.6, bowing: 1.5, seed: 40 + i };
      const shape = OUTLINE[name];
      if (shape.kind === 'circle') {
        const [cx, cy] = toScreen(shape.c);
        this.rc.circle(cx, cy, shape.r * 2 * cam.h, o);
      } else if (shape.kind === 'polygon') {
        this.rc.polygon(shape.pts.map(toScreen), o);
      } else {
        this.rc.linearPath(shape.pts.map(toScreen), o);
      }
    });

    if (s.frame) {
      const lm = s.frame.lm;
      ctx.lineWidth = skeletonWidth;
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(43,43,43,0.75)';
      ctx.beginPath();
      for (const [a, b] of SKELETON) {
        const [x1, y1] = toScreen([1 - lm[a].x, lm[a].y]);
        const [x2, y2] = toScreen([1 - lm[b].x, lm[b].y]);
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
      }
      ctx.stroke();
    }
  }

  private text(t: string, x: number, y: number, size: number, color: string, maxWidth?: number) {
    const ctx = this.ctx;
    ctx.font = `${size}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(3, size / 9);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.strokeText(t, x, y, maxWidth);
    ctx.fillStyle = color;
    ctx.fillText(t, x, y, maxWidth);
  }
}
