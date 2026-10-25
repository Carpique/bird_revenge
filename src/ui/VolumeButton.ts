import { audio } from '../audio/audio';
import { i18n, t } from './i18n';

const SPEAKER = '<path d="M4 9h4l5-4v14l-5-4H4z"/>';
const WAVE_LOW = '<path d="M16.5 9.5a3.5 3.5 0 0 1 0 5"/>';
const WAVE_HIGH = '<path d="M19 7a7 7 0 0 1 0 10"/>';
const CROSS = '<path d="M17 9.5l5 5M22 9.5l-5 5"/>';

/**
 * Speaker button next to the fullscreen one: click for a volume slider, M (or the slider at 0) mutes.
 * Like the fullscreen button it never keeps focus, so the keyboard keeps controlling the game.
 */
export class VolumeButton {
  private button = document.createElement('button');
  private popup = document.createElement('div');
  private slider = document.createElement('input');

  constructor(parent: HTMLElement) {
    const wrap = document.createElement('div');
    wrap.id = 'volume';
    const b = this.button;
    b.type = 'button';
    b.tabIndex = -1;
    b.className = 'corner-button';
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => (this.popup.hidden = !this.popup.hidden));

    const s = this.slider;
    s.type = 'range';
    s.min = '0';
    s.max = '100';
    s.tabIndex = -1;
    s.addEventListener('input', () => {
      audio.setVolume(Number(s.value) / 100, false);
      this.update();
    });
    // hand the keyboard back to the game straight away (Keyboard ignores keys aimed at inputs)
    s.addEventListener('pointerup', () => s.blur());
    s.addEventListener('change', () => s.blur());

    this.popup.className = 'volume-popup';
    this.popup.hidden = true;
    this.popup.appendChild(s);
    wrap.append(b, this.popup);
    parent.prepend(wrap);

    document.addEventListener('pointerdown', (e) => {
      if (!wrap.contains(e.target as Node)) this.popup.hidden = true;
    });
    i18n.onChange(() => this.update());
    this.update();
  }

  toggleMute() {
    // unmuting at volume 0 would stay silent
    if (audio.muted || audio.volume === 0) audio.setVolume(audio.volume || 0.5, false);
    else audio.setVolume(audio.volume, true);
    this.update();
  }

  private update() {
    const silent = audio.muted || audio.volume === 0;
    this.slider.value = String(Math.round((audio.muted ? 0 : audio.volume) * 100));
    this.button.setAttribute('aria-label', t(silent ? 'Sound off' : 'Volume'));
    this.slider.setAttribute('aria-label', t('Volume'));
    const waves = silent ? CROSS : audio.volume < 0.5 ? WAVE_LOW : WAVE_LOW + WAVE_HIGH;
    this.button.innerHTML =
      `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" ` +
      `stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${SPEAKER}${waves}</svg>`;
  }
}
