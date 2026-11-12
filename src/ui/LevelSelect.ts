import { ColorMatrixFilter, Container, FederatedPointerEvent, Graphics, Sprite, Text, type Texture } from 'pixi.js';
import { audio } from '../audio/audio';
import { WORLD } from '../config';
import type { LevelDef } from '../level/types';
import { DEMO } from '../levels';
import type { Thumbnails } from '../level/thumbnails';
import { scenery } from '../scenery/scenery';
import { BIG_FILL, BIG_OUTLINE, bigTextStyle, INK, TEXT_FONT } from './fonts';
import { GlowText } from './GlowText';
import { i18n, t } from './i18n';
import { Menu } from './Menu';

const COLUMNS = 3;
const CARD_W = 320;
const CARD_H = 180;
const GAP_X = 44;
const GAP_Y = 36;
const RADIUS = 18;
/** the selected card grows by this */
const SELECTED_SCALE = 1.06;
/** room around the cards inside the scrolling panel, so a grown card's border isn't cut off */
const PAD = 16;
/** the scrolling panel, in world coordinates */
const VIEW = { top: 185, height: 430 };
const GRID_LEFT = (WORLD.width - (COLUMNS * CARD_W + (COLUMNS - 1) * GAP_X)) / 2;
const BACK_Y = 668;
/** how far (px on screen) a press may move and still be a tap, not a drag */
const DRAG_SLOP = 10;
/** ms a locked card shakes when chosen */
const SHAKE_MS = 350;

/** A level's thumbnail with a rounded border and its number ("Demo" for the demo); grey with a padlock while locked. */
class Card extends Container {
  private picture = new Sprite();
  private border = new Graphics();
  private lock = padlock();
  private grey = new ColorMatrixFilter();
  /** ms left of the "locked" shake */
  shake = 0;

  constructor(
    readonly level: LevelDef,
    readonly locked: boolean,
    name: string,
  ) {
    super();
    const shape = () => new Graphics().roundRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, RADIUS);
    const sky = shape().fill(scenery.skyColor);
    this.picture.anchor.set(0.5);
    const mask = shape().fill('#fff');
    this.picture.mask = mask;
    this.grey.desaturate();
    this.grey.brightness(0.75, true);
    const label = new Text({ text: name, style: bigTextStyle(40, TEXT_FONT) });
    label.position.set(-CARD_W / 2 + 12, -CARD_H / 2 + 4);
    this.lock.visible = locked;
    this.addChild(sky, this.picture, mask, this.lock, label, this.border);
    if (locked) for (const c of [sky, this.picture, label]) c.filters = [this.grey];
    this.selected = false;
  }

  set texture(texture: Texture) {
    this.picture.texture = texture;
    this.picture.scale.set(CARD_W / texture.width, CARD_H / texture.height);
  }

  set selected(on: boolean) {
    this.scale.set(on ? SELECTED_SCALE : 1);
    const b = this.border.clear();
    const edge = () => b.roundRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, RADIUS);
    // selected: the big text's colours, red round yellow, like the selected menu item
    if (on) edge().stroke({ color: BIG_OUTLINE, width: 12 }), edge().stroke({ color: BIG_FILL, width: 5 });
    else edge().stroke({ color: INK, width: 5 });
  }
}

/** A padlock, centred on (0, 0). */
function padlock(): Container {
  const g = new Graphics();
  const shackle = () => g.moveTo(-22, 0).lineTo(-22, -22).arc(0, -22, 22, Math.PI, 0).lineTo(22, 0);
  shackle().stroke({ color: INK, width: 16, cap: 'round' });
  shackle().stroke({ color: '#d9d9d9', width: 7, cap: 'round' });
  g.roundRect(-36, -8, 72, 58, 12).fill('#f2f2f2').stroke({ color: INK, width: 5 });
  g.circle(0, 14, 8).fill(INK);
  g.roundRect(-3.5, 16, 7, 18, 3).fill(INK);
  const c = new Container();
  c.addChild(g);
  c.y = -6;
  return c;
}

