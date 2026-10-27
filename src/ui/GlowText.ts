import { BlurFilter, Container, Text, type TextStyleOptions } from 'pixi.js';
import { GLOW } from './fonts';

/** Centred text with a soft light halo behind it (a blurred, thickly outlined copy), so it stands out on the dimmed game. */
export class GlowText extends Container {
  private halo: Text;
  private body: Text;

  constructor(text: string, style: TextStyleOptions) {
    super();
    const size = Number(style.fontSize ?? 40);
    this.halo = new Text({
      text,
      style: { ...style, fill: GLOW, stroke: { color: GLOW, width: size / 5, join: 'round' }, dropShadow: false, padding: size / 2 },
    });
    this.halo.filters = [new BlurFilter({ strength: size / 9, quality: 4 })];
    this.halo.alpha = 0.8;
    this.body = new Text({ text, style });
    for (const t of [this.halo, this.body]) t.anchor.set(0.5);
    this.addChild(this.halo, this.body);
  }

  get text() {
    return this.body.text;
  }

  set text(text: string) {
    this.halo.text = text;
    this.body.text = text;
  }
}
