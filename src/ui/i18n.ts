export type Lang = 'en' | 'pl';

/**
 * Polish for every user-facing string, keyed by its English text. The code stays in English and
 * passes the English text to `t()`; `{name}` placeholders are filled from `t()`'s params.
 */
const PL = {
  // title screen
  'Bird Revenge': 'Zemsta Ptaka',
  Start: 'Start',
  Instructions: 'Instrukcje',
  Training: 'Trening',
  Back: 'Wróć',
  Watch: 'Obserwuj',
  'Select level': 'Wybierz Poziom',

  // game
  Pause: 'Zaraz\nWracam',
  'Game Over': 'Klops!',
  'Hooray!': 'Wypas!',

  // the Esc menu during a game
  'What now?': 'Czego?',
  'Keep playing': 'Grać dalej',
  'Start over': 'Od nowa',
  "I've had enough": 'Mam dość',

  // overlays and the calibration dialog
  'Loading…': 'Ładowanie…',
  'Get in position': 'Ustaw Się',
  'Get back in frame!': 'Wróć do kadru!',
  'Get into view': 'Wejdź w kadr',
  // the calibration dialog's button beside "Back": play with the on-screen controls (or the keyboard)
  'No camera': 'Bez Kamery',
  'Press Esc to play with the keyboard': 'Naciśnij Esc, żeby grać na klawiaturze',
  'Reconnecting…': 'Ponowne łączenie…',
  '{error} – reconnecting…': '{error} – ponowne łączenie…',
  'Loading pose model…': 'Ładowanie modelu sylwetki…',
  'Starting camera…': 'Uruchamianie kamery…',
  'Camera disconnected': 'Kamera rozłączona',
  'Camera unavailable': 'Kamera niedostępna',
  'Camera access was blocked': 'Dostęp do kamery jest zablokowany',
  'Camera API not available (the page must be served from localhost or https).':
    'Kamera jest niedostępna (strona musi być otwarta przez localhost lub https).',
  'Could not start pose tracking: {error}': 'Nie udało się uruchomić śledzenia ruchu: {error}',
  'Raise your arms like the outline': 'Podnieś ręce jak na obrysie',
  'Stand up straight': 'Stań prosto',
  'Put your legs down': 'Postaw obie nogi na ziemi',
  'Hold still…': 'Nie ruszaj się…',
  'Great!': 'Super!',
  'Step in front of the camera': 'Stań przed kamerą',
  'Move to the middle of the picture': 'Stań na środku obrazu',
  'Step back — your hips are out of view': 'Cofnij się, nie widać bioder',
  'Move right — an arm is out of view': 'Przesuń się w prawo — nie widać ręki',
  'Move left — an arm is out of view': 'Przesuń się w lewo — nie widać ręki',
  'Step back — your arms are out of view': 'Cofnij się — nie widać rąk',
  'Face the camera': 'Stań przodem do kamery',
  'Come a bit closer': 'Podejdź trochę bliżej',

  // a phone held upright, and full screen on an iPhone
  'Turn your phone sideways': 'Obróć telefon poziomo',
  'To play full screen, tap Share, then “Add to Home Screen”.':
    'Aby grać na pełnym ekranie, stuknij „Udostępnij”, a potem „Do ekranu początkowego”.',

  // corner buttons (screen-reader labels)
  'Full screen': 'Pełny ekran',
  'Exit full screen': 'Zamknij pełny ekran',
  Volume: 'Głośność',
  'Sound off': 'Dźwięk wyłączony',
  Menu: 'Menu',
} as const;

export type Msg = keyof typeof PL;

const STORAGE_KEY = 'bird-revenge.lang';

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'pl') return saved;
  } catch {
    /* no storage */
  }
  return 'pl';
}

let lang: Lang = initialLang();
const listeners: (() => void)[] = [];

/** The user-facing text of `msg` in the current language. */
export function t(msg: Msg, params?: Record<string, string | number>): string {
  let s: string = lang === 'pl' ? PL[msg] : msg;
  if (params) for (const [k, v] of Object.entries(params)) s = s.replace(`{${k}}`, String(v));
  return s;
}

function applyToDocument() {
  if (typeof document === 'undefined') return; // tests
  document.documentElement.lang = lang;
  document.title = t('Bird Revenge');
}
applyToDocument();

/** Current language; switching it is remembered and re-labels everything that listens. */
export const i18n = {
  get lang() {
    return lang;
  },
  set(next: Lang) {
    if (next === lang) return;
    lang = next;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* no storage */
    }
    applyToDocument();
    for (const fn of listeners) fn();
  },
  onChange(fn: () => void) {
    listeners.push(fn);
  },
};
