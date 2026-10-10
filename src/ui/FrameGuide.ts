import rough from 'roughjs';
import type { VisibilityOutput } from '../gestures/VisibilityMonitor';
import { PART_NAMES, SKELETON, type PartName } from '../pose/landmarks';
import type { PoseFrame } from '../pose/types';

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

/**
 * Ideal pose outline, in MIRRORED display coordinates of the camera image (0..1).
 * The player's left side is on the screen's left (like a mirror). Arms raised in a "Y"
 * so we know there is headroom for flapping.
 */
const OUTLINE: Record<PartName, { kind: 'circle'; c: P; r: number } | { kind: 'path' | 'polygon'; pts: P[] }> = {
  head: { kind: 'circle', c: [0.5, 0.2], r: 0.055 },
  torso: { kind: 'polygon', pts: [[0.455, 0.3], [0.545, 0.3], [0.535, 0.56], [0.465, 0.56]] },
  leftArm: { kind: 'path', pts: [[0.455, 0.3], [0.395, 0.21], [0.345, 0.11]] },
  rightArm: { kind: 'path', pts: [[0.545, 0.3], [0.605, 0.21], [0.655, 0.11]] },
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
 * screen, the "get back in frame" screen and the resume countdown.
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
      case 'outOfFrame':
        this.drawCameraScreen(s, W, H, now);
        break;
    }
  }

  private drawCameraScreen(s: GuideState, W: number, H: number, now: number) {
    const ctx = this.ctx;
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, W, H);

    // camera image, mirrored, fitted inside the screen (never cropped: edges matter here)
    const vw = this.video.videoWidth || 1280, vh = this.video.videoHeight || 720;
    const top = 90, bottom = 110;
    const scale = Math.min((W - 40) / vw, (H - top - bottom) / vh);
    const dw = vw * scale, dh = vh * scale;
    const ox = (W - dw) / 2, oy = top + (H - top - bottom - dh) / 2;
    if (this.video.readyState >= 2) {
      ctx.save();
      ctx.translate(ox + dw, oy);
      ctx.scale(-1, 1);
      ctx.drawImage(this.video, 0, 0, dw, dh);
      ctx.restore();
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillRect(ox, oy, dw, dh);
    }
    this.rc.rectangle(ox, oy, dw, dh, { stroke: INK, strokeWidth: 3, roughness: 1, seed: 7 });

    // display coords (already mirrored) -> screen
    const toScreen = ([x, y]: P): P => [ox + x * dw, oy + y * dh];

    // target outline, each part green (visible) or blinking red (missing)
    const blinkOn = Math.floor(now / 350) % 2 === 0;
    PART_NAMES.forEach((name, i) => {
      const ok = s.vis?.parts[name].visible ?? false;
      const color = ok ? GREEN : RED;
      if (!ok && !blinkOn) return;
      const o = { stroke: color, strokeWidth: 7, roughness: 1.6, bowing: 1.5, seed: 40 + i };
      const shape = OUTLINE[name];
      if (shape.kind === 'circle') {
        const [cx, cy] = toScreen(shape.c);
        this.rc.circle(cx, cy, shape.r * 2 * dh, o);
      } else if (shape.kind === 'polygon') {
        this.rc.polygon(shape.pts.map(toScreen), o);
      } else {
        this.rc.linearPath(shape.pts.map(toScreen), o);
      }
    });

    // the player's live skeleton (mirrored)
    if (s.frame) {
      const lm = s.frame.lm;
      ctx.lineWidth = 3;
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

    const title = s.title ?? (s.mode === 'calibrate' ? 'Stand in the outline' : 'Get back in frame!');
    this.text(title, W / 2, 48, 52, s.mode === 'outOfFrame' ? RED : INK);
    this.text(s.message ?? '', W / 2, H - 62, 32, INK);

    if (s.mode === 'calibrate' && s.progress !== undefined && s.progress > 0) {
      const bw = Math.min(400, W * 0.6), bx = (W - bw) / 2, by = H - 34;
      ctx.fillStyle = GREEN;
      ctx.fillRect(bx, by, bw * s.progress, 14);
      this.rc.rectangle(bx, by, bw, 14, { stroke: INK, strokeWidth: 2, roughness: 0.8, seed: 3 });
    }
  }

  private text(t: string, x: number, y: number, size: number, color: string) {
    const ctx = this.ctx;
    ctx.font = `${size}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(3, size / 9);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.strokeText(t, x, y);
    ctx.fillStyle = color;
    ctx.fillText(t, x, y);
  }
}
