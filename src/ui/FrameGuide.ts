import type { Container } from 'pixi.js';
import rough from 'roughjs';
import type { VisibilityOutput } from '../gestures/VisibilityMonitor';
import { PART_NAMES, REQUIRED_PARTS, SKELETON, type PartName } from '../pose/landmarks';
import type { PoseFrame } from '../pose/types';
import { scenery } from '../scenery/scenery';
import { WORLD } from '../config';
import { BIG_FILL, BIG_OUTLINE, bigTextStyle, GLOW, INK, TEXT_FONT as FONT } from './fonts';
import { GlowText } from './GlowText';
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

const GREEN = '#1e7a32';
/** the big text's outline red */
const RED = BIG_OUTLINE;
const MUTED = '#9aa5a8';

/**
 * The look of both pose panels, the calibration dialog and the small in-game box: sizes in world px,
 * scaled with the panel (the dialog: like the game; the small box: `MINI_SCALE` of that).
 */
const PANEL = {
  /** a brighter take on the bird's blue */
  background: '#a9d6f2',
  /** like the selected level thumbnail: the big text's colours, yellow inside red */
  border: { width: 5, color: BIG_FILL, outerWidth: 12, outerColor: BIG_OUTLINE, radius: 18 },
  padding: 22,
  /** the messages under the pose: the instructions page's font, size, line height and glow */
  text: { size: 28, lineHeight: 32, color: INK, errorColor: RED },
  /** the smaller second line, relative to `text` */
  hintScale: 0.8,
  /** the target outline and the player's skeleton */
  pose: { outlineWidth: 7, skeletonWidth: 3, skeletonColor: 'rgba(43,43,43,0.75)', belly: BIG_FILL },
  /** the hold-still progress bar: height, and width as a fraction of the panel's */
  bar: { height: 12, width: 0.6, border: 3, color: GREEN, borderColor: INK, emptyColor: MUTED },
};

/** Calibration dialog height, title included, as a fraction of the screen's height... */
const DIALOG_HEIGHT = 0.88;
/** ...and its width / height: portrait, like the pose it shows. */
const DIALOG_ASPECT = 0.75;
/** world px: the title's size (the level select's) and the space under it */
const DIALOG_TITLE = 110;
const TITLE_GAP = 24;

/** The small in-game box, in world px (scaled like the game): height, width / height and margin; its contents at `MINI_SCALE` of the dialog's. */
const MINI_HEIGHT = 216;
const MINI_ASPECT = 0.75;
const MINI_MARGIN = 16;
const MINI_SCALE = 0.5;

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

/**
 * Full-screen 2D-canvas overlay: loading screen, the "get in position" calibration dialog,
 * the small "get back in frame" box in the lower right corner and the resume countdown.
 * The dialog and the corner box are the same panel (`PANEL`, `drawPanel`), in two sizes: target outline,
 * the player's live skeleton (no camera image) and messages.
 */
export class FrameGuide {
  private ctx: CanvasRenderingContext2D;
  private rc: ReturnType<typeof rough.canvas>;
  /** the dialog's title: one of the game's big titles, drawn by PixiJS (under this canvas, beside the panel) */
  private title = new GlowText('', bigTextStyle(DIALOG_TITLE));

