export type Lang = 'en' | 'pl';

/**
 * Polish for every user-facing string, keyed by its English text. The code stays in English and
 * passes the English text to `t()`; `{name}` placeholders are filled from `t()`'s params.
 */
const PL = {
  // title screen
  'Bird Revenge': 'Zemsta Ptaka',
  "Sun is shining, yet it's raining...": 'Słońce świeci, z nieba ...',
  Start: 'Start',
  Instructions: 'Instrukcja Obsługi',
  Back: 'Wróć',
  'Flap both arms to fly up.': 'Machaj obiema rękami, żeby lecieć w górę.',
  'Flap one arm (or one faster than the other) to fly sideways.': 'Machaj jedną ręką (albo jedną szybciej niż drugą), żeby lecieć w bok.',
  'Spread your arms in a T to glide down slowly — tilt them to dive that way.':
    'Rozłóż ręce w literę T, żeby powoli szybować w dół — przechyl je, żeby zanurkować w tę stronę.',
  'Shoot: raise a leg sideways to drop a poo — it flies that way.': 'Strzał: unieś nogę w bok, żeby zrzucić kupę — poleci w tę stronę.',
  'Fly into the little animals to save them — save them all to finish the level!':
    'Wleć w zwierzątka, żeby je uratować — uratuj wszystkie, żeby przejść poziom!',
  'Hit the villain to score!': 'Traf złoczyńcę, żeby zdobyć punkt!',
  "Don't touch him — it costs you one of your 3 lives.": 'Nie dotykaj go — stracisz jedno z 3 żyć.',
  'Stand back so your arms and hips are in view.': 'Stań dalej, żeby kamera widziała twoje ręce i biodra.',
  'Keyboard: ↑ flap · ← → steer · Shift glide (+ ← → dive) · ↓ poo · Space pause':
    'Klawiatura: ↑ machanie · ← → skręt · Shift szybowanie (+ ← → nurkowanie) · ↓ kupa · Spacja pauza',

  // game
  'Score: {score}': 'Trafienia: {score}',
  Pause: 'Pauza',
  'Game Over': 'Koniec Gry',
  'Hooray!': 'Hurra!',

  // overlays and the calibration dialog
  'Loading…': 'Ładowanie…',
  'Get ready to flap!': 'Szykuj skrzydła!',
  'Stand in the outline': 'Stań w obrysie',
  'Get back in frame!': 'Wróć do kadru!',
  'Get into view': 'Wejdź w kadr',
  'No camera': 'Brak kamery',
  'Press Esc to play with the keyboard': 'Naciśnij Esc, żeby grać na klawiaturze',
  'Reconnecting…': 'Ponowne łączenie…',
  '{error} – reconnecting…': '{error} – ponowne łączenie…',
  'Getting ready': 'Przygotowanie',
  'Loading pose model…': 'Ładowanie modelu sylwetki…',
  'Starting camera…': 'Uruchamianie kamery…',
  'Camera disconnected': 'Kamera rozłączona',
  'Camera unavailable': 'Kamera niedostępna',
  'Camera access was blocked': 'Dostęp do kamery jest zablokowany',
  'Camera API not available (the page must be served from localhost or https).':
    'Kamera jest niedostępna (strona musi być otwarta przez localhost lub https).',
  'Could not start pose tracking: {error}': 'Nie udało się uruchomić śledzenia ruchu: {error}',
  'Lower your arms like the outline': 'Opuść ręce jak na obrysie',
  'Stand up straight': 'Stań prosto',
  'Put your legs down': 'Postaw obie nogi na ziemi',
  'Hold still…': 'Nie ruszaj się…',
  'Great!': 'Super!',
  'Step in front of the camera': 'Stań przed kamerą',
  'Step back — your hips are out of view': 'Cofnij się — nie widać bioder',
  'Move right — an arm is out of view': 'Przesuń się w prawo — nie widać ręki',
  'Move left — an arm is out of view': 'Przesuń się w lewo — nie widać ręki',
  'Step back — your arms are out of view': 'Cofnij się — nie widać rąk',
  'Face the camera': 'Stań przodem do kamery',
  'Come a bit closer': 'Podejdź trochę bliżej',

  // corner buttons (screen-reader labels)
  'Full screen': 'Pełny ekran',
  'Exit full screen': 'Zamknij pełny ekran',
  Volume: 'Głośność',
  'Sound off': 'Dźwięk wyłączony',
} as const;

export type Msg = keyof typeof PL;

const STORAGE_KEY = 'pooping-birds.lang';

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