/**
 * "Select level": the game's levels as thumbnails, three to a row, in a panel that scrolls when they don't fit
 * (wheel, drag, or following the keys). The finished ones and the first one not finished can be picked; the rest
 * are grey with a padlock. Arrow keys / W A S D move, Enter or Space chooses, down past the last row reaches "Back".
 */
export class LevelSelect extends Container {
  onPick: (level: LevelDef) => void = () => {};
  onBack: () => void = () => {};

  private cards: Card[] = [];
  private content = new Container();
  private scrollBar = new Graphics();
  private back = new Menu(true);
  /** the selected card; `cards.length`: "Back" */
  private selected = 0;
  /** the card last selected, to go back up to from "Back" */
  private lastCard = 0;
  private scroll = 0;
  private scrollTarget = 0;
  private drag: { y: number; scroll: number; moved: boolean } | null = null;

  constructor(private thumbnails: Thumbnails) {
    super();
    const title = new GlowText('', bigTextStyle(110));
    title.position.set(WORLD.width / 2, 100);

    const panel = new Container();
    // anywhere on the panel can be dragged, also between the cards
    const hit = new Graphics().rect(0, VIEW.top, WORLD.width, VIEW.height).fill({ color: '#000', alpha: 0.001 });
    const mask = new Graphics().rect(0, VIEW.top, WORLD.width, VIEW.height).fill('#fff');
    this.content.mask = mask;
    panel.addChild(hit, this.content, mask, this.scrollBar);
    panel.eventMode = 'static';
    panel.on('pointerdown', (e) => this.startDrag(e));
    panel.on('globalpointermove', (e) => this.moveDrag(e));
    panel.on('pointerup', () => (this.drag = null));
    panel.on('pointerupoutside', () => (this.drag = null));

    // in the title's colours, like the instructions page's "Back": black is hard to see over the dimmed backdrop
    this.back.titleColours = true;
    this.addChild(title, panel, this.back);
    window.addEventListener('wheel', (e) => this.onWheel(e), { passive: true });

    const relabel = () => {
      title.text = t('Select level');
      this.back.setItems([{ label: 'Back', action: () => this.onBack() }], BACK_Y, this.back.selected);
    };
    i18n.onChange(relabel);
    relabel();
  }

  /** Show `levels` (in play order), the `unlocked` ones pickable, with `current` selected. */
  open(levels: LevelDef[], unlocked: ReadonlySet<string>, current: string | undefined) {
    for (const c of this.content.removeChildren()) c.destroy({ children: true });
    // numbered from 1 after the demo
    let number = 0;
    this.cards = levels.map((level, i) => {
      const card = new Card(level, !unlocked.has(level.name), level.name === DEMO ? t('Demo') : String(++number));
      card.position.set(
        GRID_LEFT + (i % COLUMNS) * (CARD_W + GAP_X) + CARD_W / 2,
        VIEW.top + PAD + Math.floor(i / COLUMNS) * (CARD_H + GAP_Y) + CARD_H / 2,
      );
      card.eventMode = 'static';
      card.cursor = card.locked ? 'not-allowed' : 'pointer';
      card.on('pointerover', () => !this.drag?.moved && this.select(i));
      card.on('pointertap', () => !this.drag?.moved && this.choose(i));
      this.thumbnails.get(level).then((texture) => {
        if (!card.destroyed) card.texture = texture;
      });
      this.content.addChild(card);
      return card;
    });
    this.drag = null;
    this.select(Math.max(0, levels.findIndex((l) => l.name === current)));
    this.scroll = this.scrollTarget;
  }

  /** Arrow keys / W A S D move, Enter or Space chooses. Returns whether the key was used. */
  key(k: string): boolean {
    const n = this.cards.length;
    const onBack = this.selected === n;
    if (k === 'ArrowLeft' || k === 'a') this.move(onBack ? 0 : Math.max(0, this.selected - 1));
    else if (k === 'ArrowRight' || k === 'd') this.move(onBack ? n : Math.min(n - 1, this.selected + 1));
    else if (k === 'ArrowUp' || k === 'w') this.move(onBack ? this.lastCard : Math.max(this.selected % COLUMNS, this.selected - COLUMNS));
    // down from the last row: "Back"; from a column the row below doesn't reach: that row's last card
    else if (k === 'ArrowDown' || k === 's') this.move(onBack ? n : this.lastRow(this.selected) ? n : Math.min(n - 1, this.selected + COLUMNS));
    else if (k === 'Enter' || k === ' ') this.choose(this.selected);
    else return false;
    return true;
  }

