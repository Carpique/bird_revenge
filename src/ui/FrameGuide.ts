import type { Container } from 'pixi.js';
import rough from 'roughjs';
import type { VisibilityOutput } from '../gestures/VisibilityMonitor';
import { L, PART_NAMES, REQUIRED_PARTS, type PartName } from '../pose/landmarks';
import type { PoseFrame } from '../pose/types';
import { worldFit } from '../render/fitWorld';
import { scenery } from '../scenery/scenery';
import { WORLD } from '../config';
import { BIG_FILL, BIG_OUTLINE, bigTextStyle, GLOW, INK, TEXT_FONT as FONT } from './fonts';
import { GlowText } from './GlowText';
import { t } from './i18n';

export type GuideMode = 'hidden' | 'loading' | 'calibrate' | 'outOfFrame' | 'countdown' | 'demo';

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
  /** the camera image's width / height, when `frame` isn't from the live camera (a recording) */
  aspect?: number;
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
  /** the target outline, and the player's figure over it (drawn like the demo's, see `posedFigure`, in one colour and see-through) */
  pose: { outlineWidth: 7, skeletonWidth: 7, skeletonColor: '#2b2b2b', skeletonAlpha: 0.5, belly: BIG_FILL },
  /** the hold-still progress bar: height, and width as a fraction of the panel's */
  bar: { height: 12, width: 0.6, border: 3, color: GREEN, borderColor: INK, emptyColor: MUTED },
  /**
   * the instructions' demonstration panel, playing a recorded pose in the left half of the screen, no text: its height
   * as a fraction of the sky's (the screen's top to the ground), centred in it, so it hovers as far above the ground as
   * it is below the top. The calibration's target figure moves with the pose, instead of a skeleton over it.
   */
  demo: { height: 0.85 },
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
type Figure = Record<PartName, { kind: 'circle'; c: P; r: number } | { kind: 'path' | 'polygon'; pts: P[] }>;
const OUTLINE: Figure = {
  head: { kind: 'circle', c: [0.5, 0.2], r: 0.055 },
  torso: { kind: 'polygon', pts: [[0.455, 0.3], [0.545, 0.3], [0.535, 0.56], [0.465, 0.56]] },
  leftArm: { kind: 'path', pts: [[0.455, 0.3], [0.425, 0.43], [0.4, 0.55]] },
  rightArm: { kind: 'path', pts: [[0.545, 0.3], [0.575, 0.43], [0.6, 0.55]] },
  leftLeg: { kind: 'path', pts: [[0.47, 0.56], [0.455, 0.73], [0.44, 0.9]] },
  rightLeg: { kind: 'path', pts: [[0.53, 0.56], [0.545, 0.73], [0.56, 0.9]] },
};

/** the head's radius in `OUTLINE`, relative to its torso's length (shoulders to hips) */
const HEAD_PER_TORSO = 0.055 / 0.26;

/**
 * `OUTLINE`'s figure in the pose of `f`: the torso between the shoulders and hips, the limbs along the arms and legs,
 * the head round the face, as big for the body as the outline's. `cam`: the camera rectangle it's drawn in, for the
 * head's size (its radius is in camera heights, the points in mirrored display coordinates).
 */
