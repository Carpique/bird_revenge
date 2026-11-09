import { audio } from '../audio/audio';
import { i18n, t } from './i18n';

const ICON = '<path d="M4 6h16M4 12h16M4 18h16"/>';

/**
 * The pause menu's button, for touch screens (no Esc to press): in the game, after the fullscreen icon, or in its place
 * once in full screen. Drawn like the fullscreen icon (style.css), and like it never takes focus.
 */
export class MenuButton {
  onClick?: () => void;
  private wrap = document.createElement('div');
  private button = document.createElement('button');

  constructor(parent: HTMLElement) {
    this.wrap.id = 'menu';
    this.wrap.hidden = true;
    const b = this.button;
    b.className = 'corner-button';
    b.type = 'button';
    b.tabIndex = -1;
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => {
      audio.play('button');
      this.onClick?.();
    });
    b.innerHTML =
      `<svg viewBox="-2 -2 28 28" width="28" height="28" fill="none" stroke-linecap="round" stroke-linejoin="round">` +
      `<g class="icon-shadow">${ICON}</g><g class="icon-outline">${ICON}</g><g class="icon-fill">${ICON}</g></svg>`;
    this.wrap.appendChild(b);
    const relabel = () => b.setAttribute('aria-label', t('Menu'));
    i18n.onChange(relabel);
    relabel();
    parent.appendChild(this.wrap);
  }

  get visible() {
    return !this.wrap.hidden;
  }

  set visible(on: boolean) {
    if (this.wrap.hidden === !on) return;
    this.wrap.hidden = !on;
  }
}
