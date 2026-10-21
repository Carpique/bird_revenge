/**
 * Keeps the screen from dimming / sleeping while the game runs: the player controls it with their
 * body, so the OS sees no input and would otherwise dim the screen after its idle timeout.
 * The browser drops the lock by itself when the page is hidden; `set(true)` again re-acquires it.
 * Silently does nothing where the Screen Wake Lock API is missing or the request is refused
 * (e.g. low battery mode).
 */
let wanted = false;
let sentinel: WakeLockSentinel | null = null;
let pending = false;

const sync = async () => {
  if (pending || !('wakeLock' in navigator)) return;
  pending = true;
  const target = wanted;
  try {
    if (wanted && (!sentinel || sentinel.released) && !document.hidden) {
      sentinel = await navigator.wakeLock.request('screen');
    } else if (!wanted && sentinel && !sentinel.released) {
      await sentinel.release();
      sentinel = null;
    }
  } catch (e) {
    console.warn('wake lock:', e);
  } finally {
    pending = false;
  }
  // `wanted` may have changed while the request was in flight
  if (wanted !== target) void sync();
};

export const wakeLock = {
  set(on: boolean) {
    wanted = on;
    void sync();
  },
};