function posedFigure(f: PoseFrame, cam: Rect): Figure {
  const p = (i: number): P => [1 - f.lm[i].x, f.lm[i].y];
  const mid = (a: P, b: P): P => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const ls = p(L.leftShoulder), rs = p(L.rightShoulder), lh = p(L.leftHip), rh = p(L.rightHip);
  const sc = mid(ls, rs), hc = mid(lh, rh);
  const torso = Math.hypot((sc[0] - hc[0]) * cam.w, (sc[1] - hc[1]) * cam.h) / cam.h;
  // the face's landmarks sit low in the head: its centre a little above them
  const face = mid(p(L.nose), mid(p(L.leftEye), p(L.rightEye)));
  const r = HEAD_PER_TORSO * torso;
  return {
    head: { kind: 'circle', c: [face[0], face[1] - r * 0.25], r },
    torso: { kind: 'polygon', pts: [ls, rs, rh, lh] },
    leftArm: { kind: 'path', pts: [ls, p(L.leftElbow), p(L.leftWrist)] },
    rightArm: { kind: 'path', pts: [rs, p(L.rightElbow), p(L.rightWrist)] },
    leftLeg: { kind: 'path', pts: [lh, p(L.leftKnee), p(L.leftAnkle)] },
    rightLeg: { kind: 'path', pts: [rh, p(L.rightKnee), p(L.rightAnkle)] },
  };
}

/**
 * Full-screen 2D-canvas overlay: loading screen, the "get in position" calibration dialog,
 * the small "get back in frame" box in the lower right corner and the resume countdown.
 * The dialog and the corner box are the same panel (`PANEL`, `drawPanel`), in two sizes: target outline,
 * the player's live skeleton (no camera image) and messages.
 */
