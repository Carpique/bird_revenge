import { Container, Text, type TextStyleOptions } from 'pixi.js';
import { audio } from '../audio/audio';
import { birdDef } from '../characters/bird';
import { WORLD } from '../config';
import { CharacterSprite } from '../render/CharacterSprite';
import { BIG_FILL, BIG_OUTLINE, bigTextStyle, INK, TEXT_FONT } from './fonts';
import { GlowText } from './GlowText';
import { t, type Msg } from './i18n';

/** Plain black items; the selected one in the big-text colours swapped (red, yellow outline, black shadow). */
const ITEM_STYLE: TextStyleOptions = { fontFamily: TEXT_FONT, fontSize: 54, fill: INK };
/** Like the title: yellow, red outline, black shadow (for `titleColours`). */
const TITLE_STYLE = bigTextStyle(54, TEXT_FONT);
const SELECTED_STYLE = bigTextStyle(54, TEXT_FONT, BIG_OUTLINE, BIG_FILL);

export interface MenuItem {
  label: Msg;
  action: () => void;
}

/**
 * A column of poster-style menu items, centred in the world, with a small flapping bird on each side of
 * the selected one. Mouse: hover selects, click chooses; keys are passed in through `key()`.
 * `glow`: items with a light halo, to stand out over the dimmed game.
 */
export class Menu extends Container {
  private items: MenuItem[] = [];
  private list = new Container();
  private cursors: CharacterSprite<keyof typeof birdDef.animations>[] = [];
  private t = 0;
  selected = 0;
  /** the small flapping birds beside the selected item */
  cursorsShown = true;
  /** the selected item in the big-text colours (else all plain; Enter / Space still choose it) */
  highlight = true;
  /** the items not highlighted in the title's colours instead of black */
  titleColours = false;
  /** the items' size, 1 = full */
  itemScale = 1;

  constructor(private glow = false) {
    super();
    for (const facing of ['right', 'left'] as const) {
      const bird = new CharacterSprite<keyof typeof birdDef.animations>(birdDef);
      bird.play('flap');
      bird.setFacing(facing);
      bird.scale.set(0.6);
      this.cursors.push(bird);
    }
    this.addChild(this.list, ...this.cursors);
  }

  /** Show `items`, the first one at y = `top`, centred on `x`, with item `selected` highlighted. */
  setItems(items: MenuItem[], top: number, selected = 0, x = WORLD.width / 2) {
    this.items = items;
    for (const c of this.list.removeChildren()) c.destroy();
    items.forEach((item, i) => {
      const label = t(item.label);
      const text = this.glow ? new GlowText(label, this.plainStyle) : new Text({ text: label, style: this.plainStyle });
      if (text instanceof Text) text.anchor.set(0.5);
      text.position.set(x, top + i * 82);
      text.eventMode = 'static';
      text.cursor = 'pointer';
      text.on('pointerover', () => this.select(i));
      text.on('pointertap', () => this.activate(i));
      this.list.addChild(text);
    });
    this.select(selected);
  }

  /** Highlight item `i` (wrapping round); none for -1 (the level select's grid has the keys instead). */
  select(i: number) {
    this.selected = i === -1 ? -1 : (i + this.items.length) % this.items.length;
    for (const c of this.cursors) c.visible = this.cursorsShown && this.selected !== -1;
    this.list.children.forEach((c, j) => {
      const text = c as Text | GlowText;
      const on = this.highlight && j === this.selected;
      if (text instanceof GlowText) {
        text.setStyle(on ? SELECTED_STYLE : this.plainStyle);
        // the selected item's outline already makes it stand out
        text.glow = on ? 0.75 : 1; // halo opacity 0.6 instead of 0.8
      } else text.style = on ? SELECTED_STYLE : this.plainStyle;
      text.scale.set((on ? 1.08 : 1) * this.itemScale);
    });
  }

  private get plainStyle() {
    return this.titleColours ? TITLE_STYLE : ITEM_STYLE;
  }

  /** Arrow keys / W S move, Enter or Space chooses. Returns whether the key was used. */
  key(k: string): boolean {
    if (k === 'ArrowUp' || k === 'w') this.move(-1);
    else if (k === 'ArrowDown' || k === 's') this.move(1);
    else if (k === 'Enter' || k === ' ') this.activate(this.selected);
    else return false;
    return true;
  }

  /** The next / previous item, with a click when the highlight moves. */
  private move(step: number) {
    const from = this.selected;
    this.select(this.selected + step);
    if (this.selected !== from) audio.play('button');
  }

  private activate(i: number) {
    audio.play('button');
    this.select(i);
    this.items[i].action();
  }

  animate(dtMs: number) {
    this.t += dtMs;
    const item = this.list.children[this.selected] as Text | GlowText | undefined;
    if (!item) return;
    const bob = Math.sin(this.t / 220) * 6;
    const gap = 30 + item.width / 2;
    this.cursors[0].position.set(item.x - gap - 30, item.y + bob);
    this.cursors[1].position.set(item.x + gap + 30, item.y - bob);
  }
}
