import { audio } from '../audio/audio';
import { isPortrait } from '../render/fitWorld';
import { i18n, t } from './i18n';

const ENTER_ICON =
  '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>';
const EXIT_ICON =
  '<path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5"/>';

/** Keyboard Lock API (Chromium only), not in TypeScript's DOM lib yet */
interface KeyboardLock {
  lock(keys?: string[]): Promise<void>;
  unlock(): void;
}
const keyboardLock = (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;

/** The Fullscreen API, also Safari's older prefixed one (iPad); iPhone Safari has neither (only for videos). */
const doc = document as Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
const root = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
const fullscreenEnabled = () => !!(document.fullscreenEnabled || doc.webkitFullscreenEnabled);
const fullscreenElement = () => document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
const requestFullscreen = () =>
  Promise.resolve(root.requestFullscreen ? root.requestFullscreen() : root.webkitRequestFullscreen?.()).catch(() => {});
const exitFullscreen = () =>
  Promise.resolve(document.exitFullscreen ? document.exitFullscreen() : doc.webkitExitFullscreen?.()).catch(() => {});

/** iPhone / iPad (an iPad says it's a Mac, but has a touch screen) */
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
/** started from the home screen: already as full screen as it gets */
const isInstalled = () =>
  matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;
/** a phone or a tablet */
const isTouch = matchMedia('(pointer: coarse)').matches;
const landscape = () => !isPortrait(window.innerWidth, window.innerHeight);

/**
 * Fullscreen toggle, always visible: in the top-right corner on the title screen, in the game a bare icon in the
 * bottom-right one, over the ground (style.css, `body.in-game`). The button never takes focus, so
 * Space keeps pausing the game instead of clicking the button again.
 * On a phone or a tablet turned sideways, the first tap goes full screen by itself, like a video app (browsers allow it
 * only on a tap), and turning it upright again leaves it. Leaving full screen by hand while sideways is respected until
 * it's turned upright. Where pages can't go full screen (iPhone Safari) the button explains adding the game to the home
 * screen, which opens it without the browser's bars.
 */
export class FullscreenButton {
  private button = document.createElement('button');
  private tip = document.createElement('div');
  private escapeLocked = false;
  /** full screen was entered by turning the device sideways (so turning it back leaves it) */
  private autoEntered = false;
  /** the next tap goes full screen (turned sideways, and not left by hand since) */
  private autoArmed = false;

  constructor(parent: HTMLElement) {
    const wrap = document.createElement('div');
    wrap.id = 'fullscreen';
    const b = this.button;
    b.className = 'corner-button';
    b.type = 'button';
    b.tabIndex = -1;
    if (isInstalled() || (!fullscreenEnabled() && !isIOS)) wrap.hidden = true;
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => this.toggle());
    this.tip.className = 'corner-popup';
    this.tip.hidden = true;
    wrap.append(b, this.tip);
    document.addEventListener('pointerdown', (e) => {
      if (!wrap.contains(e.target as Node)) this.tip.hidden = true;
    });
    for (const event of ['fullscreenchange', 'webkitfullscreenchange']) {
      document.addEventListener(event, () => {
        // left by hand while sideways: not again until turned upright and back
        if (!fullscreenElement() && landscape()) this.autoArmed = false;
        if (!fullscreenElement()) this.autoEntered = false;
        this.update();
        this.applyEscapeLock();
      });
    }
    if (isTouch && fullscreenEnabled()) {
      let wasLandscape = landscape();
      this.autoArmed = wasLandscape;
      window.addEventListener('resize', () => {
        const now = landscape();
        if (now === wasLandscape) return;
        wasLandscape = now;
        this.autoArmed = now;
        if (!now && this.autoEntered) void exitFullscreen();
      });
      // the button's own tap toggles it instead
      window.addEventListener(
        'pointerup',
        (e) => {
          if (!this.autoArmed || !landscape() || fullscreenElement() || wrap.contains(e.target as Node)) return;
          this.autoArmed = false;
          this.autoEntered = true;
          void requestFullscreen();
        },
        true,
      );
    }
    i18n.onChange(() => this.update());
    this.update();
    parent.appendChild(wrap);
  }

  /**
   * While locked, Esc in full screen reaches the game (to open the pause menu) instead of leaving
   * full screen; holding Esc still leaves it. Browsers without the Keyboard Lock API ignore this.
   */
  set lockEscape(locked: boolean) {
    if (locked === this.escapeLocked) return;
    this.escapeLocked = locked;
    this.applyEscapeLock();
  }

  private applyEscapeLock() {
    if (!keyboardLock) return;
    if (this.escapeLocked && fullscreenElement()) keyboardLock.lock(['Escape']).catch(() => {});
    else keyboardLock.unlock();
  }

  private toggle() {
    audio.play('button');
    if (!fullscreenEnabled()) this.tip.hidden = !this.tip.hidden;
    else if (fullscreenElement()) void exitFullscreen();
    else {
      this.autoEntered = false;
      void requestFullscreen();
    }
  }

  private update() {
    const full = !!fullscreenElement();
    this.button.setAttribute('aria-label', t(full ? 'Exit full screen' : 'Full screen'));
    // two layers: an outline under the icon, shown only in the game (see style.css)
    const icon = full ? EXIT_ICON : ENTER_ICON;
    this.button.innerHTML =
      `<svg viewBox="-2 -2 28 28" width="28" height="28" fill="none" stroke-linecap="round" stroke-linejoin="round">` +
      `<g class="icon-shadow">${icon}</g><g class="icon-outline">${icon}</g><g class="icon-fill">${icon}</g></svg>`;
    this.tip.textContent = t('To play full screen, tap Share, then “Add to Home Screen”.');
  }
}
