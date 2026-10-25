import { i18n, t } from './i18n';

const ENTER_ICON =
  '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>';
const EXIT_ICON =
  '<path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5"/>';

/**
 * Fullscreen toggle in the top-right corner, always visible. The button never takes focus, so
 * Space keeps pausing the game instead of clicking the button again.
 */
export class FullscreenButton {
  private button = document.createElement('button');

  constructor(parent: HTMLElement) {
    const b = this.button;
    b.id = 'fullscreen';
    b.className = 'corner-button';
    b.type = 'button';
    b.tabIndex = -1;
    if (!document.fullscreenEnabled) b.hidden = true;
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => this.toggle());
    document.addEventListener('fullscreenchange', () => this.update());
    i18n.onChange(() => this.update());
    this.update();
    parent.appendChild(b);
  }

  private toggle() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => {});
  }

  private update() {
    const full = !!document.fullscreenElement;
    this.button.setAttribute('aria-label', t(full ? 'Exit full screen' : 'Full screen'));
    this.button.innerHTML =
      `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" ` +
      `stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${full ? EXIT_ICON : ENTER_ICON}</svg>`;
  }
}