export class FrameGuide {
  private ctx: CanvasRenderingContext2D;
  private rc: ReturnType<typeof rough.canvas>;
  /** offscreen, the player's figure drawn opaque, then laid over the panel see-through (rough.js's strokes overlap) */
  private layer = document.createElement('canvas');
  private layerRc = rough.canvas(this.layer);
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
      this.layer.width = this.canvas.width;
      this.layer.height = this.canvas.height;
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
      case 'demo':
        this.drawDemoPanel(s, W, H, now);
        break;
    }
  }

  /**
   * Rectangle with the camera image's proportions, centred in `r`: fitted inside it, or with `cover`
   * filling it (overflowing on one axis; the caller clips to `r`).
   */
  private fitCamera(r: Rect, cover = false, aspect?: number): Rect {
    const vw = aspect ?? (this.video.videoWidth || 1280), vh = aspect ? 1 : this.video.videoHeight || 720;
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
    const k = worldFit(W, H).scale;

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
    const k = worldFit(W, H).scale;
    const h = MINI_HEIGHT * k, w = h * MINI_ASPECT, margin = MINI_MARGIN * k;
    const box: Rect = { x: W - w - margin, y: H - h - margin, w, h };
    this.drawPanel(box, MINI_SCALE, s, now, { message: s.message ?? t('Get back in frame!') });
  }

  /**
   * The instructions' demonstration: the dialog's panel, no text, in the left half of the screen (the bird flies in the
   * right half), centred between the top and the ground.
   */
  private drawDemoPanel(s: GuideState, W: number, H: number, now: number) {
    const half = W / 2;
    // the ground's top on screen, the world placed as the game is (`fitWorld`)
    const fit = worldFit(W, H);
    const sky = fit.y + WORLD.groundY * fit.scale;
    let h = sky * PANEL.demo.height, w = h * DIALOG_ASPECT;
    if (w > half * 0.9) {
      w = half * 0.9;
      h = w / DIALOG_ASPECT;
    }
    const box: Rect = { x: (half - w) / 2, y: (sky - h) / 2, w, h };
    this.drawPanel(box, 1, s, now, { message: '' }, true);
  }

  /**
   * A pose panel (`PANEL`) filling `box`, its sizes scaled like the game and then by `scale`: the schematic, the messages (wrapped)
   * and, with `progress` (0..1), the hold-still bar. Portrait: the schematic shows only the middle
   * strip of the (landscape) camera view, where the player stands. Without any text or bar, the pose fills it all.
   */
  private drawPanel(
    box: Rect,
    scale: number,
    s: GuideState,
    now: number,
    c: { message: string; hint?: string; error?: boolean; progress?: number },
    posed = false,
  ) {
    const ctx = this.ctx;
    const { border, text, bar } = PANEL;
    // world px -> screen px
    const k = worldFit(window.innerWidth, window.innerHeight).scale * scale;
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

    const footer = lines.length || hintLines.length || barH
      ? lines.length * lineH + hintLines.length * hintH + (barH ? barH + pad * 0.6 : 0) + pad * 1.3
      : pad;
    const poseArea: Rect = { x: box.x + pad, y: box.y + pad, w: inner, h: box.h - footer - pad };
    ctx.save();
    ctx.beginPath();
    ctx.rect(poseArea.x, poseArea.y, poseArea.w, poseArea.h);
    ctx.clip();
    this.drawPose(s, this.fitCamera(poseArea, true, s.aspect), now, k, posed);
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
   * figure over it (the demo's `posedFigure`, dark grey and see-through), both mapped into the camera rectangle `cam` (mirrored). Line widths: `PANEL.pose`'s, scaled
   * by `k`. Without visibility data (still loading) the outline is grey. `posed`: the outline's figure moves with the
   * pose instead (`posedFigure`; the target outline while nobody's in view), no skeleton.
   */
  private drawPose(s: GuideState, cam: Rect, now: number, k: number, posed = false) {
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
    const figure = posed && s.frame ? posedFigure(s.frame, cam) : OUTLINE;
    const torso = figure.torso;
    if (torso.kind === 'polygon') {
      const seed = 40 + PART_NAMES.indexOf('torso');
      this.rc.polygon(torso.pts.map(toScreen), { stroke: 'none', fill: pose.belly, fillStyle: 'solid', roughness: 1.6, bowing: 1.5, seed });
    }
    this.drawFigure(this.rc, figure, toScreen, cam, outlineWidth, colorOf);

    if (s.frame && !posed) {
      // the player's figure, shaped and drawn like the demo's, opaque on the layer, then see-through over the outline
      const lc = this.layer.getContext('2d')!;
      lc.setTransform(1, 0, 0, 1, 0, 0);
      lc.clearRect(0, 0, this.layer.width, this.layer.height);
      lc.setTransform(ctx.getTransform());
      this.drawFigure(this.layerRc, posedFigure(s.frame, cam), toScreen, cam, skeletonWidth, () => pose.skeletonColor);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = pose.skeletonAlpha;
      ctx.drawImage(this.layer, 0, 0);
      ctx.restore();
    }
  }

  /**
   * `figure`'s outline, sketched by `rc` in rough strokes `width` wide: each part in `colorOf(part)` (null: not drawn);
   * the thighs in the torso's colour, as they show the hips.
   */
  private drawFigure(
    rc: ReturnType<typeof rough.canvas>,
    figure: Figure,
    toScreen: (p: P) => P,
    cam: Rect,
    width: number,
    colorOf: (name: PartName) => string | null,
  ) {
    PART_NAMES.forEach((name, i) => {
      const shape = figure[name];
      const style = (color: string) => ({ stroke: color, strokeWidth: width, roughness: 1.6, bowing: 1.5, seed: 40 + i });
      if (shape.kind === 'path' && (name === 'leftLeg' || name === 'rightLeg')) {
        // the thighs show the hips, which must be in view (they count with the torso); the rest of the leg is optional
        const [hip, knee, ankle] = shape.pts.map(toScreen);
        const thigh = colorOf('torso'), shin = colorOf(name);
        if (thigh) rc.line(...hip, ...knee, style(thigh));
        if (shin) rc.line(...knee, ...ankle, style(shin));
        return;
      }
      const color = colorOf(name);
      if (!color) return;
      const o = style(color);
      if (shape.kind === 'circle') {
        const [cx, cy] = toScreen(shape.c);
        rc.circle(cx, cy, shape.r * 2 * cam.h, o);
      } else if (shape.kind === 'polygon') {
        rc.polygon(shape.pts.map(toScreen), o);
      } else {
        rc.linearPath(shape.pts.map(toScreen), o);
      }
    });
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
