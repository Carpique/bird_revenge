import { Container, Text, type Application } from 'pixi.js';
import { birdDef } from '../characters/bird';
import { WORLD } from '../config';
import { Ground } from '../game/Ground';
import { CharacterSprite } from '../render/CharacterSprite';
import { fitWorld } from '../render/fitWorld';
import { ACCENT, HAND_FONT, INK, TITLE_FONT, titleStyle } from './fonts';

type Page = 'main' | 'instructions' | 'scores';

interface MenuItem {
  label: string;
  action: () => void;
}

const PAGE_TEXT: Record<Exclude<Page, 'main'>, string> = {
  instructions: [
    'Flap both arms to fly up.',
    'Flap one arm (or one faster than the other) to fly sideways.',
    'Spread your arms in a T to glide down slowly — tilt them to dive that way.',
    'Shoot: raise a leg sideways to drop a poo — it flies that way.',
    'Hit the villain to score!',
    "Don't touch him — it costs you one of your 3 lives.",
    '',
    'Stand back so your arms and hips are in view.',
    'Keyboard: ↑ flap · ← → steer · Shift glide (+ ← → dive) · ↓ poo · Space pause',
  ].join('\n'),
  scores: 'No scores yet.\nRounds and high scores are coming soon.',
};

/**
 * Title screen drawn in the game world (1280x720): sky, the game's ground, the title and the
 * main menu. Arrow keys / W S to move, Enter or Space to choose, Esc to go back; mouse works too.
 */
export class SplashScreen extends Container {
  onStart: () => void = () => {};

  private page: Page = 'main';
  private items: MenuItem[] = [];
  private selected = 0;
  private menu = new Container();
  private pageText: Text;
  private cursors: CharacterSprite<keyof typeof birdDef.animations>[] = [];
  private t = 0;

  constructor(app: Application) {
    super();
    const root = new Container();
    this.addChild(root);

    root.addChild(new Ground());

    const title = new Text({ text: 'Bird Revenge', style: titleStyle(150) });
    title.anchor.set(0.5);
    title.position.set(WORLD.width / 2, 170);

    const tagline = new Text({ text: 'flap · shoot · splat', style: { fontFamily: HAND_FONT, fontSize: 34, fill: '#555' } });
    tagline.anchor.set(0.5);
    tagline.position.set(WORLD.width / 2, 275);

    this.pageText = new Text({
      text: '',
      style: { fontFamily: HAND_FONT, fontSize: 30, fill: INK, align: 'center', lineHeight: 36 },
    });
    this.pageText.anchor.set(0.5, 0);
    this.pageText.position.set(WORLD.width / 2, 320);

    // a small flapping bird on each side of the selected item
    for (const facing of ['right', 'left'] as const) {
      const bird = new CharacterSprite<keyof typeof birdDef.animations>(birdDef);
      bird.play('flap');
      bird.setFacing(facing);
      bird.scale.set(0.6);
      this.cursors.push(bird);
    }

    root.addChild(title, tagline, this.pageText, this.menu, ...this.cursors);

    window.addEventListener('keydown', (e) => this.onKey(e));
    app.ticker.add((ticker) => {
      fitWorld(app, root);
      if (this.visible) this.animate(ticker.deltaMS);
    });
    this.showPage('main');
  }

  private showPage(page: Page) {
    const from = this.page;
    this.page = page;
    if (page === 'main') {
      this.pageText.text = '';
      this.items = [
        { label: 'Start', action: () => this.onStart() },
        { label: 'Instructions', action: () => this.showPage('instructions') },
        { label: 'Scores', action: () => this.showPage('scores') },
      ];
    } else {
      this.pageText.text = PAGE_TEXT[page];
      this.items = [{ label: 'Back', action: () => this.showPage('main') }];
    }
    this.buildMenu(page === 'main' ? 370 : 585);
    // coming back to the main menu, keep the item we came from selected
    this.select(page === 'main' ? Math.max(0, this.items.findIndex((it) => it.label.toLowerCase() === from)) : 0);
  }

  private buildMenu(top: number) {
    for (const c of this.menu.removeChildren()) c.destroy();
    this.items.forEach((item, i) => {
      const text = new Text({ text: item.label, style: { fontFamily: TITLE_FONT, fontSize: 54, fill: INK } });
      text.anchor.set(0.5);
      text.position.set(WORLD.width / 2, top + i * 82);
      text.eventMode = 'static';
      text.cursor = 'pointer';
      text.on('pointerover', () => this.select(i));
      text.on('pointertap', () => this.activate(i));
      this.menu.addChild(text);
    });
  }

  private select(i: number) {
    this.selected = (i + this.items.length) % this.items.length;
    this.menu.children.forEach((c, j) => {
      const text = c as Text;
      text.style.fill = j === this.selected ? ACCENT : INK;
      text.scale.set(j === this.selected ? 1.08 : 1);
    });
  }

  private activate(i: number) {
    this.select(i);
    this.items[i].action();
  }

  private onKey(e: KeyboardEvent) {
    if (!this.visible || e.repeat) return;
    const k = e.key;
    if (k === 'ArrowUp' || k === 'w') this.select(this.selected - 1);
    else if (k === 'ArrowDown' || k === 's') this.select(this.selected + 1);
    else if (k === 'Enter' || k === ' ') this.activate(this.selected);
    else if (k === 'Escape' && this.page !== 'main') this.showPage('main');
    else return;
    e.preventDefault();
  }

  private animate(dtMs: number) {
    this.t += dtMs;
    const item = this.menu.children[this.selected] as Text | undefined;
    if (!item) return;
    const bob = Math.sin(this.t / 220) * 6;
    const gap = 30 + item.width / 2;
    this.cursors[0].position.set(item.x - gap - 30, item.y + bob);
    this.cursors[1].position.set(item.x + gap + 30, item.y - bob);
  }
}
