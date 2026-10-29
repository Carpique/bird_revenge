import { Container, Graphics, type Application } from 'pixi.js';
import { audio } from '../audio/audio';
import { config, WORLD } from '../config';
import { Ground } from '../game/Ground';
import { fitWorld } from '../render/fitWorld';
import { bigTextStyle, INK, TEXT_FONT } from './fonts';
import { GlowText } from './GlowText';
import { i18n, t, type Msg } from './i18n';
import { Menu, type MenuItem } from './Menu';
import { PooRain } from './PooRain';

type Page = 'main' | 'instructions';

interface PageItem extends MenuItem {
  /** the page it opens, so coming back keeps it selected */
  page?: Page;
}

const INSTRUCTIONS: (Msg | '')[] = [
  'Flap both arms to fly up.',
  'Tilt your arms to fly sideways — flap them tilted to climb that way.',
  'Spread your arms in a T to float down slowly.',
  'Shoot: raise a leg sideways to drop a poo.',
  'Fly into the little animals to save them — save them all to finish the level!',
  'Hit the villain to score!',
  "Don't touch him — it costs you one of your 3 lives.",
  'Stand back so your arms and hips are in view.',
  'Keyboard: ↑ flap · ← → fly sideways · Shift float · ↓ poo · Space pause',
];

/**
 * Title screen drawn in the game world (1280x720): sky, the game's ground, the title and the
 * main menu. Arrow keys / W S to move, Enter or Space to choose, Esc to go back; mouse works too.
 */
export class SplashScreen extends Container {
  onStart: () => void = () => {};
  onTraining: () => void = () => {};

  private page: Page = 'main';
  private items: PageItem[] = [];
  private menu = new Menu(true);
  private pageText: GlowText;

  /** `hasTraining`: show "Training" as the last item (the training level loaded) */
  constructor(
    app: Application,
    private hasTraining = false,
  ) {
    super();
    const root = new Container();
    this.addChild(root);

    const rain = new PooRain();
    // dimmed like the game behind the in-game menu, with the text glowing over it
    const dim = new Graphics().rect(-WORLD.width * 5, -WORLD.height * 5, WORLD.width * 11, WORLD.height * 11).fill('#000');
    dim.alpha = config.signDim;
    root.addChild(rain, new Ground(), dim);

    const title = new GlowText('', bigTextStyle(150));
    title.position.set(WORLD.width / 2, 170);

    this.pageText = new GlowText('', { fontFamily: TEXT_FONT, fontSize: 28, fill: INK, align: 'center', lineHeight: 32 });
    this.pageText.x = WORLD.width / 2;

    root.addChild(title, this.pageText, this.menu);

    window.addEventListener('keydown', (e) => this.onKey(e));
    app.ticker.add((ticker) => {
      fitWorld(app, root);
      if (!this.visible) return;
      this.menu.animate(ticker.deltaMS);
      rain.update(ticker.deltaMS);
    });
    const relabel = () => {
      title.text = t('Bird Revenge');
      this.showPage(this.page);
    };
    i18n.onChange(relabel);
    relabel();
  }

  private showPage(page: Page) {
    const from = this.page;
    this.page = page;
    if (page === 'main') {
      this.pageText.text = '';
      this.items = [
        { label: 'Start', action: () => this.onStart() },
        { page: 'instructions', label: 'Instructions', action: () => this.showPage('instructions') },
      ];
      if (this.hasTraining) this.items.push({ label: 'Training', action: () => this.onTraining() });
    } else {
      this.pageText.text = INSTRUCTIONS.map((line) => line && t(line)).join('\n');
      // the instructions start under the title (top at y = 258), so they end above the Back button
      this.pageText.y = 258 + this.pageText.textHeight / 2;
      this.items = [{ label: 'Back', action: () => this.showPage('main') }];
    }
    // coming back to the main menu, keep the item we came from selected (also when re-labelled)
    const keep = from === page ? this.menu.selected : this.items.findIndex((it) => it.page === from);
    this.menu.setItems(this.items, page === 'main' ? 370 : 590, Math.max(0, keep));
  }

  private onKey(e: KeyboardEvent) {
    if (!this.visible || e.repeat) return;
    if (this.menu.key(e.key)) e.preventDefault();
    else if (e.key === 'Escape' && this.page !== 'main') {
      audio.play('button');
      this.showPage('main');
      e.preventDefault();
    }
  }
}
