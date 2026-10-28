import { Container, type Application } from 'pixi.js';
import { audio } from '../audio/audio';
import { WORLD } from '../config';
import { fitWorld } from '../render/fitWorld';
import { titleStyle } from './fonts';
import { GlowText } from './GlowText';
import { i18n, t } from './i18n';
import { Menu } from './Menu';

/**
 * Esc during a game: "What now?" — keep playing, restart the level or quit to the title screen.
 * Drawn over the game (which dims itself behind it). While open it takes the keys it uses — and Esc,
 * which closes it — before anything else sees them.
 */
export class PauseMenu extends Container {
  onResume: () => void = () => {};
  onRestart: () => void = () => {};
  onQuit: () => void = () => {};

  private menu = new Menu(true);

  constructor(app: Application) {
    super();
    this.visible = false;
    const root = new Container();
    this.addChild(root);

    const title = new GlowText('', titleStyle(110));
    title.position.set(WORLD.width / 2, 210);
    root.addChild(title, this.menu);

    // capture: before the game's keyboard handling, so e.g. Space chooses here instead of pausing
    window.addEventListener('keydown', (e) => this.onKey(e), true);
    app.ticker.add((ticker) => {
      fitWorld(app, root);
      if (this.visible) this.menu.animate(ticker.deltaMS);
    });
    const relabel = () => {
      title.text = t('What now?');
      this.menu.setItems(
        [
          { label: 'Keep playing', action: () => this.close(this.onResume) },
          { label: 'Start over', action: () => this.close(this.onRestart) },
          { label: "I've had enough", action: () => this.close(this.onQuit) },
        ],
        370,
        this.menu.selected,
      );
    };
    i18n.onChange(relabel);
    relabel();
  }

  /** Show it with "Keep playing" selected. */
  open() {
    this.menu.select(0);
    this.visible = true;
  }

  private close(then: () => void) {
    this.visible = false;
    then();
  }

  private onKey(e: KeyboardEvent) {
    if (!this.visible || e.target instanceof HTMLInputElement) return;
    if (e.key === 'Escape') {
      if (!e.repeat) {
        audio.play('button');
        this.close(this.onResume);
      }
    } else if (e.repeat || !this.menu.key(e.key)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }
}
