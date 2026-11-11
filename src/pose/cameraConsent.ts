/**
 * Whether the player let the game use the camera, remembered between visits so the "share the camera" panel shows
 * only until they answer it: 'granted' (the browser allowed it), 'declined' ("Ignore", or the browser blocked it;
 * the title screen then offers "Camera on") or null (not asked yet).
 *
 * The browser's own permission wins where it can be read (`navigator.permissions`): allowed there, it counts as
 * granted even if never asked here; reset there to "ask", the panel shows again, so the browser's prompt never comes
 * without it.
 */
export type Consent = 'granted' | 'declined' | null;

const STORAGE_KEY = 'bird-revenge.camera';

function load(): Consent {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'granted' || saved === 'declined') return saved;
  } catch {
    /* no storage */
  }
  return null;
}

let consent: Consent = load();
const listeners: (() => void)[] = [];

export const cameraConsent = {
  get value(): Consent {
    return consent;
  },
  set(next: Consent) {
    if (next === consent) return;
    consent = next;
    try {
      if (next) localStorage.setItem(STORAGE_KEY, next);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* no storage: asked again next visit */
    }
    for (const fn of listeners) fn();
  },
  onChange(fn: () => void) {
    listeners.push(fn);
  },
  /** Follow the browser's camera permission, now and whenever it changes (not readable everywhere: then just the saved answer). */
  async watchBrowser() {
    let status: PermissionStatus;
    try {
      status = await navigator.permissions.query({ name: 'camera' as PermissionName });
    } catch {
      return;
    }
    const follow = () => {
      if (status.state === 'granted') this.set('granted');
      else if (status.state === 'denied') this.set('declined');
      else if (consent === 'granted') this.set(null);
    };
    follow();
    status.addEventListener('change', follow);
  },
};

/**
 * Asks the browser for the camera (its prompt shows, unless already answered) and lets go of it straight away.
 * Resolves to the answer: 'granted', 'blocked' (refused, now or earlier) or 'unavailable' (no camera, or no camera API).
 */
export async function requestCamera(): Promise<'granted' | 'blocked' | 'unavailable'> {
  if (!navigator.mediaDevices?.getUserMedia) return 'unavailable';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
    stream.getTracks().forEach((t) => t.stop());
    return 'granted';
  } catch (e) {
    console.error(e);
    return isPermissionError(e) ? 'blocked' : 'unavailable';
  }
}

export function isPermissionError(e: unknown) {
  const s = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  return /Permission|NotAllowed/i.test(s);
}
