import { CanvasSource, Container, Graphics, Sprite, Texture } from 'pixi.js';
import rough from 'roughjs';
import type { Options } from 'roughjs/bin/core';
import { Constraint } from '../game/physics';
import type { BuiltLevel, LevelBody } from './build';
import type { Branch, ButtonDef, LevelDef, Material } from './types';

const INK = '#2b2b2b';
const BARK = '#8a6440';
const FILLS: Record<Material, string> = { wood: '#c79a6b', stone: '#a3a8ad', rubber: '#d9534f', ice: '#b5dcf5' };
const BUTTON_CAP = '#e0533d';
const BUTTON_BASE = '#6b6f73';
/** how see-through a door is while it's open (where it'll come back stays visible) */
const OPEN_ALPHA = 0.15;
/** canvases are drawn at this many pixels per world pixel, so they stay crisp when the stage is scaled up */
const RES = 2;
/** room around a shape for the sketchy strokes */
const PAD = 6;

const style = (seed: number, fill: string, extra: Options = {}): Options => ({
  seed,
  stroke: INK,
  strokeWidth: 2.2,
  roughness: 1.4,
  bowing: 1.2,
  fill,
  fillStyle: 'hachure',
  hachureGap: 6,
  fillWeight: 1.4,
  ...extra,
});

/**
 * Draws a level's bodies, branches, joints and buttons in the placeholder art's sketchy style (Rough.js, at load time).
 * Terrain and branches go into one picture; each movable body is its own sprite following its physics body,
 * and so is each door (terrain a button switches), which fades while it's open.
 */
export class LevelView extends Container {
  private movers: { item: LevelBody; sprite: Sprite }[] = [];
  private jointLines = new Graphics();
  /** by terrain id */
  private doors = new Map<number, { sprite: Sprite; solid: boolean; blink: boolean }>();
  /** by button id */
  private buttons = new Map<number, { up: Sprite; down: Sprite }>();

  constructor(level: LevelDef, private built: BuiltLevel) {
    super();
    const targets = new Set(level.buttons.map((b) => b.target));
    const terrain = built.bodies.filter((b) => b.def.kind === 'terrain' && !targets.has(b.def.id));
    this.addChild(staticSprite(level, terrain));
    for (const item of built.bodies) {
      if (!targets.has(item.def.id)) continue;
      const sprite = bodySprite(item, style(item.def.id * 7, BARK, { hachureAngle: 20 }));
      sprite.position.set(item.body.position.x, item.body.position.y);
      sprite.rotation = item.body.angle;
      this.doors.set(item.def.id, { sprite, solid: true, blink: false });
      this.addChild(sprite);
    }
    for (const b of level.buttons) {
      const up = buttonSprite(b, false), down = buttonSprite(b, true);
      down.visible = false;
      this.buttons.set(b.id, { up, down });
      this.addChild(up, down);
    }
    this.addChild(this.jointLines);
    for (const item of built.bodies) {
      if (item.def.kind !== 'body') continue;
      const sprite = bodySprite(item);
      this.movers.push({ item, sprite });
      this.addChild(sprite);
    }
    this.sync();
  }

  /** A door (terrain switched by a button) is there or open. */
  setSolid(id: number, solid: boolean) {
    const door = this.doors.get(id);
    if (door) door.solid = solid;
  }

  /** A door about to switch back blinks: `back` shows it as it'll be (without fading, to keep up with fast blinking). */
  setBlink(id: number, back: boolean) {
    const door = this.doors.get(id);
    if (door) door.blink = back;
  }

  setPressed(id: number, pressed: boolean) {
    const b = this.buttons.get(id);
    if (!b) return;
    b.up.visible = !pressed;
    b.down.visible = pressed;
  }

  sync() {
    for (const door of this.doors.values()) {
      if (door.blink) door.sprite.alpha = door.solid ? OPEN_ALPHA : 1;
      else door.sprite.alpha += 0.25 * ((door.solid ? 1 : OPEN_ALPHA) - door.sprite.alpha);
    }
    for (const { item, sprite } of this.movers) {
      sprite.position.set(item.body.position.x, item.body.position.y);
      sprite.rotation = item.body.angle;
    }
    const g = this.jointLines.clear();
    for (const { def, constraint } of this.built.joints) {
      const a = Constraint.pointAWorld(constraint), b = Constraint.pointBWorld(constraint);
      if (def.kind === 'rope') g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color: INK, width: 2.5 });
      g.circle(b.x, b.y, 5).fill(BARK).stroke({ color: INK, width: 2 });
    }
  }

  override destroy() {
    for (const s of this.children) if (s instanceof Sprite) s.texture.destroy(true);
    super.destroy({ children: true });
  }
}

