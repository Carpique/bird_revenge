import { audio } from '../audio/audio';
import { i18n, type Lang } from './i18n';

const FLAGS: Record<Lang, string> = {
  pl: '<svg viewBox="0 0 16 10" width="28" height="18"><rect width="16" height="5" fill="#fff"/><rect y="5" width="16" height="5" fill="#dc143c"/></svg>',
  en:
    '<svg viewBox="0 0 60 30" width="30" height="15">' +
    '<clipPath id="uk-t"><path d="M30,15h30v15zv15h-30zh-30v-15zv-15h30z"/></clipPath>' +
    '<rect width="60" height="30" fill="#012169"/>' +
    '<path d="M0,0L60,30M60,0L0,30" stroke="#fff" stroke-width="6"/>' +
    '<path d="M0,0L60,30M60,0L0,30" clip-path="url(#uk-t)" stroke="#c8102e" stroke-width="4"/>' +
    '<path d="M30,0v30M0,15h60" stroke="#fff" stroke-width="10"/>' +
    '<path d="M30,0v30M0,15h60" stroke="#c8102e" stroke-width="6"/></svg>',
};
const NAMES: Record<Lang, string> = { pl: 'Polski', en: 'English' };

/**
 * Flag in the top-left corner of the title screen showing the language a click switches to.
 * Like the other corner buttons it never keeps focus, so Space / Enter keep driving the menu.
 */
export class LanguageButton {
  private button = document.createElement('button');

  constructor() {
    const b = this.button;
    b.id = 'language';
    b.className = 'corner-button';
    b.type = 'button';
    b.tabIndex = -1;
    b.hidden = true; // until the title screen shows
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => {
      audio.play('button');
      i18n.set(this.other());
    });
    i18n.onChange(() => this.update());
    this.update();
    document.body.appendChild(b);
  }

  set visible(v: boolean) {
    this.button.hidden = !v;
  }

  private other(): Lang {
    return i18n.lang === 'pl' ? 'en' : 'pl';
  }

  private update() {
    const next = this.other();
    this.button.title = NAMES[next];
    this.button.setAttribute('aria-label', NAMES[next]);
    this.button.innerHTML = FLAGS[next];
  }
}
