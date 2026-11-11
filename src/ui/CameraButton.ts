import { audio } from '../audio/audio';
import { i18n, t } from './i18n';

const ICON =
  '<path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2L8 5h8l1.5 2h2A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/>' +
  '<circle cx="12" cy="13" r="3.5"/>';

/**
 * "Camera on", first in the title screen's corner (before the volume button), while the player has turned the camera
 * down: click to ask to share it. Like the other corner buttons it never keeps focus.
 */
export class CameraButton {
  onClick?: () => void;
  private button = document.createElement('button');

  constructor(parent: HTMLElement) {
    const b = this.button;
    b.id = 'camera-on';
    b.type = 'button';
    b.tabIndex = -1;
    b.className = 'corner-button';
    b.hidden = true;
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => {
      audio.play('button');
      this.onClick?.();
    });
    b.innerHTML =
      `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" ` +
      `stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${ICON}</svg>`;
    const relabel = () => b.setAttribute('aria-label', t('Camera on'));
    i18n.onChange(relabel);
    relabel();
    parent.prepend(b);
  }

  set visible(on: boolean) {
    if (this.button.hidden !== !on) this.button.hidden = !on;
  }
}