/** A canvas of `w` × `h` world px, drawn at `RES`, with its Rough.js context. */
function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * RES);
  c.height = Math.ceil(h * RES);
  const ctx = c.getContext('2d')!;
  ctx.scale(RES, RES);
  return { c, ctx, rc: rough.canvas(c) };
}

const textureOf = (c: HTMLCanvasElement) => new Texture({ source: new CanvasSource({ resource: c, resolution: RES }) });

function staticSprite(level: LevelDef, terrain: LevelBody[]): Sprite {
  const { c, ctx, rc } = canvas(level.width, level.height);
  for (const br of level.branches) drawBranch(rc, br);
  for (const item of terrain) {
    // the outline is around the body's centre, unrotated
    const { x, y } = item.body.position;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(item.body.angle);
    drawShape(rc, item, style(item.def.id * 7, BARK, { hachureAngle: 20 }));
    ctx.restore();
  }
  return new Sprite(textureOf(c));
}

function bodySprite(item: LevelBody, o?: Options): Sprite {
  // bounds of the unrotated shape around the body's centre
  const r = item.def.shape.kind === 'circle' ? item.def.shape.r : 0;
  const xs = r ? [-r, r] : item.outline.map((p) => p[0]);
  const ys = r ? [-r, r] : item.outline.map((p) => p[1]);
  const x0 = Math.min(...xs) - PAD, y0 = Math.min(...ys) - PAD;
  const w = Math.max(...xs) + PAD - x0, h = Math.max(...ys) + PAD - y0;
  const { c, ctx, rc } = canvas(w, h);
  ctx.translate(-x0, -y0);
  const material = item.def.kind === 'body' ? item.def.material : 'wood';
  drawShape(rc, item, o ?? style(item.def.id * 7, FILLS[material]));
  const sprite = new Sprite(textureOf(c));
  sprite.anchor.set(-x0 / w, -y0 / h);
  return sprite;
}

/** Draws a body's shape around (0, 0). */
function drawShape(rc: ReturnType<typeof rough.canvas>, item: LevelBody, o: Options) {
  const s = item.def.shape;
  if (s.kind === 'circle') rc.circle(0, 0, s.r * 2, o);
  else rc.polygon(item.outline, o);
}

/** Tapered like the old tree branches: thick at the start, thin at the tip; the top edge is where the bird sits. */
function drawBranch(rc: ReturnType<typeof rough.canvas>, br: Branch) {
  const [x0, y0] = br.from, [x1, y1] = br.to;
  rc.polygon([[x0, y0], [x1, y1], [x1, y1 + 6], [x0, y0 + 16]], style(Math.round(x0 + y0), BARK, { hachureAngle: 20, hachureGap: 5 }));
}

/** A button: a red cap on a grey base plate, domed when up, squashed flat when pressed. */
function buttonSprite(b: ButtonDef, pressed: boolean): Sprite {
  const w = b.x1 - b.x0, h = b.y1 - b.y0;
  const { c, ctx, rc } = canvas(w + 2 * PAD, h + 2 * PAD);
  ctx.translate(PAD, PAD);
  const base = Math.min(8, h * 0.3);
  const capH = (h - base) * (pressed ? 0.25 : 1);
  const inset = w * 0.12;
  // the cap: a half ellipse standing on the base
  const cap: [number, number][] = [];
  for (let i = 0; i <= 12; i++) {
    const a = (Math.PI * i) / 12;
    cap.push([w / 2 - Math.cos(a) * (w / 2 - inset), h - base - Math.sin(a) * capH]);
  }
  rc.polygon(cap, style(b.id * 7, BUTTON_CAP, { fillStyle: 'solid' }));
  rc.rectangle(0, h - base, w, base, style(b.id * 7 + 1, BUTTON_BASE));
  const sprite = new Sprite(textureOf(c));
  sprite.position.set(b.x0 - PAD, b.y0 - PAD);
  return sprite;
}
