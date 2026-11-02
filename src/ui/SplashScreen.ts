import { Container, Graphics, type Application } from 'pixi.js';
import { audio } from '../audio/audio';
import { config, WORLD } from '../config';
import { Ground } from '../game/Ground';
import type { Thumbnails } from '../level/thumbnails';
import type { LevelDef } from '../level/types';
import { fitWorld } from '../render/fitWorld';
import { bigTextStyle } from './fonts';
import { GlowText } from './GlowText';
import { i18n, t } from './i18n';
import { LevelSelect } from './LevelSelect';
import { Menu, type MenuItem } from './Menu';
import { PooRain } from './PooRain';

type Page = 'main' | 'instructions' | 'levels';

interface PageItem extends MenuItem {
  /** the page it opens, so coming back keeps it selected */
  page?: Page;
}

/** The instructions page's "Return": in the middle, on the ground below the demonstration (world px). */
const INSTRUCTIONS_BACK = { x: WORLD.width / 2, y: 685 };

/** The level select's list: the game's levels in play order, which can be picked, and which to select first. */
export interface LevelChoice {
  levels: LevelDef[];
  unlocked: ReadonlySet<string>;
  current?: string;
}

/**
 * Title screen drawn in the game world (1280x720): sky, the game's ground, the title and the
 * main menu; "Start" opens the level select. Arrow keys / W S to move, Enter or Space to choose, Esc to go back;
 * mouse works too. "Instructions" shows no text: the title screen makes way for a demonstration (`onInstructions`),
 * leaving only "Return".
 */
export class SplashScreen extends Container {
  /** a level was picked to play (`levels` is empty: straight from "Start", without a level) */
  onStart: (level?: LevelDef) => void = () => {};
  onTraining: () => void = () => {};
  /** the instructions page opened (true) or closed: show the demonstration, which this screen leaves uncovered meanwhile */
  onInstructions: (open: boolean) => void = () => {};

  private page: Page = 'main';
  private items: PageItem[] = [];
  private menu = new Menu(true);
  private title: GlowText;
  private levelSelect: LevelSelect;
  /** the poo rain, the ground and the dimming over them: hidden for the instructions' demonstration */
  private backdrop = new Container();

  /** `levels`: the level select's list, asked for each time it opens; `hasTraining`: show "Training" as the last item (the training level loaded) */
  constructor(
    app: Application,
    thumbnails: Thumbnails,
    private levels: () => LevelChoice,
    private hasTraining = false,
  ) {
    super();
    const root = new Container();
    this.addChild(root);

    const rain = new PooRain();
    // dimmed like the game behind the in-game menu, with the text glowing over it
    const dim = new Graphics().rect(-WORLD.width * 5, -WORLD.height * 5, WORLD.width * 11, WORLD.height * 11).fill('#000');
    dim.alpha = config.signDim;
    this.backdrop.addChild(rain, new Ground(), dim);
    root.addChild(this.backdrop);

    const title = new GlowText('', bigTextStyle(150));
    title.position.set(WORLD.width / 2, 170);

    this.levelSelect = new LevelSelect(thumbnails);
    // back on the main page (with "Start" selected) for when the game is quit; the list is made afresh next time
    this.levelSelect.onPick = (level) => {
      this.showPage('main');
      this.onStart(level);
    };
    this.levelSelect.onBack = () => this.showPage('main');
    this.levelSelect.visible = false;

    root.addChild(title, this.menu, this.levelSelect);
    this.title = title;

    window.addEventListener('keydown', (e) => this.onKey(e));
    app.ticker.add((ticker) => {
      fitWorld(app, root);
      if (!this.visible) return;
      if (this.levelSelect.visible) this.levelSelect.update(ticker.deltaMS);
      else this.menu.animate(ticker.deltaMS);
      if (this.backdrop.visible) rain.update(ticker.deltaMS);
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
    // the level select has its own title and "Back" (and re-labels itself)
    const select = page === 'levels';
    const instructions = page === 'instructions';
    this.menu.visible = !select;
    this.title.visible = !select && !instructions;
    this.backdrop.visible = !instructions;
    this.levelSelect.visible = select;
    if (instructions !== (from === 'instructions')) this.onInstructions(instructions);
    if (select) {
      if (from !== 'levels') {
        const { levels, unlocked, current } = this.levels();
        this.levelSelect.open(levels, unlocked, current);
      }
      return;
    }
    if (page === 'main') {
      this.items = [
        { page: 'levels', label: 'Start', action: () => (this.levels().levels.length ? this.showPage('levels') : this.onStart()) },
      ];
      if (this.hasTraining) this.items.push({ label: 'Training', action: () => this.onTraining() });
      this.items.push({ page: 'instructions', label: 'Instructions', action: () => this.showPage('instructions') });
    } else {
      this.items = [{ label: 'Return', action: () => this.showPage('main') }];
    }
    // coming back to the main menu, keep the item we came from selected (also when re-labelled)
    const keep = from === page ? this.menu.selected : this.items.findIndex((it) => it.page === from);
    // the instructions' one item goes without the flying birds
    this.menu.cursorsShown = !instructions;
    if (instructions) this.menu.setItems(this.items, INSTRUCTIONS_BACK.y, 0, INSTRUCTIONS_BACK.x);
    else this.menu.setItems(this.items, 370, Math.max(0, keep));
  }

  private onKey(e: KeyboardEvent) {
    if (!this.visible || e.repeat) return;
    if ((this.page === 'levels' ? this.levelSelect : this.menu).key(e.key)) e.preventDefault();
    else if (e.key === 'Escape' && this.page !== 'main') {
      audio.play('button');
      this.showPage('main');
      e.preventDefault();
    }
  }
}
