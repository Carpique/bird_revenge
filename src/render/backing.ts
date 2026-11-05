import { CanvasSource, Sprite, Text, Texture } from 'pixi.js';

/**
 * The faint outline behind characters, bat poo and the score counters: a pale silhouette a little bigger than the
 * art, which fills the gaps in the sketchy (hachure) fills and lifts the ink off dark skies. Change its look here.
 */
export const BACKING = {
  color: '#f0f6fa',
  /** how far it reaches past the art, in world pixels */
  width: 3,
  /** the same for small things: the score counters, bat poo */
  smallWidth: 1.5,
  alpha: 0.24,
};

const textures = new Map<string, Texture>();

/**
 * A silhouette of `t` grown by `radius` (in the texture's own pixels) on every side, filled with `color`: the image
 * stamped in a ring of offsets, then recoloured. The result is `radius` bigger than `t` on each side. Cached.
 */
function backingTexture(t: Texture, radius: number, color: string): Texture {
  const key = `${t.uid}|${radius}|${color}`;
  let b = textures.get(key);
  if (b) return b;
  const res = t.source.resolution;
  const r = Math.ceil(radius * res);
  const w = t.frame.width * res, h = t.frame.height * res;
  const canvas = document.createElement('canvas');
  canvas.width = w + 2 * r;
  canvas.height = h + 2 * r;
  const g = canvas.getContext('2d')!;
  const image = t.source.resource as CanvasImageSource;
  const stamp = (dx: number, dy: number) => g.drawImage(image, t.frame.x * res, t.frame.y * res, w, h, r + dx, r + dy, w, h);
  // two rings, so the gaps between the outer stamps are filled too
  for (const k of [r, r / 2]) for (let i = 0; i < 16; i++) stamp(Math.cos((i * Math.PI) / 8) * k, Math.sin((i * Math.PI) / 8) * k);
  stamp(0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, canvas.width, canvas.height);
  b = new Texture({ source: new CanvasSource({ resource: canvas, resolution: res }) });
  textures.set(key, b);
  return b;
}

/**
 * The backing for `art` (a sprite of a loaded image, animated or not), reaching `width` world pixels past it: add it to
 * the same parent, just before `art`.
 * Each render it takes the art's frame, position, anchor, flip and scale, so it's never out of step.
 */
export function spriteBacking(art: Sprite, width = BACKING.width): Sprite {
  const backing = new Sprite();
  backing.alpha = BACKING.alpha;
  backing.onRender = () => {
    const t = art.texture;
    const b = (backing.texture = backingTexture(t, width / Math.abs(art.scale.y), BACKING.color));
    // the backing is bigger on each side: put the same point of the art on the anchor
    const { width: w, height: h } = t.frame;
    const pad = (b.frame.width - w) / 2;
    backing.anchor.set((art.anchor.x * w + pad) / b.frame.width, (art.anchor.y * h + pad) / b.frame.height);
    backing.scale.copyFrom(art.scale);
    backing.position.copyFrom(art.position);
  };
  return backing;
}

/**
 * The backing for `text`: the same text in the backing's colour with a stroke reaching `width` past it on each side.
 * Add it to the same parent, just before `text`; it follows the text's content and position.
 */
export function textBacking(text: Text, width = BACKING.width): Text {
  const backing = new Text({ text: text.text, style: text.style.clone() });
  backing.style.fill = BACKING.color;
  backing.style.stroke = { color: BACKING.color, width: 2 * width, join: 'round' };
  backing.alpha = BACKING.alpha;
  backing.onRender = () => {
    backing.text = text.text;
    backing.anchor.copyFrom(text.anchor);
    backing.position.copyFrom(text.position);
  };
  return backing;
}
