import { i18n, t } from './i18n';

/** a phone turning from upright to sideways */
const ICON =
  '<svg viewBox="0 0 48 48" width="44" height="44" fill="none" stroke="currentColor" stroke-width="2.5" ' +
  'stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="14" width="30" height="20" rx="3"/>' +
  '<path d="M35 18v12"/><path d="M14 8a14 14 0 0 1 14-2l-2-3M34 40a14 14 0 0 1-14 2l2 3"/></svg>';

/**
 * Above the game's box on a phone held upright (`body.boxed`, see style.css): asks to turn the phone sideways, where
 * the game fills the screen.
   */
export class RotateHint {
  constructor(parent: HTMLElement) {
    const update = () => {
      parent.innerHTML = `${ICON}<span>${t('Turn your phone sideways')}</span>`;
    };
    i18n.onChange(update);
    update();
  }
}