  update(dtMs: number) {
    this.back.animate(dtMs);
    this.scroll += (this.scrollTarget - this.scroll) * Math.min(1, dtMs / 90);
    this.content.y = -this.scroll;
    for (const c of this.cards) {
      c.shake = Math.max(0, c.shake - dtMs);
      c.pivot.x = c.shake > 0 ? Math.sin(c.shake / 22) * 8 * (c.shake / SHAKE_MS) : 0;
    }
    this.drawScrollBar();
  }

  private lastRow(i: number) {
    return Math.floor(i / COLUMNS) === Math.floor((this.cards.length - 1) / COLUMNS);
  }

  private move(i: number) {
    if (i === this.selected) return;
    this.select(i);
    audio.play('button');
  }

  private select(i: number) {
    this.selected = i;
    if (i < this.cards.length) this.lastCard = i;
    this.cards.forEach((c, j) => (c.selected = j === i));
    // the selected card in front of its neighbours, so its border isn't covered
    if (this.cards[i]) this.content.addChild(this.cards[i]);
    this.back.select(i === this.cards.length ? 0 : -1);
    this.scrollTo(i);
  }

  private choose(i: number) {
    if (i === this.cards.length) {
      audio.play('button');
      this.onBack();
      return;
    }
    const card = this.cards[i];
    if (!card) return;
    this.select(i);
    if (card.locked) {
      card.shake = SHAKE_MS;
      return;
    }
    audio.play('button');
    this.onPick(card.level);
  }

  private get maxScroll() {
    const rows = Math.ceil(this.cards.length / COLUMNS);
    return Math.max(0, rows * CARD_H + (rows - 1) * GAP_Y + 2 * PAD - VIEW.height);
  }

  /** Scroll just enough to show card `i`'s row whole. */
  private scrollTo(i: number) {
    if (i >= this.cards.length) return;
    const top = Math.floor(i / COLUMNS) * (CARD_H + GAP_Y);
    const bottom = top + CARD_H + 2 * PAD;
    this.setScroll(Math.min(top, Math.max(this.scrollTarget, bottom - VIEW.height)));
  }

  private setScroll(y: number) {
    this.scrollTarget = Math.min(this.maxScroll, Math.max(0, y));
  }

  /** world px per screen px */
  private get unit() {
    return 1 / (this.worldTransform.a || 1);
  }

  /** shown, and so are all its parents */
  private get onScreen() {
    for (let c: Container | null = this; c; c = c.parent) if (!c.visible) return false;
    return true;
  }

  private onWheel(e: WheelEvent) {
    if (!this.onScreen || !this.maxScroll) return;
    const lines = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 40 : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? VIEW.height : 1;
    this.setScroll(this.scrollTarget + e.deltaY * lines * this.unit);
  }

  private startDrag(e: FederatedPointerEvent) {
    this.drag = { y: e.global.y, scroll: this.scrollTarget, moved: false };
  }

  private moveDrag(e: FederatedPointerEvent) {
    const d = this.drag;
    if (!d || !e.buttons) return;
    const dy = e.global.y - d.y;
    if (Math.abs(dy) > DRAG_SLOP) d.moved = true;
    if (!d.moved || !this.maxScroll) return;
    this.setScroll(d.scroll - dy * this.unit);
    this.scroll = this.scrollTarget;
  }

  /** a thin bar at the panel's right edge, when there's more than fits */
  private drawScrollBar() {
    const g = this.scrollBar.clear();
    const max = this.maxScroll;
    if (!max) return;
    const x = WORLD.width - 48;
    const track = VIEW.height - 2 * PAD;
    const length = (track * VIEW.height) / (VIEW.height + max);
    const y = VIEW.top + PAD + ((track - length) * this.scroll) / max;
    g.roundRect(x - 4, VIEW.top + PAD, 8, track, 4).fill({ color: INK, alpha: 0.25 });
    g.roundRect(x - 4, y, 8, length, 4).fill(INK);
  }
}
