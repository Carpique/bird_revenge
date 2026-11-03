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

/**
 * The instructions page's "Back": in the middle, on the ground below the demonstration (world px), smaller than the
 * menus' items, never highlighted, in the title's colours.
 */
const INSTRUCTIONS_BACK = { x: WORLD.width / 2, y: 685, scale: 0.7 };

/**
 * The instructions page's start, ms one after another: "Watch" over the dimmed, frozen demonstration without its pose
 * panel; the dimming and "Watch" fading out; a pause, the game running on (`onWorldStart`); the panel and "Back"
 * fading in. Then the demonstration plays.
 */
const WATCH = { showMs: 2000, fadeOutMs: 250, pauseMs: 1000, panelInMs: 500 };
const WATCH_TOTAL_MS = WATCH.showMs + WATCH.fadeOutMs + WATCH.pauseMs + WATCH.panelInMs;

/** 0..1: how far `ms` is into the stretch starting at `from` lasting `length` */
const progress = (ms: number, from: number, length: number) => Math.min(1, Math.max(0, (ms - from) / length));

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
 * leaving only "Back"; first "Watch" over it dimmed and frozen (`WATCH`), then it plays (`onDemoStart`).
 */
export class SplashScreen extends Container {
  /** a level was picked to play (`levels` is empty: straight from "Start", without a level) */
  onStart: (level?: LevelDef) => void = () => {};
  onTraining: () => void = () => {};
  /** the instructions page opened (true) or closed: show the demonstration, which this screen leaves uncovered meanwhile */
  onInstructions: (open: boolean) => void = () => {};
  /** the instructions page's "Watch" has faded out: the demonstration's game runs on, the bird uncontrolled */
  onWorldStart: () => void = () => {};
  /** the instructions page's pose panel has faded in: play the demonstration */
  onDemoStart: () => void = () => {};

  private page: Page = 'main';
  private items: PageItem[] = [];
  private menu = new Menu(true);
  private title: GlowText;
  private levelSelect: LevelSelect;
  /** the poo rain and the ground: hidden for the instructions' demonstration */
  private backdrop = new Container();
  /** the dimming over the backdrop, or over the demonstration while "Watch" shows */
  private dim: Graphics;
  private watch: GlowText;
  /** ms into the instructions page's start (`WATCH`); null once the demonstration plays, or elsewhere */
  private watchMs: number | null = null;

  /**
   * `levels`: the level select's list, asked for each time it opens; `overlay`: the canvas drawn over the game (the pose
   * panel), hidden under "Watch" and then faded in; `hasTraining`: show "Training" as the last item (the training level loaded)
   */
  constructor(
    app: Application,
    thumbnails: Thumbnails,
    private levels: () => LevelChoice,
    private overlay: HTMLCanvasElement,
    private hasTraining = false,
  ) {
    super();
    const root = new Container();
    this.addChild(root);

    const rain = new PooRain();
    // dimmed like the game behind the in-game menu, with the text glowing over it
    const dim = new Graphics().rect(-WORLD.width * 5, -WORLD.height * 5, WORLD.width * 11, WORLD.height * 11).fill('#000');
    dim.alpha = config.signDim;
    this.backdrop.addChild(rain, new Ground());
    root.addChild(this.backdrop, dim);
    this.dim = dim;

    const title = new GlowText('', bigTextStyle(150));
    title.position.set(WORLD.width / 2, 170);
    const watch = new GlowText('', bigTextStyle(150));
    watch.position.set(WORLD.width / 2, WORLD.height / 2);
    watch.visible = false;
    this.watch = watch;


    this.levelSelect = new LevelSelect(thumbnails);
    // back on the main page (with "Start" selected) for when the game is quit; the list is made afresh next time
    this.levelSelect.onPick = (level) => {
      this.showPage('main');
      this.onStart(level);
    };
    this.levelSelect.onBack = () => this.showPage('main');
    this.levelSelect.visible = false;

    root.addChild(title, watch, this.menu, this.levelSelect);
    this.title = title;

    window.addEventListener('keydown', (e) => this.onKey(e));
    app.ticker.add((ticker) => {
      fitWorld(app, root);
      if (!this.visible) return;
      if (this.levelSelect.visible) this.levelSelect.update(ticker.deltaMS);
      else this.menu.animate(ticker.deltaMS);
      if (this.backdrop.visible) rain.update(ticker.deltaMS);
      if (this.watchMs !== null) {
        const worldAt = WATCH.showMs + WATCH.fadeOutMs;
        if (this.watchMs < worldAt && this.watchMs + ticker.deltaMS >= worldAt) this.onWorldStart();
        this.watchMs += ticker.deltaMS;
        if (this.watchMs < WATCH_TOTAL_MS) this.showWatch();
        else {
          this.watchMs = null;
          this.showWatch();
          this.onDemoStart();
        }
      }
    });
    const relabel = () => {
      title.text = t('Bird Revenge');
      watch.text = t('Watch');
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
    if (instructions !== (from === 'instructions')) {
      this.watchMs = instructions ? 0 : null;
      this.onInstructions(instructions);
    }
    this.showWatch();
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
      this.items = [{ label: 'Back', action: () => this.showPage('main') }];
    }
    // coming back to the main menu, keep the item we came from selected (also when re-labelled)
    const keep = from === page ? this.menu.selected : this.items.findIndex((it) => it.page === from);
    // the instructions' one item: smaller, in the title's colours, never highlighted, without the flying birds
    this.menu.cursorsShown = this.menu.highlight = !instructions;
    this.menu.titleColours = instructions;
    this.menu.itemScale = instructions ? INSTRUCTIONS_BACK.scale : 1;
    if (instructions) this.menu.setItems(this.items, INSTRUCTIONS_BACK.y, 0, INSTRUCTIONS_BACK.x);
    else this.menu.setItems(this.items, 370, Math.max(0, keep));
  }

  /**
   * The instructions page's start as far as `watchMs` (`WATCH`): "Watch" and the dimming, fading out, and the pose panel,
   * fading in; none of it otherwise (the dimming then goes with the backdrop, at full strength)
   */
  private showWatch() {
    const ms = this.watchMs;
    if (ms === null) {
      this.menu.alpha = 1;
      this.menu.visible = this.page !== 'levels';
      this.watch.visible = false;
      this.dim.visible = this.backdrop.visible;
      this.dim.alpha = config.signDim;
      this.overlay.style.opacity = '';
      return;
    }
    const shown = 1 - progress(ms, WATCH.showMs, WATCH.fadeOutMs);
    this.watch.visible = this.dim.visible = shown > 0;
    this.watch.alpha = shown;
    this.dim.alpha = config.signDim * shown;
    const panel = progress(ms, WATCH.showMs + WATCH.fadeOutMs + WATCH.pauseMs, WATCH.panelInMs);
    this.overlay.style.opacity = String(panel);
    this.menu.alpha = panel;
    this.menu.visible = panel > 0;
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
