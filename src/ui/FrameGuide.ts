import rough from 'roughjs';
import type { VisibilityOutput } from '../gestures/VisibilityMonitor';
import { PART_NAMES, SKELETON, type PartName } from '../pose/landmarks';
import type { PoseFrame } from '../pose/types';
import { scenery } from '../scenery/scenery';

export type GuideMode = 'hidden' | 'loading' | 'error' | 'calibrate' | 'outOfFrame' | 'countdown';

export interface GuideState {
  mode: GuideMode;
  title?: string;
  message?: string;
  /** 0..1 calibration hold progress */
  progress?: number;
  /** seconds left in countdown */
  countdown?: number;
  frame: PoseFrame | null;
  vis: VisibilityOutput | null;
}

type P = [number, number];
interface Rect { x: number; y: number; w: number; h: number }

/** Width and height of the out-of-frame box as a fraction of the screen's (same proportions). */
const MINI_SCALE = 1 / 6;
const MINI_MARGIN = 16;

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
const PAPER = '#f4f1e8';
const FONT = '"Patrick Hand", "Comic Sans MS", cursive';

/**
 * Full-screen 2D-canvas overlay: loading/error screens, the "stand in the outline" calibration
 * screen, the small "get back in frame" box in the lower right corner and the resume countdown.
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
      case 'error':
        ctx.fillStyle = PAPER;
        ctx.fillRect(0, 0, W, H);
        this.text('Pooping Birds', W / 2, H * 0.38, 72, INK);
        this.text(s.message ?? '', W / 2, H * 0.52, 30, s.mode === 'error' ? RED : INK);
        if (s.mode === 'error') this.text('Press K to play with the keyboard', W / 2, H * 0.6, 26, '#555');
        break;
      case 'countdown':
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.fillRect(0, 0, W, H);
        this.text(String(Math.max(1, Math.ceil(s.countdown ?? 0))), W / 2, H / 2, 180, INK);
        this.text('Get ready to flap!', W / 2, H / 2 + 120, 34, INK);
        break;
      case 'calibrate':
        this.drawCalibrateScreen(s, W, H, now);
        break;
      case 'outOfFrame':
        this.drawOutOfFrameBox(s, W, H, now);
        break;
    }
  }

  /** Rectangle with the camera image's proportions, fitted (never cropped) and centred in `r`. */
  private fitCamera(r: Rect): Rect {
    const vw = this.video.videoWidth || 1280, vh = this.video.videoHeight || 720;
    const scale = Math.min(r.w / vw, r.h / vh);
    const w = vw * scale, h = vh * scale;
    return { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h };
  }

  private drawCalibrateScreen(s: GuideState, W: number, H: number, now: number) {
    const ctx = this.ctx;
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, W, H);

    // camera image, mirrored, fitted inside the screen (never cropped: edges matter here)
    const top = 90, bottom = 110;
    const cam = this.fitCamera({ x: 20, y: top, w: W - 40, h: H - top - bottom });
    if (this.video.readyState >= 2) {
      ctx.save();
      ctx.translate(cam.x + cam.w, cam.y);
      ctx.scale(-1, 1);
      ctx.drawImage(this.video, 0, 0, cam.w, cam.h);
      ctx.restore();
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillRect(cam.x, cam.y, cam.w, cam.h);
    }
    this.rc.rectangle(cam.x, cam.y, cam.w, cam.h, { stroke: INK, strokeWidth: 3, roughness: 1, seed: 7 });
    this.drawPose(s, cam, now, 7, 3);

    this.text(s.title ?? 'Stand in the outline', W / 2, 48, 52, INK);
    this.text(s.message ?? '', W / 2, H - 62, 32, INK);

    if (s.progress !== undefined && s.progress > 0) {
      const bw = Math.min(400, W * 0.6), bx = (W - bw) / 2, by = H - 34;
      ctx.fillStyle = GREEN;
      ctx.fillRect(bx, by, bw * s.progress, 14);
      this.rc.rectangle(bx, by, bw, 14, { stroke: INK, strokeWidth: 2, roughness: 0.8, seed: 3 });
    }
  }

  /**
   * Unobtrusive "get back in frame" box in the lower right corner: game-sky background, a blinking
   * frame, the target outline and the player's skeleton (no camera image).
   */
  private drawOutOfFrameBox(s: GuideState, W: number, H: number, now: number) {
    const ctx = this.ctx;
    const box: Rect = { w: W * MINI_SCALE, h: H * MINI_SCALE, x: 0, y: 0 };
    box.x = W - box.w - MINI_MARGIN;
    box.y = H - box.h - MINI_MARGIN;

    ctx.fillStyle = scenery.skyColor;
    ctx.fillRect(box.x, box.y, box.w, box.h);

    const textSize = Math.max(11, box.h * 0.1);
    const pad = textSize * 0.6;
    const cam = this.fitCamera({ x: box.x + pad, y: box.y + pad, w: box.w - 2 * pad, h: box.h - 2 * pad - textSize * 1.4 });
    this.drawPose(s, cam, now, Math.max(2, box.h * 0.022), 1.5);

    this.text(s.message ?? 'Get back in frame!', box.x + box.w / 2, box.y + box.h - pad - textSize * 0.5, textSize, INK, box.w - 2 * pad);

    if (Math.floor(now / 400) % 2 === 0) {
      this.rc.rectangle(box.x, box.y, box.w, box.h, { stroke: RED, strokeWidth: 4, roughness: 1.2, seed: 11 });
    } else {
      this.rc.rectangle(box.x, box.y, box.w, box.h, { stroke: INK, strokeWidth: 2, roughness: 1.2, seed: 11 });
    }
  }

  /**
   * Target outline (each part green when visible, blinking red when lost) plus the player's live
   * skeleton, both mapped into the camera rectangle `cam` (mirrored).
   */
  private drawPose(s: GuideState, cam: Rect, now: number, outlineWidth: number, skeletonWidth: number) {
    const ctx = this.ctx;
    // display coords (already mirrored) -> screen
    const toScreen = ([x, y]: P): P => [cam.x + x * cam.w, cam.y + y * cam.h];

    const blinkOn = Math.floor(now / 350) % 2 === 0;
    PART_NAMES.forEach((name, i) => {
      const ok = s.vis?.parts[name].visible ?? false;
      const color = ok ? GREEN : RED;
      if (!ok && !blinkOn) return;
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