  /** `stage`: the game's (unscaled), for the dialog's title, on top of everything else there */
  constructor(
    private canvas: HTMLCanvasElement,
    private video: HTMLVideoElement,
    private stage: Container,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.rc = rough.canvas(canvas);
    this.title.visible = false;
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
    this.title.visible = false;
    if (s.mode === 'hidden') return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    switch (s.mode) {
      case 'loading':
        ctx.fillStyle = scenery.skyColor;
        ctx.fillRect(0, 0, W, H);
        this.text(s.message ?? t('Loading…'), W / 2, H / 2, 34, INK);
        break;
      case 'countdown':
        // over the game, dimmed (like behind the calibration dialog)
        this.text(String(Math.max(1, Math.ceil(s.countdown ?? 0))), W / 2, H / 2, 180, INK, undefined, 180);
        this.text(t('Get ready to flap!'), W / 2, H / 2 + 120, 34, INK, undefined, 34);
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
   * "Get in position" dialog, centred over the (paused, dimmed) game, styled like the level select: the
   * big title above the panel. Also shows camera/model loading and camera errors.
   */
  private drawCalibrateDialog(s: GuideState, W: number, H: number, now: number) {
    // world px -> screen px, as the game is scaled
    const k = Math.min(W / WORLD.width, H / WORLD.height);

    // the title above the panel, the two centred together; scaled like the game, a long one (a camera error) shrinks to fit
    const title = this.title;
    title.text = s.title ?? t('Get in position');
    title.scale.set(1);
    title.scale.set(k * Math.min(1, (W * 0.95) / (k * title.width)));
    const titleH = title.textHeight * title.scale.y;
    const gap = TITLE_GAP * k;
    const total = Math.max(360 + titleH + gap, H * DIALOG_HEIGHT);
    const h = total - titleH - gap, w = Math.min(W * 0.9, h * DIALOG_ASPECT);
    const top = (H - total) / 2;
    title.position.set(W / 2, top + titleH / 2);
    if (this.stage.children.at(-1) !== title) this.stage.addChild(title); // on top
    title.visible = true;

    const box: Rect = { x: (W - w) / 2, y: top + titleH + gap, w, h };
    this.drawPanel(box, 1, s, now, { message: s.message ?? '', hint: s.hint, error: s.error, progress: s.progress ?? 0 });
  }

  /** The small "get back in frame" box in the lower right corner during the game: the dialog's panel, smaller. */
  private drawOutOfFrameBox(s: GuideState, W: number, H: number, now: number) {
    const k = Math.min(W / WORLD.width, H / WORLD.height);
    const h = MINI_HEIGHT * k, w = h * MINI_ASPECT, margin = MINI_MARGIN * k;
    const box: Rect = { x: W - w - margin, y: H - h - margin, w, h };
    this.drawPanel(box, MINI_SCALE, s, now, { message: s.message ?? t('Get back in frame!') });
  }

  /**
   * A pose panel (`PANEL`) filling `box`, its sizes scaled like the game and then by `scale`: the schematic, the messages (wrapped)
   * and, with `progress` (0..1), the hold-still bar. Portrait: the schematic shows only the middle
   * strip of the (landscape) camera view, where the player stands.
   */
  private drawPanel(
    box: Rect,
    scale: number,
    s: GuideState,
    now: number,
    c: { message: string; hint?: string; error?: boolean; progress?: number },
  ) {
    const ctx = this.ctx;
    const { border, text, bar } = PANEL;
    // world px -> screen px
    const k = Math.min(window.innerWidth / WORLD.width, window.innerHeight / WORLD.height) * scale;
    ctx.beginPath();
    ctx.roundRect(box.x, box.y, box.w, box.h, border.radius * k);
    ctx.fillStyle = PANEL.background;
    ctx.fill();
    ctx.lineWidth = border.outerWidth * k;
    ctx.strokeStyle = border.outerColor;
    ctx.stroke();
    ctx.lineWidth = border.width * k;
    ctx.strokeStyle = border.color;
    ctx.stroke();

    const pad = PANEL.padding * k;
    const inner = box.w - 2 * pad;
    const cx = box.x + box.w / 2;
    // the sizes before the game's scaling set the glow, which isn't scaled (see `halo`)
    const textWorld = text.size * scale, hintWorld = textWorld * PANEL.hintScale;
    const textSize = text.size * k, hintSize = textSize * PANEL.hintScale;
    const lineH = text.lineHeight * k, hintH = lineH * PANEL.hintScale;
    ctx.font = `${textSize}px ${FONT}`;
    const lines = this.wrap(c.message, inner);
    ctx.font = `${hintSize}px ${FONT}`;
    const hintLines = c.hint ? this.wrap(c.hint, inner) : [];
    const barH = c.progress !== undefined ? bar.height * k : 0;

    const footer = lines.length * lineH + hintLines.length * hintH + (barH ? barH + pad * 0.6 : 0) + pad * 1.3;
    const poseArea: Rect = { x: box.x + pad, y: box.y + pad, w: inner, h: box.h - footer - pad };
    ctx.save();
    ctx.beginPath();
    ctx.rect(poseArea.x, poseArea.y, poseArea.w, poseArea.h);
    ctx.clip();
    this.drawPose(s, this.fitCamera(poseArea, true), now, k);
    ctx.restore();

    let y = poseArea.y + poseArea.h + pad * 0.3 + lineH / 2;
    for (const line of lines) {
      this.text(line, cx, y, textSize, c.error ? text.errorColor : text.color, inner, textWorld, false);
      y += lineH;
    }
    y += (hintH - lineH) / 2;
    for (const line of hintLines) {
      this.text(line, cx, y, hintSize, text.color, inner, hintWorld, false);
      y += hintH;
    }

    if (!barH) return;
    const bw = box.w * bar.width, bx = cx - bw / 2, by = box.y + box.h - pad - barH;
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, barH, barH / 2);
    if (c.progress) {
      ctx.save();
      ctx.clip();
      ctx.fillStyle = bar.color;
      ctx.fillRect(bx, by, bw * c.progress, barH);
      ctx.restore();
    }
    ctx.lineWidth = Math.max(1, bar.border * k);
    ctx.strokeStyle = c.progress ? bar.borderColor : bar.emptyColor;
    ctx.stroke();
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

  /**
   * Target outline with a yellow belly (each part green when visible; a lost required part blinks red, a lost optional
   * part such as the lower legs is grey; the thighs follow the torso, which includes the hips) plus the player's live
   * skeleton, both mapped into the camera rectangle `cam` (mirrored). Line widths: `PANEL.pose`'s, scaled
   * by `k`. Without visibility data (still loading) the outline is grey.
   */
  private drawPose(s: GuideState, cam: Rect, now: number, k: number) {
    const ctx = this.ctx;
    const { pose } = PANEL;
    const outlineWidth = Math.max(1.5, pose.outlineWidth * k);
    const skeletonWidth = Math.max(1, pose.skeletonWidth * k);
    // display coords (already mirrored) -> screen
    const toScreen = ([x, y]: P): P => [cam.x + x * cam.w, cam.y + y * cam.h];

    const blinkOn = Math.floor(now / 350) % 2 === 0;
    /** the outline colour showing `name`'s visibility; null: blinked off */
    const colorOf = (name: PartName): string | null => {
      const ok = s.vis?.parts[name].visible ?? false;
      const required = REQUIRED_PARTS.includes(name);
      if (s.vis && !ok && required && !blinkOn) return null;
      return !s.vis ? MUTED : ok ? GREEN : required ? RED : MUTED;
    };
    // the belly filled yellow, like the big text's letters; it stays while the outline blinks
    const torso = OUTLINE.torso;
    if (torso.kind === 'polygon') {
      const seed = 40 + PART_NAMES.indexOf('torso');
      this.rc.polygon(torso.pts.map(toScreen), { stroke: 'none', fill: pose.belly, fillStyle: 'solid', roughness: 1.6, bowing: 1.5, seed });
    }
    PART_NAMES.forEach((name, i) => {
      const shape = OUTLINE[name];
      const style = (color: string) => ({ stroke: color, strokeWidth: outlineWidth, roughness: 1.6, bowing: 1.5, seed: 40 + i });
      if (shape.kind === 'path' && (name === 'leftLeg' || name === 'rightLeg')) {
        // the thighs show the hips, which must be in view (they count with the torso); the rest of the leg is optional
        const [hip, knee, ankle] = shape.pts.map(toScreen);
        const thigh = colorOf('torso'), shin = colorOf(name);
        if (thigh) this.rc.line(...hip, ...knee, style(thigh));
        if (shin) this.rc.line(...knee, ...ankle, style(shin));
        return;
      }
      const color = colorOf(name);
      if (!color) return;
      const o = style(color);
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
      ctx.strokeStyle = pose.skeletonColor;
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

  /**
   * `glow`: a soft light halo around it, like the big signs over the dimmed game (see `halo`); `outline`: a thin
   * white outline (without a halo, so it reads on the sky)
   */
  private text(t: string, x: number, y: number, size: number, color: string, maxWidth?: number, glow?: number, outline = true) {
    const ctx = this.ctx;
    ctx.font = `${size}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (glow) this.halo(t, x, y, size, glow, maxWidth);
    if (outline) {
      ctx.lineWidth = Math.max(3, size / 9);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.strokeText(t, x, y, maxWidth);
    }
    ctx.fillStyle = color;
    ctx.fillText(t, x, y, maxWidth);
  }

  /**
   * Soft light halo behind text, in the current font and alignment: exactly `GlowText`'s. `glowSize`: the
   * font size `GlowText` would be given (before the world's scaling), which sets its blur: PixiJS's
   * `BlurFilter` blurs by about 1.29 x its strength in device px, unscaled, as does a canvas filter.
   */
  private halo(t: string, x: number, y: number, size: number, glowSize: number, maxWidth?: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.filter = `blur(${(1.29 * glowSize) / 9}px)`;
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = ctx.strokeStyle = GLOW;
    ctx.lineJoin = 'round';
    ctx.lineWidth = size / 5;
    ctx.strokeText(t, x, y, maxWidth);
    ctx.fillText(t, x, y, maxWidth);
    ctx.restore();
  }
}
